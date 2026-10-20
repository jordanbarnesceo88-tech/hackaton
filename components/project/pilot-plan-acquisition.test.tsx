import { isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fixtureContext, fixtureSpecs } from "@/lib/tz/econ/fixtures";
import { computeScenariosCore } from "@/lib/tz/econ/core";
import { defaultPilotPlan, type PilotBudgetModel } from "@/lib/tz/pilot-budget";
import { PilotPlan } from "./pilot-plan";

// Exercise the actual editor's event handler without adding a DOM/test dependency.
const hooks = vi.hoisted(() => ({ values: [] as unknown[], cursor: 0 }));
vi.mock("react", async importOriginal => ({
  ...await importOriginal<typeof import("react")>(),
  useState: (initial: unknown) => {
    const index = hooks.cursor++;
    if (!(index in hooks.values)) hooks.values[index] = typeof initial === "function" ? initial() : initial;
    return [hooks.values[index], (value: unknown) => { hooks.values[index] = typeof value === "function" ? value(hooks.values[index]) : value; }];
  },
}));

function model(ambiguous: boolean): PilotBudgetModel {
  const ctx = fixtureContext(), scenarios = fixtureSpecs();
  if (ambiguous) { const copy = structuredClone(scenarios[1]!); copy.key = "p2"; copy.items[0]!.priceRubOverride = 4_000_000; scenarios.push(copy); }
  return { modelVersion: "tz-1.0.10", scenarios, results: computeScenariosCore(ctx, scenarios), paramsUsed: ctx.params, normsUsed: ctx.norms, productSnapshots: ctx.products };
}
function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children as ReactNode)];
}
function editor(props: Parameters<typeof PilotPlan>[0]) {
  hooks.cursor = 0;
  const element = PilotPlan(props) as ReactElement<Record<string, unknown>>;
  return (element.type as (props: Record<string, unknown>) => ReactNode)(element.props);
}
function changeAcquisition(tree: ReactNode) {
  const select = elements(tree).find(node => node.type === "select" && node.props.value === "raas")!;
  (select.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: "purchase" } });
}
function submit(tree: ReactNode) {
  const form = elements(tree).find(node => node.type === "form")!;
  const preventDefault = vi.fn();
  (form.props.onSubmit as (event: { preventDefault: () => void }) => void)({ preventDefault });
  expect(preventDefault).toHaveBeenCalledOnce();
}
function packagedModel() {
  const m = model(false);
  m.scenarios.find(row => row.key === "r1")!.items[0]!.raasPackage = {
    startup: { mode: "included" }, platform: { mode: "included" }, service: { mode: "included" },
    consumables: { mode: "included" }, repair: { mode: "included" }, battery: { mode: "included" },
    firstMonthRub: 150_000, reason: "Условия исходного предложения для теста применения пилота",
  };
  m.results = computeScenariosCore(fixtureContext(), m.scenarios);
  return m;
}

describe("pilot acquisition selection", () => {
  beforeEach(() => { hooks.values = []; hooks.cursor = 0; });
  it("shows ambiguity without an uncaught error, draft reset or apply callback", () => {
    const m = model(true), plan = defaultPilotPlan(m, "r1");
    plan.notes = "Неприменённые замеры участка"; plan.equipmentUnitRubOverride = 333_000;
    const draft = { plan, residual: 12345 }, before = structuredClone(draft);
    const props = { model: m, scenarioKey: "r1", draft, onChange: vi.fn(), onDraftChange: vi.fn() };
    const tree = editor(props);
    expect(() => changeAcquisition(tree)).not.toThrow();
    const after = elements(editor(props));
    expect(after.find(node => node.type === "select" && node.props.value === "raas")).toBeDefined();
    expect(after.some(node => node.props.role === "status" && String(node.props.children).includes("Откройте пилот в нужном сценарии покупки"))).toBe(true);
    expect(hooks.values[0]).toEqual(before.plan); expect(hooks.values[1]).toBe(before.residual);
    expect(draft).toEqual(before);
    expect(props.onDraftChange).not.toHaveBeenCalled(); expect(props.onChange).not.toHaveBeenCalled();
  });
  it("still switches to the only counterpart and remembers the unapplied draft", () => {
    const m = model(false), props = { model: m, scenarioKey: "r1", onChange: vi.fn(), onDraftChange: vi.fn() };
    changeAcquisition(editor(props));
    expect(elements(editor(props)).find(node => node.type === "select" && node.props.value === "purchase")).toBeDefined();
    expect(props.onDraftChange).toHaveBeenCalledOnce();
    expect(props.onDraftChange.mock.calls[0]![0].plan.acquisition).toBe("purchase");
    expect(props.onChange).not.toHaveBeenCalled();
  });
  it.each(["ambiguous", "missing-first-month"] as const)("rejects direct submit of a semantically invalid %s draft without callbacks or mutations", kind => {
    const m = kind === "ambiguous" ? model(true) : packagedModel();
    const plan = defaultPilotPlan(m, "r1");
    if (kind === "ambiguous") plan.acquisition = "purchase";
    else plan.equipmentUnitRubOverride = 300_000;
    const draft = { plan, residual: 98765 }, before = structuredClone(draft);
    const props = { model: m, scenarioKey: "r1", draft, onChange: vi.fn(), onDraftChange: vi.fn() };
    expect(() => submit(editor(props))).not.toThrow();
    expect(props.onChange).not.toHaveBeenCalled(); expect(props.onDraftChange).not.toHaveBeenCalled();
    expect(hooks.values[0]).toEqual(before.plan); expect(hooks.values[1]).toBe(before.residual);
    expect(draft).toEqual(before);
    const expected = kind === "ambiguous" ? "Откройте пилот в нужном сценарии покупки" : "укажите цену первого месяца";
    expect(elements(editor(props)).some(node => node.props.role === "status" && String(node.props.children).includes(expected))).toBe(true);
  });
  it("applies a valid own RaaS quote and the current residual exactly once", () => {
    const m = packagedModel(), plan = defaultPilotPlan(m, "r1");
    plan.equipmentUnitRubOverride = 300_000; plan.raasFirstMonthRubOverride = 400_000;
    const draft = { plan, residual: 45678 }, before = structuredClone(draft);
    const props = { model: m, scenarioKey: "r1", draft, onChange: vi.fn(), onDraftChange: vi.fn() };
    submit(editor(props));
    expect(props.onChange).toHaveBeenCalledExactlyOnceWith({ pilotPlan: plan, terminalResidualRub: draft.residual });
    expect(props.onDraftChange).not.toHaveBeenCalled(); expect(draft).toEqual(before);
  });
});
