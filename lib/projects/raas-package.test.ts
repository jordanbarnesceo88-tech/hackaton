import { describe, expect, it } from "vitest";
import type { Prisma } from "@prisma/client";
import type { RaasPackage } from "../tz/types";
import { fixtureSpecs, FIXTURE_PRODUCTS, fixtureContext } from "../tz/econ/fixtures";
import { buildProjectModel } from "../tz/model";
import { paramSpecsFor } from "../data/organizer/params";
import { projectAuditDiff, changeFieldLabel } from "./changes";
import { scenarioFromRow, scenarioSpecJson } from "./queries";
import { validatePendingChanges, validateScenarioSpecs } from "./validate";

const included = { mode: "included" } as const;
const scope: RaasPackage = { firstMonthRub: 250000, startup: included,
  platform: { mode: "separate", amountRub: 12200, basis: "per-site" }, service: included,
  consumables: { mode: "separate", amountRub: 24000, basis: "per-robot" }, repair: { mode: "unassessed" },
  battery: { mode: "unassessed" }, reason: "Предварительная тестовая оценка; ремонт и АКБ требуют отдельной оценки" };
const check = (input: unknown) => validateScenarioSpecs(input, "warehouse", new Set(FIXTURE_PRODUCTS.map(p => p.slug)), ["pallet-transport", "cleaning"]);

describe("RaaS scope persisted inputs and audit", () => {
  it("preserves explicit inclusions, prices, basis and unknowns through API parsing and DB JSON round-trip", () => {
    const specs = fixtureSpecs(); specs[2]!.items[0]!.raasPackage = scope;
    const checked = check(JSON.parse(JSON.stringify(specs)));
    expect(checked.ok).toBe(true);
    if (!checked.ok) throw Error(checked.errors.join("; "));
    expect(checked.value[2]!.items[0]!.raasPackage).toEqual(scope);
    const saved = scenarioSpecJson(checked.value[2]!);
    const restored = scenarioFromRow({ key: "r1", name: "Услуга", kind: "RAAS", spec: saved as Prisma.JsonValue });
    expect(restored.items[0]!.raasPackage).toEqual(scope);
    const ctx = fixtureContext();
    const model = buildProjectModel({ facility: "warehouse", params: ctx.params, products: FIXTURE_PRODUCTS, paramDefs: paramSpecsFor("warehouse"), norms: ctx.norms, scenarios: checked.value });
    expect(model.results.find(result => result.key === "r1")).toMatchObject({ status: "refused", refusal: { reason: "raas_package_incomplete" } });
  });

  it("generates an auditable whole-package change and accepts its journal field", () => {
    const before = { params: {}, scenarios: fixtureSpecs() }, after = structuredClone(before);
    after.scenarios[2]!.items[0]!.raasPackage = scope;
    const changes = projectAuditDiff(before, after);
    expect(changes).toEqual([{ scenarioKey: "r1", field: "item:pallet-transport:raasPackage", old: null, new: scope, auto: null }]);
    expect(validatePendingChanges(changes)).toMatchObject({ ok: true });
    expect(changeFieldLabel("item:pallet-transport:raasPackage")).toContain("Состав услуг и платежей RaaS");
    const removed = projectAuditDiff(after, before);
    expect(removed[0]).toMatchObject({ old: scope, new: null });
  });

  it("rejects packages on purchase, malformed inner amounts and two per-site payments of the same kind", () => {
    const purchase = fixtureSpecs(); purchase[1]!.items[0]!.raasPackage = scope;
    expect(check(purchase).ok).toBe(false);
    const bad = fixtureSpecs(); bad[2]!.items[0]!.raasPackage = { ...scope, platform: { mode: "separate", amountRub: -1, basis: "per-site" } };
    expect(check(bad).ok).toBe(false);
    const duplicate = fixtureSpecs(); duplicate[2]!.items[0]!.raasPackage = scope;
    duplicate[2]!.items.push({ process: "cleaning", productSlug: FIXTURE_PRODUCTS[0]!.slug, raasPackage: scope });
    const result = check(duplicate);
    expect(result.ok ? "" : result.errors.join("; ")).toContain("в нескольких позициях");
  });
});
