# План: потоки нагрузки

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Решение считается против той работы, которую делает, а не против единственного
`opsPerDay`. Робот-уборщик на складе перестаёт «замещать» сорок человек.

**Architecture:** Поток принадлежит **виду** решения (`SolutionCategory`), а не отдельной
модели: все паллетайзеры считаются одинаково. Спрос и делитель предела замещения выбираются по
потоку. Механизм A1 не переделывается — он получает правильную нагрузку.

**Tech Stack:** Prisma 7, Postgres, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-08-workload-streams-design.md`

## Global Constraints

- **ЭТА РАБОТА МЕНЯЕТ ВЫХОДНЫЕ ЧИСЛА.** Подписана владельцем 2026-09-08.
- **Меняются числа только у решений потока `FLOOR_AREA`** — это `class-cleaning` и
  `disinfection`. У остальных тринадцати категорий спрос и делитель прежние, значит их тесты
  обязаны остаться зелёными **без правок**. Упавший тест по `OPERATION_FLOW`-решению означает,
  что мы задели то, что трогать не собирались: остановиться и доложить.
- **Ветка `wizard-taxonomy`**, один коммит на задачу, хвост
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- **Vitest — `npx --yes vitest run < /dev/null`; перед e2e убивать сервер на :3000.**

---

### Задача 1: Тест-свидетель

**Files:**
- Create: `lib/economics/workload-streams.test.ts`

- [ ] **Шаг 1: Написать падающий тест**

```ts
import { describe, it, expect } from "vitest";
import { computeEconomics } from "./calculate";
import { makeAssumptions, makeParams } from "./fixtures";
import type { SolutionCapacity } from "./types";

// Класс «робот-уборщик» на складе: середина диапазона 700–4860 м²/час.
const cleaner: SolutionCapacity = {
  capacityPerUnit: 2780,
  capacityBasis: "PER_HOUR_FLOW",
  workloadStream: "FLOOR_AREA",
  priceUsd: 47500,
  maintenanceUsdYear: 3500,
  energyUsdYear: 900,
  licensingUsdYear: 1800,
};

describe("уборщик считается против площади, а не против потока заказов", () => {
  // Свидетель того, ради чего написана спека. До неё этот расчёт давал замещение сорока
  // человек и окупаемость 0,1 года: движок сравнивал 5000 отборов заказов в сутки с
  // 2780 м² уборки в час как одну и ту же величину.
  const params = makeParams({ areaM2: 10000, opsPerDay: 5000, staffCount: 40 });
  const r = computeEconomics(cleaner, params, makeAssumptions());

  it("замещает единицы человек, а не весь штат", () => {
    if (!("displacedFte" in r)) throw new Error("ожидался считаемый результат");
    expect(r.displacedFte).toBeLessThan(10);
    expect(r.displacedFte).toBeGreaterThan(1);
  });

  it("окупается за годы, а не за недели", () => {
    if (!("simplePaybackYears" in r)) throw new Error("ожидался экономичный результат");
    expect(r.simplePaybackYears).toBeGreaterThan(0.5);
  });
});

describe("решения потока операций не задеты", () => {
  it("замещение по-прежнему ограничено потоком операций", () => {
    const amr: SolutionCapacity = {
      capacityPerUnit: 95,
      capacityBasis: "PER_HOUR_FLOW",
      workloadStream: "OPERATION_FLOW",
      priceUsd: 87500,
      maintenanceUsdYear: 9000,
      energyUsdYear: 1500,
      licensingUsdYear: 4000,
    };
    const r = computeEconomics(amr, makeParams({ opsPerDay: 5000, staffCount: 40 }), makeAssumptions());
    if (!("displacedFte" in r)) throw new Error("ожидался считаемый результат");
    // 5000 × 250 / 12 500 = 100, ограничено штатом 40 — как и до этой спеки.
    expect(r.displacedFte).toBe(40);
  });
});
```

- [ ] **Шаг 2: Запустить и убедиться, что падает**

Запуск: `npx --yes vitest run lib/economics/workload-streams < /dev/null`
Ожидание: FAIL — поля `workloadStream` в типе нет.

---

### Задача 2: Модель

**Files:**
- Modify: `lib/economics/types.ts`, `lib/economics/normalize.ts`, `lib/economics/calculate.ts`,
  `lib/economics/assumptions.ts`, `lib/economics/fixtures.ts`

**Interfaces:**
- Produces: `type WorkloadStream = "OPERATION_FLOW" | "FLOOR_AREA"`;
  `SolutionCapacity.workloadStream: WorkloadStream`;
  `demandPerYear(params, a, stream)`; допущения `areaPerCleanerPerYear`, `cleaningsPerDay`.

- [ ] **Шаг 1: Спрос по потоку**

```ts
// lib/economics/normalize.ts
export function demandPerYear(
  params: FacilityParams,
  a: AssumptionValues,
  stream: WorkloadStream = "OPERATION_FLOW"
): number {
  // Значение по умолчанию — не удобство, а совместимость: тринадцать из пятнадцати категорий
  // считаются потоком операций, и их поведение обязано остаться прежним до знака.
  if (stream === "FLOOR_AREA") {
    return params.areaM2 * a.cleaningsPerDay * a.workingDaysPerYear;
  }
  return params.opsPerDay * a.workingDaysPerYear;
}

