import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { paramSpecsFor } from "../../data/organizer/params";
import { projectSnapshotModel } from "../../projects/archive";
import { buildProjectModel } from "../../tz/model";
import { FIXTURE_PRODUCTS, fixtureContext, fixtureSpecs } from "../../tz/econ/fixtures";
import { defaultPilotPlan, buildPilotBudget, parsePilotPlanInput } from "../../tz/pilot-budget";
import type { ProjectResults, RaasPackage } from "../../tz/types";
import { projectCsv } from "./csv";
import { buildProjectXlsx } from "./xlsx";
import { fixtureResults } from "./test-fixtures";

const included = { mode: "included" } as const;
const scope: RaasPackage = { firstMonthRub: 250000, startup: { mode: "separate", amountRub: 80000, basis: "per-site" },
  platform: { mode: "separate", amountRub: 12200, basis: "per-site" }, service: included,
  consumables: { mode: "separate", amountRub: 24000, basis: "per-robot" }, repair: included,
  battery: { mode: "separate", amountRub: 90000, basis: "per-robot", everyYears: 2 },
  reason: "Тестовая оценка первого месяца, платформы и отдельной замены АКБ; это не договор" };
function example() {
  const ctx = fixtureContext(), scenarios = fixtureSpecs();
  scenarios[2]!.items[0] = { ...scenarios[2]!.items[0]!, quantityOverride: 3, chargersOverride: 1, raasRubMonthOverride: 185000, raasPackage: scope };
  return buildProjectModel({ facility: "warehouse", params: ctx.params, norms: ctx.norms, products: FIXTURE_PRODUCTS, paramDefs: paramSpecsFor("warehouse"), scenarios });
}
async function workbook(input: Parameters<typeof buildProjectXlsx>[0]) {
  const bytes = await buildProjectXlsx(input), buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  const book = new ExcelJS.Workbook(); await book.xlsx.load(buffer); return book;
}

