import type { PrismaClient } from "@prisma/client";
import { formatRub } from "../lib/format/rub";
import { initialScenarios, shortProductName } from "../lib/projects/defaults";
import { insertProject } from "../lib/projects/queries";
import { loadLiveInputs, type LiveInputs } from "../lib/projects/recalc";
import { SCENARIO_NAME_MAX } from "../lib/projects/validate";
import { fx, unitShort, yearsNom } from "../lib/tz/econ/text";
import { applyDefaults } from "../lib/tz/params/schema";
import { processDef, processesForFacility } from "../lib/tz/processes";
import type { ParamValues, ProjectResults, ScenarioSpec } from "../lib/tz/types";

/**
 * Демо-проект склада с фиксированным id `demo-warehouse` — запасной путь жюри (ТЗ §4.2.7:
 * демонстрация на заранее загруженных данных; §8.2.6: демо-данные и тестовый сценарий).
 * Пересоздаётся при каждом севе: удаляется и создаётся заново на текущих данных каталога,
 * нормативов и описаний параметров. Владелец — демо-пользователь demo@demo.local; проект
 * помечен isDemo, поэтому серверные действия не дают его сохранить, пересчитать или удалить —
 * только скопировать (lib/projects/actions.ts).
 *
 * Воспроизводимость (ТЗ §5.6): проект строится ТЕМ ЖЕ путём, что «Новый проект» с источником
 * «Демо-данные организатора» (createProjectAction):
 * - параметры — `applyDefaults(описания параметров, {})`, то есть базовые значения датасета
 *   организатора;
 * - сценарии — `initialScenarios` из подбора (lib/projects/defaults.ts);
 * - расчёт, имитация и запись — `insertProject` (lib/projects/queries.ts).
 * Числа демо-проекта поэтому совпадают с тем, что получит член жюри, создав проект сам. Ни одно
 * число здесь не записано руками: сев печатает то, что посчитала модель.
 *
 * Вторая покупка управляется одной константой `DEMO_SECOND_PURCHASE` (решение владельца):
 * 'auto' — как у «Нового проекта» (следующий кандидат подбора); { slug } — закрепить продукт
 * каталога. Закреплённый вариант отличается от «Нового проекта» только сценарием p2.
 *
 * Импорты относительные: сев идёт через tsx, где алиас «@/» не нужен.
 */

/** Фиксированный id демо-проекта: на него ссылаются README, сценарий показа и документация. */
export const DEMO_PROJECT_ID = "demo-warehouse";

/** Владелец демо-проекта — демо-пользователь из scripts/seed-v2.ts (DEMO_ACCOUNTS). */
export const DEMO_PROJECT_OWNER = "demo@demo.local";

export const DEMO_PROJECT_NAME = "Склад организатора (демо)";
export const DEMO_OBJECT_NAME = "Распределительный центр — датасет организатора";

const FACILITY = "warehouse";

/** Какой продукт взять для второй покупки (сценарий p2) демо-проекта. */
export type DemoSecondPurchase = "auto" | { slug: string };

/**
 * Вторая покупка демо-проекта. 'auto' — как у «Нового проекта»: сценарии целиком выбирает
 * подбор, и демо-проект совпадает с проектом, созданным вручную на демо-данных. Чтобы
 * закрепить продукт (например, DMR Carrier P из «Примеров решений» организатора), укажите его
 * slug в каталоге: `{ slug: "dikom-dmr-carrier-p" }`.
 */
export const DEMO_SECOND_PURCHASE: DemoSecondPurchase = "auto";

/**
 * Интерактивная транзакция «удалить прежний проект → посчитать и записать новый» держит
 * расчёт с прогонами имитации внутри себя. Общий бюджет подборов минимального парка на проект —
 * 40 с (PROJECT_MIN_FLEET_BUDGET_MS) плюс основные прогоны, поэтому предел транзакции взят с
 * запасом; иначе Prisma закрыла бы её по умолчанию через 5 с.
 */
const TX_TIMEOUT_MS = 180_000;

/** Заголовок сценария, не длиннее SCENARIO_NAME_MAX (как в lib/projects/defaults.ts). */
function scenarioTitle(prefix: string, productName: string): string {
  const room = SCENARIO_NAME_MAX - prefix.length;
  const name =
    productName.length > room ? `${productName.slice(0, Math.max(1, room - 1)).trimEnd()}…` : productName;
  return `${prefix}${name}`;
}

/** Сценарии демо-проекта и предупреждение, если закрепить вторую покупку не удалось. */
export type DemoScenarios = { scenarios: ScenarioSpec[]; warning: string | null };

/**
 * Сценарии демо-проекта: сценарии «Нового проекта» (`initialScenarios`), а при закреплённой
 * второй покупке — те же сценарии с заменой p2. Если закрепить нельзя (продукта нет в
 * каталоге, он совпадает с первой покупкой или не закрывает процесс склада), остаются
 * сценарии по умолчанию и возвращается предупреждение — сев его печатает.
 */
