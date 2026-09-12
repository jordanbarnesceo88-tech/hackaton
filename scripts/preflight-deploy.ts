// Что случится с БОЕВОЙ базой при следующем `prisma migrate deploy` — до того, как он побежит.
//
// Поводом стала миграция 20260903172455_saved_analysis_solution_fk: она содержит
// `DELETE FROM "SavedAnalysis"` и на боевой ещё НЕ ПРИМЕНЯЛАСЬ (прод отстаёт примерно на
// двадцать коммитов). Логика удаления защитима — строка, чей solutionId никуда не ведёт, не
// открывается ни отчётом, ни калькулятором, — но применять её вслепую нельзя: «сколько строк
// исчезло» после факта узнать неоткуда.
//
// Скрипт ТОЛЬКО ЧИТАЕТ. Ни одной записи, ни одного DDL: он выполняет тем же условием SELECT и
// показывает, кого затронет. Запускать против боевой строки подключения ПЕРЕД деплоем:
//
//   DATABASE_URL="<боевой pooled url>" npx tsx scripts/preflight-deploy.ts
//
// RELATIVE import: под tsx алиас "@/" не резолвится.
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// Prisma 7 требует драйверный адаптер — `new PrismaClient()` без него бросает. Тот же приём,
// что в scripts/seed.ts: клиент строится здесь, а не берётся из lib/db/client.ts, потому что
// тот кеширует соединение в globalThis для дев-сервера, а разовому скрипту это ни к чему.
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

/** Строка отчёта: что проверяли, что нашли, и надо ли вмешиваться. */
type Finding = { level: "ok" | "warn" | "stop"; title: string; detail: string };

const findings: Finding[] = [];

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  // Хост, но не пароль: перед боевым деплоем надо видеть, что подключились куда собирались.
  const host = url.replace(/^.*@/, "").replace(/\?.*$/, "") || "(DATABASE_URL не задан)";
  console.log(`Проверка базы: ${host}`);
  console.log("Скрипт только читает — ни одной записи не делает.\n");

  // 1. Кого удалит миграция saved_analysis_solution_fk.
  //
  // Тем же условием, что и она. `$queryRaw` намеренно: Prisma-фильтр по «нет такой строки в
  // другой таблице» выразил бы это иначе, а проверять надо ИМЕННО то, что выполнит миграция.
  const orphans = await prisma.$queryRaw<{ id: string; name: string; createdAt: Date }[]>`
    SELECT "id", "name", "createdAt" FROM "SavedAnalysis"
    WHERE "solutionId" NOT IN (SELECT "id" FROM "Solution")
    ORDER BY "createdAt"
  `;
  const total = await prisma.savedAnalysis.count();
  findings.push(
    orphans.length === 0
      ? {
          level: "ok",
          title: "Миграция saved_analysis_solution_fk никого не удалит",
          detail: `Всего сохранённых расчётов: ${total}. Строк с висящей ссылкой на решение: 0.`,
        }
      : {
          level: "stop",
          title: `Миграция УДАЛИТ ${orphans.length} сохранённых расчётов из ${total}`,
          detail:
            "Это не остановит деплой само по себе — такие строки всё равно не открываются, " +
            "getSolutionForCalc возвращает null и обе поверхности отвечают notFound(). Но " +
            "решение принимает владелец, а не миграция. Список ниже.\n" +
            orphans
              .map((o) => `      · «${o.name}» от ${o.createdAt.toISOString().slice(0, 10)}`)
              .join("\n"),
        }
  );

  // 2. Есть ли вообще что терять. Дамп нужен не «на всякий случай», а под конкретное число.
  const users = await prisma.user.count();
  findings.push({
    level: total > 0 || users > 0 ? "warn" : "ok",
    title: "Пользовательские данные в базе",
    detail:
      total > 0 || users > 0
        ? `Пользователей: ${users}, сохранённых расчётов: ${total}. Снимите дамп ПЕРЕД деплоем — ` +
          "миграции необратимы, а откат ветки данные не вернёт."
        : "База пуста — терять нечего.",
  });

  // 3. Допущения, которые сохранённые расчёты несут в себе, но которых в модели уже нет
  //    (и наоборот). Читатель отчёта увидит число, посчитанное по другому набору допущений,
  //    и ничто ему об этом не скажет, если ключи разошлись молча.
  const dbKeys = (await prisma.assumption.findMany({ select: { key: true } })).map((a) => a.key);
  const { DEFAULT_ASSUMPTIONS } = await import("../lib/economics/assumptions");
  const modelKeys = Object.keys(DEFAULT_ASSUMPTIONS);
  const missingInDb = modelKeys.filter((k) => !dbKeys.includes(k));
  const extraInDb = dbKeys.filter((k) => !modelKeys.includes(k));
  findings.push(
    missingInDb.length === 0 && extraInDb.length === 0
      ? {
          level: "ok",
          title: "Набор допущений в базе совпадает с моделью",
          detail: `${modelKeys.length} ключей.`,
        }
      : {
          level: "warn",
          title: "Допущения в базе разошлись с моделью",
          detail:
            `Нет в базе: ${missingInDb.join(", ") || "—"}. Лишние в базе: ${extraInDb.join(", ") || "—"}. ` +
            "Отсутствующие подставит `npm run db:seed`; до него расчёт возьмёт значение по умолчанию.",
        }
  );

  // 4. Обоснования допущений. З-2 писался ради того, чтобы на экране не было необъяснимых
  //    чисел; сев до недавнего времени не обновлял description на существующих строках, и
  //    боевая база вполне может нести пустые.
  const blank = await prisma.assumption.count({ where: { OR: [{ description: null }, { description: "" }] } });
  findings.push(
    blank === 0
      ? { level: "ok", title: "У всех допущений в базе есть обоснование", detail: "" }
      : {
          level: "warn",
          title: `${blank} допущений в базе без обоснования`,
          detail:
            "Панель читает обоснования из кода, поэтому на экране они появятся и так. Но копия " +
            "в базе отстала — догнать её `npm run db:seed` после деплоя.",
        }
  );

  // Итог.
  console.log("─".repeat(78));
  for (const f of findings) {
    const mark = f.level === "ok" ? "  OK  " : f.level === "warn" ? " ВНИМ " : " СТОП ";
    console.log(`[${mark}] ${f.title}`);
    if (f.detail) console.log(`         ${f.detail.replace(/\n/g, "\n         ")}`);
  }
  console.log("─".repeat(78));

  const stops = findings.filter((f) => f.level === "stop");
  if (stops.length > 0) {
    console.log(
      `\n${stops.length} пункт(ов) требуют решения владельца до деплоя. Скрипт ничего не изменил.`
    );
    // Ненулевой выход — чтобы `&&` в команде деплоя не поехал дальше сам собой.
    process.exitCode = 1;
  } else {
    console.log("\nБлокирующих пунктов нет. Дамп всё равно снимите: миграции необратимы.");
  }
}

main()
  .catch((e) => {
    console.error("Проверка не выполнена:", e);
    process.exitCode = 2;
  })
  .finally(() => prisma.$disconnect());