/** Сколько работы этого потока делает один человек за год. */
export function workerOutputPerYear(a: AssumptionValues, stream: WorkloadStream): number {
  return stream === "FLOOR_AREA" ? a.areaPerCleanerPerYear : a.opsPerWorkerPerYear;
}
```

- [ ] **Шаг 2: Предел замещения по потоку**

В `baseEconomics` заменить две строки:

```ts
  const stream = cap.workloadStream;
  const perWorker = workerOutputPerYear(a, stream);
  if (!(perWorker > 0)) return null;
  const maxDisplaceableFte = demandPerYear(params, a, stream) / perWorker;
```

и снять из общей проверки `!(a.opsPerWorkerPerYear > 0)`: делитель теперь зависит от потока,
и проверять надо тот, который используется, иначе решение потока площади падает в
`invalid_inputs` из-за допущения, которого не касается.

- [ ] **Шаг 3: Новые допущения**

```ts
areaPerCleanerPerYear: 600000,  // м²/год на одного уборщика — ПОРЯДОК ВЕЛИЧИНЫ (≈300 м²/час
                                // × 2000 часов), а не цитата. Помечается как оценка.
cleaningsPerDay: 1,             // без него площадь — разовая величина, а не поток
```

Границы в `ASSUMPTION_BOUNDS`: `areaPerCleanerPerYear` от 10 000 до 5 000 000;
`cleaningsPerDay` от **1** до 24 — ноль здесь делитель нагрузки обнуляет, а не «отключает
уборку».

- [ ] **Шаг 4: Тест-свидетель проходит, остальные не тронуты**

```bash
npx --yes vitest run < /dev/null
```
Ожидание: свидетель зелёный; **все существующие экономические тесты зелёные без правок**.
Правка теста по `OPERATION_FLOW`-решению — сигнал остановиться.

- [ ] **Шаг 5: Коммит**

```bash
git add lib
git commit -m "feat(economics): спрос и предел замещения берутся по потоку нагрузки

МЕНЯЕТ ЧИСЛА у решений потока FLOOR_AREA (уборка, дезинфекция). Подписано владельцем.

Механизм A1 не переделан — он всё это время работал исправно и получал не ту нагрузку.
demandPerYear возвращал opsPerDay × дни кем бы ни было решение, поэтому робот-уборщик
за \$47 500 «замещал» сорок складских сотрудников: движок сравнивал 5000 отборов
заказов в сутки с 2780 м² уборки в час как одну величину.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Задача 3: Схема, данные и остальные вызовы

**Files:**
- Modify: `prisma/schema.prisma`, `prisma/migrations/*`, `scripts/seed-data/categories.ts`,
  `scripts/seed.ts`, `lib/economics/normalize.ts` (`toSolutionCapacity`), `lib/db/queries.ts`

- [ ] **Шаг 1: Поле в схеме**

`SolutionCategory.workloadStream` — enum со значением по умолчанию `OPERATION_FLOW`, чтобы
существующие строки не требовали заполнения вручную.

- [ ] **Шаг 2: Миграция**

Пишется руками: добавление enum-типа и колонки с default. Затем **явный UPDATE** для двух
категорий — `class-cleaning` и `disinfection`. Именно они и меняют числа; всё остальное
остаётся `OPERATION_FLOW`.

- [ ] **Шаг 3: Протащить поток в проекцию**

`toSolutionCapacity()` берёт `workloadStream` из категории решения. Каждый вызов, который
строит `SolutionCapacity`, обязан его передать — компилятор перечислит их сам, потому что поле
не опционально.

- [ ] **Шаг 4: Сев**

Поток указывается у категории в `categories.ts`. Тест целостности: у каждой категории поток
задан явно, ни одна не полагается на значение по умолчанию — умолчание существует для
миграции, а не для авторов данных.

- [ ] **Шаг 5: Полный гейт**

```bash
lsof -ti:3000 | xargs kill -9 2>/dev/null
npx tsc --noEmit && npx --yes vitest run < /dev/null && npm run lint -- --max-warnings=0 \
  && npm run build && npx playwright test && npm run check:contrast && npm run check:sources
```

- [ ] **Шаг 6: Проверить экраном**

Открыть сравнение для склада с теми же параметрами (10 000 м², 5000 операций, 40 человек) и
убедиться: уборщик больше не лучший, окупаемость измеряется годами, а лучшим стало решение,
которое действительно обрабатывает поток заказов.

- [ ] **Шаг 7: Коммит и CHANGELOG**