export function demoScenarios(
  live: LiveInputs,
  params: ParamValues,
  choice: DemoSecondPurchase = DEMO_SECOND_PURCHASE,
): DemoScenarios {
  const common = { facility: FACILITY, params, paramDefs: live.paramDefs, products: live.products, norms: live.norms };
  const auto = initialScenarios(common);
  if (choice === "auto") return { scenarios: auto, warning: null };

  const keep = (why: string): DemoScenarios => ({
    scenarios: auto,
    warning: `вторая покупка «${choice.slug}» не закреплена: ${why} — оставлены сценарии по умолчанию`,
  });
  const product = live.products.find((p) => p.slug === choice.slug);
  if (!product) return keep("продукта нет в каталоге для расчёта");
  const p1 = auto.find((s) => s.key === "p1");
  if (p1?.items.some((i) => i.productSlug === product.slug)) return keep("это решение уже взято для первой покупки");

  // Процесс — тот же, что у первой покупки; без неё — первый процесс склада, который закрывает продукт.
  const facilityProcesses = processesForFacility(FACILITY).map((p) => p.slug);
  const process =
    p1?.items[0]?.process ?? facilityProcesses.find((slug) => product.processes.includes(slug)) ?? null;
  if (process === null || !product.processes.includes(process)) {
    return keep("продукт не закрывает процесс сценариев склада");
  }

  const others = auto.filter((s) => s.key !== "p2");
  let name = scenarioTitle("Покупка — ", shortProductName(product.name));
  // Название сценария уникально в проекте: при совпадении коротких названий берётся slug.
  if (others.some((s) => s.name === name)) name = scenarioTitle("Покупка — ", `${product.name} [${product.slug}]`);
  const p2: ScenarioSpec = { key: "p2", name, kind: "purchase", items: [{ process, productSlug: product.slug }] };
  return { scenarios: [...others, p2], warning: null };
}

/** Строки итога сева: по сценарию — главные числа модели, затем вывод. */
export function demoSummaryLines(results: ProjectResults): string[] {
  const lines: string[] = [];
  for (const r of results.results) {
    if (r.status !== "ok") {
      lines.push(`${r.name}: не рассчитан — ${r.refusal.message}`);
      continue;
    }
    if (r.kind === "asis") {
      lines.push(`${r.name}: OPEX ${formatRub(r.opexYearRub)}/год, TCO за ${yearsNom(r.tcoYears)} ${formatRub(r.tcoRub)}`);
      continue;
    }
    const fleet = r.items.map((i) => (i.n === null ? "—" : String(i.n))).join(" + ");
    const payback = r.paybackYears === null ? "не окупается" : `${fx(r.paybackYears, 1)} г.`;
    const sim = results.sim[r.key];
    const process = r.items[0] ? processDef(r.items[0].process) : undefined;
    const unit = unitShort(process?.throughputUnit ?? "ед./ч");
    const simText =
      sim === null || sim === undefined
        ? "имитация не выполнялась"
        : sim.verdict === "CONFIRMED"
          ? `имитация подтверждает расчёт: ${fx(sim.achievedPerH, 1)} из ${fx(sim.requiredPerH, 1)} ${unit}`
          : sim.verdict === "NOT_CONFIRMED"
            ? `имитация не подтверждает расчёт: ${fx(sim.achievedPerH, 1)} из ${fx(sim.requiredPerH, 1)} ${unit}`
            : "имитация не поддерживается";
    lines.push(
      `${r.name}: парк ${fleet}, CAPEX ${formatRub(r.capexRub)}, эффект ${formatRub(r.effectYearRub)}/год, ` +
        `окупаемость ${payback}, NPV ${formatRub(r.npvRub)}, TCO ${formatRub(r.tcoRub)}; ${simText}`,
    );
  }
  lines.push(`Вывод: ${results.conclusion.headline}`);
  return lines;
}

/**
 * Пересоздаёт демо-проект: удаляет прежний `demo-warehouse` (вместе с его сценариями и
 * журналом — каскадом) и создаёт новый на текущих данных. Удаление и запись идут в одной
 * транзакции: если расчёт упадёт, прежний проект останется на месте.
 *
 * Без аккаунта demo@demo.local или без продуктов склада в каталоге проект не создаётся —
 * сев печатает предупреждение и продолжает.
 */
export async function seedDemoProject(prisma: PrismaClient): Promise<void> {
  const tag = `  Демо-проект ${DEMO_PROJECT_ID}`;
  const owner = await prisma.user.findUnique({ where: { email: DEMO_PROJECT_OWNER }, select: { id: true } });
  if (!owner) {
    console.warn(`${tag}: пропущен — нет аккаунта ${DEMO_PROJECT_OWNER}`);
    return;
  }
  const live = await loadLiveInputs(prisma, FACILITY);
  if (live.products.length === 0) {
    console.warn(`${tag}: пропущен — в каталоге нет продуктов для склада (синхронизация данных не выполнена?)`);
    return;
  }

  // Тот же набор параметров, что у «Нового проекта» на демо-данных (createProjectAction).
  const params = applyDefaults(live.paramDefs, {});
  const { scenarios, warning } = demoScenarios(live, params);
  if (warning) console.warn(`${tag}: ${warning}`);

  const t0 = performance.now();
  const { results } = await prisma.$transaction(
    async (tx) => {
      await tx.project.deleteMany({ where: { id: DEMO_PROJECT_ID } });
      return insertProject(tx, live, {
        id: DEMO_PROJECT_ID,
        userId: owner.id,
        name: DEMO_PROJECT_NAME,
        objectName: DEMO_OBJECT_NAME,
        facility: FACILITY,
        params,
        paramsSource: { kind: "demo" },
        scenarios,
        isDemo: true,
      });
    },
    { maxWait: 10_000, timeout: TX_TIMEOUT_MS },
  );
  const seconds = (performance.now() - t0) / 1000;

  console.log(
    `${tag} («${DEMO_PROJECT_NAME}», владелец ${DEMO_PROJECT_OWNER}): пересоздан за ${fx(seconds, 1)} с ` +
      "(пересоздаётся при каждом севе и в итог изменений не входит) — " +
      `модель ${results.modelVersion}, имитация ${results.simModelVersion}, данные расчёта ${results.dataVersion}` +
      (live.paramDefsFrom === "code" ? "; описания параметров — из кода (таблица ParamDefinition пуста)" : ""),
  );
  for (const line of demoSummaryLines(results)) console.log(`    ${line}`);
}
