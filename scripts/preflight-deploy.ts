// Что случится с БОЕВОЙ базой при следующем `prisma migrate deploy` + `npm run db:seed` — до
// того, как они побегут.
//
// Поводом стала миграция 20260903172455_saved_analysis_solution_fk: она содержит
// `DELETE FROM "SavedAnalysis"` и на боевой ещё НЕ ПРИМЕНЯЛАСЬ (прод отстаёт примерно на
// двадцать пять коммитов). Логика удаления защитима — строка, чей solutionId никуда не ведёт, не
// открывается ни отчётом, ни калькулятором, — но применять её вслепую нельзя: «сколько строк
// исчезло» после факта узнать неоткуда.
//
// С тех пор скрипт вырос: сев тоже ни разу не бежал по НЕПУСТОЙ боевой, а он удаляет решения,
// перезаписывает значения допущений и падает на строках, которых сам не заводил. Всё, что об
// этом можно узнать заранее, узнаётся здесь.
//
// Скрипт ТОЛЬКО ЧИТАЕТ. Ни одной записи, ни одного DDL. Запускать против боевой строки
// подключения ПЕРЕД деплоем — по ПРЯМОЙ (не pooler) строке, той же, что пойдёт в миграции:
//
//   DATABASE_URL="<боевой ПРЯМОЙ url>" npx tsx scripts/preflight-deploy.ts
//
// ВАЖНО ПРО СХЕМУ. Боевая отстаёт, значит половины колонок этой ветки в ней нет. Типизированный
// клиент Prisma собран по НОВОЙ схеме и на старой базе упал бы на первом же `select` — поэтому
// всё, что касается изменившихся таблиц, читается через $queryRaw и только после проверки в
// information_schema, что колонка вообще существует.
//
// RELATIVE import: под tsx алиас "@/" не резолвится.
import "dotenv/config";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { VENDOR_SOLUTIONS } from "./seed-data/vendor-solutions";
import { SOLUTION_CLASSES } from "./seed-data/solution-classes";
import { CATEGORIES } from "./seed-data/categories";
import { WAREHOUSE_REAL } from "./parse-sources/warehouse-real";

// Prisma 7 требует драйверный адаптер — `new PrismaClient()` без него бросает. Тот же приём,
// что в scripts/seed.ts: клиент строится здесь, а не берётся из lib/db/client.ts, потому что
// тот кеширует соединение в globalThis для дев-сервера, а разовому скрипту это ни к чему.
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

/** Строка отчёта: что проверяли, что нашли, и надо ли вмешиваться. */
type Finding = { level: "ok" | "warn" | "stop"; title: string; detail: string };

const findings: Finding[] = [];
const add = (f: Finding) => findings.push(f);

async function hasTable(name: string): Promise<boolean> {
  const r = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT count(*) AS n FROM information_schema.tables
    WHERE table_schema = current_schema() AND table_name = ${name}`;
  return Number(r[0]?.n ?? 0) > 0;
}

async function hasColumn(table: string, column: string): Promise<boolean> {
  const r = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT count(*) AS n FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = ${table} AND column_name = ${column}`;
  return Number(r[0]?.n ?? 0) > 0;
}

