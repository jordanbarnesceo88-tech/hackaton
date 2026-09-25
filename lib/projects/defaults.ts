import { buildProjectModel, type BuildProjectModelInput } from "../tz/model";
import { processesForFacility } from "../tz/processes";
import type { ProductForCalc, ScenarioSpec, SelectionResult } from "../tz/types";
import { SCENARIO_NAME_MAX } from "./validate";

/**
 * Сценарии нового проекта по умолчанию (ТЗ §3.5.5: текущий процесс и два варианта
 * роботизации — «покупка и услуга»). Строятся из результатов подбора, а не из списка
 * «любимых» продуктов: рекомендуемое подбором решение берётся для покупки и услуги, следующий
 * кандидат того же процесса — для второй покупки.
 *
 * Для аэропорта и медучреждения форма та же: экономика их процессов в прототипе не
 * рассчитывается, поэтому сценарии роботизации получат отказ calc_not_supported с
 * объяснением (§5.7), но подбор, параметры и доступные решения показываются (§5.5).
 * Импорты относительные: модуль вызывают сев демо-проекта и скрипты через tsx.
 */

/** Сценарий «Как есть» — текущий процесс без роботов. */
export function asisScenario(): ScenarioSpec {
  return { key: "asis", name: "Как есть", kind: "asis", items: [] };
}

/**
 * Короткое название продукта для заголовка сценария: без хвоста в скобках, который каталог
 * добавляет к модели («Ronavi H1500 (грузоподъемность до 1 500 кг)» → «Ronavi H1500»).
 */
export function shortProductName(name: string): string {
  const s = name.replace(/\s*\([^()]*\)\s*$/, "").trim();
  return s !== "" ? s : name.trim();
}

/** Заголовок сценария, не длиннее SCENARIO_NAME_MAX символов. */
function title(prefix: string, productName: string): string {
  const room = SCENARIO_NAME_MAX - prefix.length;
  const name = productName.length > room ? `${productName.slice(0, Math.max(1, room - 1)).trimEnd()}…` : productName;
  return `${prefix}${name}`;
}

type Choice = { process: string; slug: string; name: string };

/**
 * Лучший процесс для сценариев по умолчанию и его решения в порядке подбора: сначала процесс
 * объекта, где подбор что-то рекомендовал, иначе первый процесс с кандидатами.
 */
function poolOf(selection: readonly SelectionResult[], facility: string): Choice[] {
  const order = processesForFacility(facility).map((p) => p.slug);
  for (const r of selection) if (!order.includes(r.process)) order.push(r.process);
  const usable = (process: string) =>
    selection
      .filter((r) => r.process === process && (r.status === "recommended" || r.status === "candidate"))
      .map((r) => ({ process, slug: r.productSlug, name: r.productName }));
  for (const process of order) {
    if (selection.some((r) => r.process === process && r.status === "recommended")) return usable(process);
  }
  for (const process of order) {
    const pool = usable(process);
    if (pool.length > 0) return pool;
  }
  return [];
}

/**
 * Сценарии по умолчанию: «Как есть» (asis); «Покупка — {лучшее решение}» (p1); «Услуга (RaaS)
 * — {лучшее решение}» (r1) — если у лучшего решения нет ставки RaaS, берётся следующий
 * кандидат со ставкой, а если ставки нет ни у кого, остаётся лучшее решение и расчёт
 * объяснит, какое поле заполнить; «Покупка — {второе решение}» (p2), если оно есть. Всегда не
 * меньше трёх сценариев: без кандидатов сценарии роботизации создаются без решения, и
 * расчёт просит выбрать продукт.
 *
 * `products` нужны, чтобы узнать ставку RaaS; решения, которых в списке нет, считаются без
 * ставки.
 */
export function defaultScenarios(
  selection: readonly SelectionResult[],
  facility: string,
  products: readonly ProductForCalc[],
): ScenarioSpec[] {
  const bySlug = new Map(products.map((p) => [p.slug, p]));
  const pool = poolOf(selection, facility);
  const top = pool[0];
  const specs: ScenarioSpec[] = [asisScenario()];
  if (!top) {
    specs.push(
      { key: "p1", name: "Покупка — решение не выбрано", kind: "purchase", items: [] },
      { key: "r1", name: "Услуга (RaaS) — решение не выбрано", kind: "raas", items: [] },
    );
    return specs;
  }
  const hasRate = (slug: string) => {
    const rate = bySlug.get(slug)?.raasRubMonth;
    return typeof rate === "number" && Number.isFinite(rate) && rate > 0;
  };
  const raas = hasRate(top.slug) ? top : (pool.find((p) => hasRate(p.slug)) ?? top);
  const second = pool.find((p) => p.slug !== top.slug);

  const names = new Map<string, string>();
  const nameOf = (p: Choice) => names.get(p.slug) ?? shortProductName(p.name);
  // Короткие названия двух разных решений совпали — берутся полные, чтобы заголовки
  // сценариев различались (название сценария уникально в проекте).
  if (second && shortProductName(second.name) === shortProductName(top.name)) {
    names.set(top.slug, top.name);
    names.set(second.slug, second.name === top.name ? `${second.name} [${second.slug}]` : second.name);
  }

  const item = (p: Choice) => [{ process: p.process, productSlug: p.slug }];
  specs.push(
    { key: "p1", name: title("Покупка — ", nameOf(top)), kind: "purchase", items: item(top) },
    { key: "r1", name: title("Услуга (RaaS) — ", nameOf(raas)), kind: "raas", items: item(raas) },
  );
  if (second) specs.push({ key: "p2", name: title("Покупка — ", nameOf(second)), kind: "purchase", items: item(second) });
  return specs;
}

/**
 * Сценарии по умолчанию для объекта с заданными параметрами: подбор выполняется пробной
 * сборкой модели с одним сценарием «Как есть», затем из его результатов строится набор
 * `defaultScenarios`. Чистая функция — её вызывают создание проекта, гостевой /demo и сев.
 */
export function initialScenarios(input: Omit<BuildProjectModelInput, "scenarios" | "sims">): ScenarioSpec[] {
  const probe = buildProjectModel({ ...input, scenarios: [asisScenario()] });
  return defaultScenarios(probe.selection, input.facility, input.products);
}