describe("RaaS scope in pilot and exported snapshots", () => {
  it("costs the pilot's own fleet and whole months, counts first month once and startup only once", () => {
    const model = example(), plan = defaultPilotPlan(model, "r1");
    expect(plan.fleet).toBe(2); expect(plan.costs.setup.valueRub).toBe(80000);
    expect(plan.costs.integration.valueRub).toBe(0); expect(plan.costs.training.valueRub).toBe(0);
    plan.durationDays = 45; plan.dayBasis = "calendar";
    const budget = buildPilotBudget(model, "r1", plan);
    const amount = (key: string) => budget.lines.find(line => line.key === key)!.valueRub;
    expect(budget.subscriptionMonths).toBe(2);
    expect(amount("equipment")).toBe(2 * 185000 * 2);
    expect(amount("firstMonthPremium")).toBe(2 * 65000);
    expect(amount("equipment")! + amount("firstMonthPremium")!).toBe(2 * (250000 + 185000));
    expect(amount("platform")).toBe(12200 * 2);
    expect(amount("setup")).toBe(80000);
    expect(amount("consumables")).toBe(2 * 24000 * 2 / 12);
    expect(amount("battery")).toBe(0);
    expect(budget.lines.find(line => line.key === "consumables")!.formula).toContain("не договорный график");
    expect(budget.fullFleet).toBe(3);
  });

  it("switching a purchase pilot to RaaS uses that RaaS quote's tariff and scope, never the purchase/catalog rate", () => {
    const model = example(), plan = defaultPilotPlan(model, "p1", "raas");
    const budget = buildPilotBudget(model, "p1", plan);
    expect(budget.lines.find(line => line.key === "equipment")!.valueRub).toBe(plan.fleet * 185000);
    expect(budget.lines.find(line => line.key === "firstMonthPremium")!.valueRub).toBe(plan.fleet * 65000);
    expect(plan.costs.setup.valueRub).toBe(80000);
  });

  it.each(["tz-1.0.0", "tz-1.0.8", "unknown"])("preserves the historical cross-acquisition pilot tariff for %s", version => {
    const model = example(); model.modelVersion = version;
    model.scenarios.find(row => row.key === "p1")!.items[0]!.raasRubMonthOverride = 100000;
    const before = structuredClone(model), plan = defaultPilotPlan(model, "p1", "raas");
    plan.fleet = 2;
    const budget = buildPilotBudget(model, "p1", plan);
    expect(budget.lines.find(line => line.key === "equipment")!.valueRub).toBe(200000);
    expect(budget.lines.some(line => line.key === "firstMonthPremium")).toBe(false);
    expect(plan.costs.setup.valueRub).toBeNull();
    expect(model).toEqual(before);
  });

  it.each(["tz-1.0.9", "tz-1.0.10", "tz-1.1.0", "tz-2.0.0"])("uses explicit matching quote pricing for %s without lexical version ordering", version => {
    const model = example(); model.modelVersion = version;
    model.scenarios.find(row => row.key === "p1")!.items[0]!.raasRubMonthOverride = 100000;
    const plan = defaultPilotPlan(model, "p1", "raas"); plan.fleet = 2;
    const budget = buildPilotBudget(model, "p1", plan);
    expect(budget.lines.find(line => line.key === "equipment")!.valueRub).toBe(370000);
    expect(budget.lines.find(line => line.key === "firstMonthPremium")!.valueRub).toBe(130000);
  });

  it("requires an explicit first month for a pilot's own quote, without mixing it with the source premium", () => {
    const model = example(), before = structuredClone(model), plan = defaultPilotPlan(model, "r1");
    plan.equipmentUnitRubOverride = 300000;
    expect(() => buildPilotBudget(model, "r1", plan)).toThrow(/собственной ставки.*первого месяца/);
    plan.raasFirstMonthRubOverride = 400000; plan.durationDays = 45; plan.dayBasis = "calendar";
    const parsed = parsePilotPlanInput(JSON.parse(JSON.stringify(plan)));
    expect(parsed.raasFirstMonthRubOverride).toBe(400000);
    const budget = buildPilotBudget(model, "r1", parsed);
    expect(budget.lines.find(line => line.key === "equipment")!.valueRub).toBe(1200000);
    expect(budget.lines.find(line => line.key === "firstMonthPremium")!.valueRub).toBe(200000);
    expect(budget.lines.find(line => line.key === "platform")!.source).toContain("только как оценка");
    expect(budget.lines.find(line => line.key === "firstMonthPremium")!.source).toContain("Собственная оценка");
    expect(model).toEqual(before);
    plan.raasFirstMonthRubOverride = 250000;
    expect(() => buildPilotBudget(model, "r1", plan)).toThrow(/скидки первого месяца/);
    plan.equipmentUnitRubOverride = 185000; delete plan.raasFirstMonthRubOverride;
    expect(buildPilotBudget(model, "r1", plan).lines.find(line => line.key === "firstMonthPremium")!.valueRub).toBe(130000);
  });

  it("rejects invalid first-month input and persists a separate first month without a production package", () => {
    const model = example(), plan = defaultPilotPlan(model, "r1");
    for (const value of [-1, 0, Infinity, 1e12 + 1, "300000"]) expect(() => parsePilotPlanInput({ ...plan, raasFirstMonthRubOverride: value })).toThrow();
    expect(() => parsePilotPlanInput({ ...plan, acquisition: "purchase", raasFirstMonthRubOverride: 300000 })).toThrow(/неприменим/);
    delete model.scenarios.find(row => row.key === "r1")!.items[0]!.raasPackage;
    plan.equipmentUnitRubOverride = 300000; plan.raasFirstMonthRubOverride = 400000;
    expect(buildPilotBudget(model, "r1", plan).lines.find(line => line.key === "firstMonthPremium")!.valueRub).toBe(200000);
  });

  it("carries exact money, commercial scope and reason through CSV, JSON and Excel cashflow formulas", async () => {
    const model = example(), result = model.results.find(row => row.key === "r1");
    if (result?.status !== "ok") throw Error("Expected RaaS economics");
    expect(JSON.parse(JSON.stringify(model)).scenarios[2].items[0].raasPackage).toEqual(scope);
    const csv = projectCsv(model, { projectName: "RaaS состав" });
    expect(csv).toContain(scope.reason); expect(csv).toContain("Платформа RaaS"); expect(csv).toContain("195000");
    expect(csv).toContain("за площадку"); expect(csv).toContain("один раз в начале");
    const book = await workbook({ projectName: "RaaS состав", results: model, defs: paramSpecsFor("warehouse") });
    const values: ExcelJS.CellValue[] = [];
    book.eachSheet(sheet => sheet.eachRow(row => row.eachCell(cell => values.push(cell.value))));
    expect(values).toContain(195000); expect(values).toContain(146400);
    expect(values.some(value => typeof value === "string" && value.includes(scope.reason))).toBe(true);
    const flows = book.getWorksheet("Денежный поток")!;
    let start = 0;
    flows.eachRow((row, i) => { if (String(row.getCell(1).value).includes(result.name)) start = i; });
    expect(start).toBeGreaterThan(0);
    let zero = 0;
    for (let row = start; row <= flows.rowCount; row++) if (flows.getCell(row, 1).value === 0) { zero = row; break; }
    expect(zero).toBeGreaterThan(start);
    expect(flows.getCell(zero, 2).value).toBe(result.capexRub);
    expect(flows.getCell(zero, 7).value).toMatchObject({ result: -result.capexRub });
    for (const cashflow of result.cashflows.slice(1)) {
      expect(flows.getCell(zero + cashflow.year, 3).value).toBe(cashflow.opexRub);
      expect(flows.getCell(zero + cashflow.year, 4).value).toBe(cashflow.batteryRub);
    }
    const npv = values.find(value => value && typeof value === "object" && "formula" in value && value.formula?.includes("NPV(") && value.result === result.npvRub);
    expect(npv).toBeDefined();
  });

  it("opening and exporting a historical all-inclusive snapshot never applies today's RaaS package math", async () => {
    const saved: ProjectResults = fixtureResults(); saved.modelVersion = "tz-1.0.8";
    const historic = saved.results.find(result => result.key === "r1");
    if (historic?.status !== "ok") throw Error("Expected old RaaS snapshot");
    historic.npvRub = -123456.789;
    const before = structuredClone(saved), restored = projectSnapshotModel(saved);
    expect(restored.results).toEqual(saved.results);
    const book = await workbook({ projectName: "Архив RaaS", results: saved, defs: paramSpecsFor("warehouse") });
    const values: ExcelJS.CellValue[] = [];
    book.eachSheet(sheet => sheet.eachRow(row => row.eachCell(cell => values.push(cell.value))));
    expect(values).toContain(-123456.789);
    expect(values.some(value => value && typeof value === "object" && "formula" in value)).toBe(false);
    expect(book.calcProperties.fullCalcOnLoad).not.toBe(true);
    expect(saved).toEqual(before);
  });
});