/** Имена решений, объявленные всеми тремя источниками сева, и категория каждого. */
function seedSources() {
  const byName = new Map<string, string>();
  for (const s of VENDOR_SOLUTIONS) byName.set(s.name, s.categorySlug);
  for (const c of SOLUTION_CLASSES) byName.set(c.name, c.categorySlug);
  for (const s of WAREHOUSE_REAL) byName.set(s.name, s.categorySlug);
  return byName;
}

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  // Хост, но не пароль: перед боевым деплоем надо видеть, что подключились куда собирались.
  const host = url.replace(/^.*@/, "").replace(/\?.*$/, "") || "(DATABASE_URL не задан)";
  console.log(`Проверка базы: ${host}`);
  console.log("Скрипт только читает — ни одной записи не делает.\n");

  // 0. Прямая строка или pooler. `prisma migrate deploy` берёт advisory lock, а транзакционный
  //    пул его теряет: миграция зависает или падает на середине. Проверять это ПОСЛЕ того, как
  //    она упала, поздно, а перепутать две строки подключения — самая дешёвая из ошибок.
  add(
    /-pooler|pgbouncer/i.test(host)
      ? {
          level: "warn",
          title: "Подключение похоже на POOLED (pooler в хосте)",
          detail:
            "Миграции обязаны идти по ПРЯМОЙ строке: `migrate deploy` берёт advisory lock, а " +
            "транзакционный пул его роняет. Приложение — наоборот, на пуле. Перепроверьте, что " +
            "в команде миграции стоит direct URL.",
        }
      : { level: "ok", title: "Подключение не похоже на pooled", detail: "Для миграций это верная строка." }
  );

  // 1. Состояние миграций. Что уже применено, что побежит, и нет ли ЗАСТРЯВШЕЙ — с ней
  //    `migrate deploy` вообще откажется работать (P3009) и деплой упадёт, ничего не сделав.
  const onDisk = readdirSync(join(import.meta.dirname, "..", "prisma", "migrations"), {
    withFileTypes: true,
  })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  if (!(await hasTable("_prisma_migrations"))) {
    add({
      level: "warn",
      title: "Таблицы _prisma_migrations нет — база не под управлением Prisma",
      detail:
        `На диске ${onDisk.length} миграций, применится всё. Если база НЕ пустая, это значит, ` +
        "что схему заводили мимо Prisma, и первая же миграция упадёт на существующей таблице.",
    });
  } else {
    const applied = await prisma.$queryRaw<
      { migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }[]
    >`SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations" ORDER BY started_at`;
    const stuck = applied.filter((m) => m.finished_at === null && m.rolled_back_at === null);
    const ok = new Set(applied.filter((m) => m.finished_at !== null).map((m) => m.migration_name));
    const pending = onDisk.filter((n) => !ok.has(n));

    if (stuck.length > 0) {
      add({
        level: "stop",
        title: `${stuck.length} миграция(й) в базе застряли незавершёнными`,
        detail:
          "`prisma migrate deploy` откажется бежать (P3009) и деплой упадёт, не сделав ничего. " +
          "Разобрать вручную (`prisma migrate resolve`) ДО деплоя:\n" +
          stuck.map((m) => `      · ${m.migration_name}`).join("\n"),
      });
    }
    add(
      pending.length === 0
        ? { level: "ok", title: "Все миграции уже применены", detail: `${ok.size} шт.` }
        : {
            level: "warn",
            title: `Побежит ${pending.length} миграция(й)`,
            detail:
              "В этом порядке:\n" +
              pending.map((n) => `      · ${n}`).join("\n") +
              "\nПока они идут, старая сборка на боевой читает СТАРУЮ схему, а новая — новую. " +
              "Совместимой точки между ними нет (global_categories удаляет колонку), поэтому " +
              "окно недоступности неизбежно: см. docs/DEPLOY.md, шаг 3.",
          }
    );

    // 1a. Отдельно — самая опасная из них. global_categories сливает категории по slug и
    //     ПАДАЕТ С ИСКЛЮЧЕНИЕМ, если слияние сталкивает два решения с одинаковым именем в одну
    //     категорию (на Solution висит @@unique([solutionCategoryId, name])). Условие
    //     воспроизводится здесь дословно — это единственный способ узнать заранее.
    if (pending.some((n) => n.endsWith("_global_categories")) && (await hasColumn("SolutionCategory", "facilityTypeId"))) {
      const conflicts = await prisma.$queryRaw<{ canonical_id: string; name: string; n: bigint }[]>`
        WITH canon AS (
          SELECT slug, MIN(id) AS canonical_id FROM "SolutionCategory" GROUP BY slug
        )
        SELECT c.canonical_id, s.name, count(*) AS n
        FROM "Solution" s
        JOIN "SolutionCategory" sc ON sc.id = s."solutionCategoryId"
        JOIN canon c ON c.slug = sc.slug
        GROUP BY c.canonical_id, s.name
        HAVING count(*) > 1
        ORDER BY count(*) DESC`;
      add(
        conflicts.length === 0
          ? {
              level: "ok",
              title: "Слияние категорий (global_categories) пройдёт без конфликтов",
              detail: "Ни одно имя решения не дублируется внутри будущей объединённой категории.",
            }
          : {
              level: "stop",
              title: `global_categories ОСТАНОВИТ деплой: ${conflicts.length} конфликт(ов) имён`,
              detail:
                "Миграция бросает RAISE EXCEPTION и откатывается целиком — деплой не состоится, " +
                "база останется как есть. Разрешить дубли отдельной миграцией данных ДО выката. " +
                "Пары (объединённая категория, имя решения):\n" +
                conflicts
                  .map((c) => `      · «${c.name}» × ${Number(c.n)} → категория ${c.canonical_id}`)
                  .join("\n"),
            }
      );
    }
  }

  // Дальше всё читает данные. На ПУСТОЙ базе (первый деплой в новый инстанс) этих таблиц ещё
  // нет, и каждый запрос ниже упал бы ошибкой Postgres вместо ответа. Пустая база — законное
  // состояние, и правильный ответ на неё «проверять нечего», а не стектрейс.
  const core = ["Solution", "SolutionCategory", "SavedAnalysis", "Assumption", "FacilityExample"];
  const absent: string[] = [];
  for (const t of core) if (!(await hasTable(t))) absent.push(t);
  if (absent.length > 0) {
    add({
      level: "warn",
      title: "База ещё не развёрнута — проверять нечего",
      detail:
        `Нет таблиц: ${absent.join(", ")}. Это нормально для первого деплоя в чистый инстанс: ` +
        "`prisma migrate deploy` создаст всё с нуля, сев заполнит, терять нечего. Остальные " +
        "проверки пропущены — им нужны данные.",
    });
    report();
    return;
  }

  // 2. Кого удалит миграция saved_analysis_solution_fk.
  //
  // Тем же условием, что и она. `$queryRaw` намеренно: Prisma-фильтр по «нет такой строки в
  // другой таблице» выразил бы это иначе, а проверять надо ИМЕННО то, что выполнит миграция.
  const orphans = await prisma.$queryRaw<{ id: string; name: string; createdAt: Date }[]>`
    SELECT "id", "name", "createdAt" FROM "SavedAnalysis"
    WHERE "solutionId" NOT IN (SELECT "id" FROM "Solution")
    ORDER BY "createdAt"
  `;
  const total = await prisma.savedAnalysis.count();
  add(
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

  // 3. Есть ли вообще что терять. Дамп нужен не «на всякий случай», а под конкретное число.
  const users = await prisma.user.count();
  add({
    level: total > 0 || users > 0 ? "warn" : "ok",
    title: "Пользовательские данные в базе",
    detail:
      total > 0 || users > 0
        ? `Пользователей: ${users}, сохранённых расчётов: ${total}. Снимите дамп ПЕРЕД деплоем — ` +
          "миграции необратимы, а откат ветки данные не вернёт."
        : "База пуста — терять нечего.",
  });

  // 4. ЧИСТКА СЕВА. Единственное необратимое действие `npm run db:seed`: решения, чьих имён нет
  //    ни в одном источнике этой ветки, удаляются. На боевой, которую этот сев видит впервые,
  //    «нет в источниках» означает «весь каталог, заведённый двадцать пять коммитов назад»,
  //    а не «пара заглушек». Здесь считается точное число и печатается поимённо.
  const sources = seedSources();
  type Row = {
    id: string;
    name: string;
    vendor: string;
    source: string;
    slug: string;
    refs: bigint;
  };
  const rows = await prisma.$queryRaw<Row[]>`
    SELECT s."id", s."name", s."vendor", s."source"::text AS source, sc."slug" AS slug,
           (SELECT count(*) FROM "SavedAnalysis" sa WHERE sa."solutionId" = s."id") AS refs
    FROM "Solution" s
    JOIN "SolutionCategory" sc ON sc.id = s."solutionCategoryId"
    ORDER BY s."name"`;

  const stale = rows.filter((r) => (r.source === "SEED" || r.source === "PARSED") && !sources.has(r.name));
  const deletable = stale.filter((r) => Number(r.refs) === 0);
  const kept = stale.filter((r) => Number(r.refs) > 0);
  const pruneLimit = Number(process.env.SEED_PRUNE_LIMIT ?? 10);
  add(
    deletable.length === 0
      ? {
          level: "ok",
          title: "Чистка сева ничего не удалит",
          detail: `Решений в базе: ${rows.length}. Ни одно не выпало из источников.`,
        }
      : {
          level: "stop",
          title: `Чистка сева УДАЛИТ ${deletable.length} решений из ${rows.length}`,
          detail:
            `Сев удаляет строки source ∈ (SEED, PARSED), чьих имён нет ни в VENDOR_SOLUTIONS, ни ` +
            `в SOLUTION_CLASSES, ни в WAREHOUSE_REAL. Порог предохранителя — ${pruneLimit}: выше него ` +
            `сев остановится сам и потребует SEED_PRUNE=force или SEED_PRUNE=off. Список:\n` +
            deletable.map((r) => `      · [${r.source}] «${r.name}» (${r.vendor}) из ${r.slug}`).join("\n"),
        }
  );
  if (kept.length > 0) {
    add({
      level: "warn",
      title: `${kept.length} устаревших решений останутся: на них ссылаются расчёты`,
      detail:
        "Их не удалит ничто, но и не обновит ни один источник: цена и производительность в них " +
        "заморожены навсегда, а на экране они неотличимы от актуальных.\n" +
        kept.map((r) => `      · «${r.name}» (${r.vendor}), ссылок ${Number(r.refs)}`).join("\n"),
    });
  }

  // 5. Строки организатора. Чистка их не трогает (фильтр по source) — это проверено, — но
  //    оператор должен видеть, что в каталоге есть строки, которых нет ни в одном источнике и
  //    которые сев никогда не обновит.
  const organizer = rows.filter((r) => r.source === "ORGANIZER");
  add({
    level: organizer.length > 0 ? "warn" : "ok",
    title:
      organizer.length > 0
        ? `${organizer.length} строк ORGANIZER — чистка их НЕ удалит`
        : "Строк ORGANIZER в базе нет",
    detail:
      organizer.length > 0
        ? "Проверено по условию чистки: она отбирает только SEED и PARSED. Но сев их и не " +
          "обновляет, а слияние категорий (если оно ещё впереди) считает их наравне с " +
          "остальными при проверке на конфликт имён.\n" +
          organizer.map((r) => `      · «${r.name}» (${r.vendor}) в ${r.slug}`).join("\n")
        : "",
  });

  // 6. М-2 в цифрах: строки, чьё имя источники знают, но лежат они в ДРУГОЙ категории. Чистка
  //    сверяет только имена и такую строку не тронет, а upsert (ключ — категория+имя) заведёт
  //    рядом вторую. Итог — дубликат, из которого обновляется ровно один.
  const misplaced = rows.filter((r) => sources.has(r.name) && sources.get(r.name) !== r.slug);
  add(
    misplaced.length === 0
      ? { level: "ok", title: "Дубликатов от переезда между категориями не будет", detail: "" }
      : {
          level: "stop",
          title: `Сев СОЗДАСТ ${misplaced.length} дубликат(ов) решений`,
          detail:
            "Имя есть в источнике, но строка лежит в другой категории: чистка её не видит " +
            "(сверяет имена), upsert заведёт вторую в правильной категории. Обе окажутся в " +
            "каталоге, обновляться будет только новая (М-2).\n" +
            misplaced
              .map((r) => `      · «${r.name}»: в базе ${r.slug}, источник кладёт в ${sources.get(r.name)}`)
              .join("\n"),
        }
  );

  // 7. Категории, которых нет в источнике. Сев их не заводит и не удаляет, а миграция
  //    category_task_labour даёт им taskLabel = '' — то есть безымянную строку на экране
  //    сравнения задач. До правки сев на этом ещё и ПАДАЛ (проверка сканировала всю таблицу).
  if (await hasColumn("SolutionCategory", "slug")) {
    const srcSlugs = new Set(CATEGORIES.map((c) => c.slug));
    const dbCats = await prisma.$queryRaw<{ slug: string; n: bigint }[]>`
      SELECT sc."slug" AS slug, count(s."id") AS n
      FROM "SolutionCategory" sc
      LEFT JOIN "Solution" s ON s."solutionCategoryId" = sc."id"
      GROUP BY sc."slug" ORDER BY sc."slug"`;
    const foreign = dbCats.filter((c) => !srcSlugs.has(c.slug));
    add(
      foreign.length === 0
        ? { level: "ok", title: "Все категории базы есть в источнике сева", detail: `${dbCats.length} шт.` }
        : {
            level: "warn",
            title: `${foreign.length} категорий есть в базе, но нет в источнике`,
            detail:
              "Сев их не заводит и не удаляет. После миграции у них taskLabel = '' — экран " +
              "сравнения задач покажет безымянную строку, а поток нагрузки останется " +
              "OPERATION_FLOW (миграция ставит FLOOR_AREA только двум известным slug'ам). " +
              "Решение — за оператором: либо перенести их решения в актуальную категорию, либо " +
              "снять привязки к типам объектов.\n" +
              foreign.map((c) => `      · ${c.slug} (решений ${Number(c.n)})`).join("\n"),
          }
    );
  }

  // 8. Допущения, которые сохранённые расчёты несут в себе, но которых в модели уже нет
  //    (и наоборот). Читатель отчёта увидит число, посчитанное по другому набору допущений,
  //    и ничто ему об этом не скажет, если ключи разошлись молча.
  const dbAssumptions = await prisma.assumption.findMany({
    select: { key: true, value: true, description: true },
  });
  const dbKeys = dbAssumptions.map((a) => a.key);
  const { DEFAULT_ASSUMPTIONS } = await import("../lib/economics/assumptions");
  const modelKeys = Object.keys(DEFAULT_ASSUMPTIONS);
  const missingInDb = modelKeys.filter((k) => !dbKeys.includes(k));
  const extraInDb = dbKeys.filter((k) => !modelKeys.includes(k));
  add(
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
            "Отсутствующие подставит `npm run db:seed`; до него расчёт возьмёт значение по " +
            "умолчанию. Лишние сев не удаляет и движок не читает — они безвредны, но выглядят " +
            "как действующие допущения для всякого, кто откроет таблицу.",
        }
  );

  // 8a. КАКИЕ ЧИСЛА ИЗМЕНЯТСЯ. Строка в базе перекрывает умолчание кода на чтении, поэтому сев
  //     не «досыпает недостающее», а переписывает значения. Это и есть смысл выката (ставка
  //     труда 15 → 6,7 меняет КАЖДОЕ число на экране), но оператор обязан увидеть список до, а
  //     не узнать по вопросу на показе.
  const changing = dbAssumptions
    .filter((a) => modelKeys.includes(a.key))
    .map((a) => ({ key: a.key, from: a.value, to: DEFAULT_ASSUMPTIONS[a.key as keyof typeof DEFAULT_ASSUMPTIONS] }))
    .filter((d) => d.from !== d.to);
  add(
    changing.length === 0
      ? { level: "ok", title: "Сев не изменит ни одного значения допущения", detail: "" }
      : {
          level: "warn",
          title: `Сев ПЕРЕПИШЕТ ${changing.length} значений допущений`,
          detail:
            "Каждое из них участвует в каждом расчёте: после сева все показываемые числа " +
            "изменятся, включая уже сохранённые расчёты, которые пересчитываются на чтении. " +
            "Оставить боевые значения и обновить только подписи с обоснованиями: " +
            "`SEED_KEEP_ASSUMPTION_VALUES=1 npm run db:seed`.\n" +
            changing.map((d) => `      · ${d.key}: ${d.from} → ${d.to}`).join("\n"),
        }
  );

  // 9. Обоснования допущений. З-2 писался ради того, чтобы на экране не было необъяснимых
  //    чисел; сев до недавнего времени не обновлял description на существующих строках, и
  //    боевая база вполне может нести пустые.
  const blank = dbAssumptions.filter((a) => !a.description).length;
  add(
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

  // 10. Типовые параметры. На (facilityTypeId, name) нет уникального индекса, а getTypicalParams
  //     берёт `take: 1` без сортировки. Две строки «Типовой объект» на один тип объекта — это
  //     недетерминированный старт визарда, и заводит их только сев, который делал безусловный
  //     `create`. Если такие есть, они уже есть.
  const dupExamples = await prisma.$queryRaw<{ slug: string; n: bigint }[]>`
    SELECT ft."slug" AS slug, count(*) AS n
    FROM "FacilityExample" fe
    JOIN "FacilityType" ft ON ft."id" = fe."facilityTypeId"
    WHERE fe."name" = 'Типовой объект'
    GROUP BY ft."slug" HAVING count(*) > 1 ORDER BY count(*) DESC`;
  add(
    dupExamples.length === 0
      ? { level: "ok", title: "Типовые параметры не задвоены", detail: "" }
      : {
          level: "warn",
          title: `${dupExamples.length} типов объектов имеют по нескольку «Типовой объект»`,
          detail:
            "Визард читает одну из них без сортировки — какую именно, не определено. Сев теперь " +
            "обновляет все, но лишние надо удалить вручную.\n" +
            dupExamples.map((d) => `      · ${d.slug}: ${Number(d.n)} строк`).join("\n"),
        }
  );

  report();
}

function report() {
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
