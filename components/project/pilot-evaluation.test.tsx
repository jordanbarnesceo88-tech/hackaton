import { isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultPilotPlan } from "@/lib/tz/pilot-budget";
import { fixtureContext, fixtureSpecs } from "@/lib/tz/econ/fixtures";
import { computeScenariosCore } from "@/lib/tz/econ/core";
import { PilotEvaluation, type PilotEvaluationProps } from "./pilot-evaluation";
import type { PilotAcceptanceThresholds, PilotObservation } from "@/lib/tz/types";

const hooks = vi.hoisted(() => ({ values: [] as unknown[], cursor: 0 }));
vi.mock("react", async importOriginal => ({
  ...await importOriginal<typeof import("react")>(),
  useState: (initial: unknown) => {
    const index = hooks.cursor++;
    if (!(index in hooks.values)) hooks.values[index] = typeof initial === "function" ? initial() : initial;
    return [hooks.values[index], (value: unknown) => { hooks.values[index] = typeof value === "function" ? value(hooks.values[index]) : value; }];
  },
}));
function plan() {
  const ctx = fixtureContext(), scenarios = fixtureSpecs();
  return defaultPilotPlan({ scenarios, results: computeScenariosCore(ctx, scenarios), paramsUsed: ctx.params, normsUsed: ctx.norms, productSnapshots: ctx.products }, "p1");
}
function completePlan() {
  const p = plan(); p.fleet = 2;
  p.acceptanceThresholds = { schemaVersion: "pilot-acceptance-1", metric: "completed-operations-hour", scope: "Участок А", source: "Фикстура согласования", date: "2026-10-01",
    minAcceptedPerUnit: 10, minPlanCompletionPct: 90, maxManualReworkPct: 5, maxDowntimePct: 10, maxIncidents: 0, maxInterventionsPerShift: 1, minCustomerScore: 4, minDurationDays: 2 };
  p.actualResult = { schemaVersion: "pilot-observation-1", metric: "completed-operations-hour", scope: "Участок А", productSlug: "ronavi-h1500", fleet: 2, dayBasis: "working",
    periodStart: "2026-10-05", periodEnd: "2026-10-06", observedDays: 2, acceptedQuantity: 200, plannedQuantity: 200, manualReworkQuantity: 0, scheduledHours: 16, downtimeHours: 0,
    incidents: 0, interventions: 0, shifts: 2, customerScore: 4, source: "Фикстура журнала пилота", date: "2026-10-07" };
  return p;
}
function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children as ReactNode)];
}
function render(props: PilotEvaluationProps) { hooks.cursor = 0; return PilotEvaluation(props); }
function submit(props: PilotEvaluationProps) {
  const form = elements(render(props)).find(node => node.type === "form")!;
  const preventDefault = vi.fn();
  (form.props.onSubmit as (event: { preventDefault: () => void }) => void)({ preventDefault });
  expect(preventDefault).toHaveBeenCalledOnce();
}
const context = { metric: "completed-operations-hour" as const, productSlug: "ronavi-h1500" };
beforeEach(() => { hooks.values = []; hooks.cursor = 0; });

describe("pilot evaluation explicit application", () => {
  it("does not populate observations or acceptance thresholds from the financial forecast", () => {
    const props = { ...context, plan: plan(), onApply: vi.fn() };
    expect(render(props).props["data-pilot-acceptance"]).toBe("INCOMPLETE");
    const t = hooks.values[0] as PilotAcceptanceThresholds, o = hooks.values[1] as PilotObservation;
    expect(t.minAcceptedPerUnit).toBeNull(); expect(t.date).toBeNull(); expect(t.source).toBe("");
    expect(o.acceptedQuantity).toBeNull(); expect(o.incidents).toBeNull(); expect(o.fleet).toBeNull(); expect(o.periodStart).toBeNull();
    expect(props.onApply).not.toHaveBeenCalled(); expect(props.plan).not.toHaveProperty("actualResult");
  });
  it("keeps edits local and the displayed applied verdict unchanged until Apply", () => {
    const p = completePlan(), before = structuredClone(p), props = { ...context, plan: p, onApply: vi.fn() };
    render(props);
    hooks.values[0] = { ...(hooks.values[0] as PilotAcceptanceThresholds), minAcceptedPerUnit: 500 };
    expect(render(props).props["data-pilot-acceptance"]).toBe("PASS");
    expect(props.onApply).not.toHaveBeenCalled(); expect(p).toEqual(before);
    submit(props);
    expect(props.onApply).toHaveBeenCalledExactlyOnceWith({ acceptanceThresholds: { ...p.acceptanceThresholds, minAcceptedPerUnit: 500 }, actualResult: p.actualResult });
    expect(props.onApply.mock.calls[0]![0]).not.toHaveProperty("verdict");
  });
  it.each(["invalid-period", "nonfinite", "client-verdict"])("rejects direct form submission of %s without callbacks or draft mutation", issue => {
    const props = { ...context, plan: completePlan(), onApply: vi.fn() }; render(props);
    const patch = issue === "invalid-period" ? { periodEnd: "2026-10-04" } : issue === "nonfinite" ? { acceptedQuantity: Infinity } : { verdict: "PASS" };
    hooks.values[1] = { ...(hooks.values[1] as PilotObservation), ...patch };
    const before = structuredClone(hooks.values[1]);
    submit(props); expect(props.onApply).not.toHaveBeenCalled(); expect(hooks.values[1]).toEqual(before);
    expect(hooks.values[2]).toBeTruthy();
  });
  it("applies an explicitly incomplete record without manufacturing a successful verdict", () => {
    const props = { ...context, plan: plan(), onApply: vi.fn() };
    submit(props);
    expect(props.onApply).toHaveBeenCalledOnce();
    const value = props.onApply.mock.calls[0]![0]; expect(value.actualResult.incidents).toBeNull(); expect(value).not.toHaveProperty("status");
  });
  it("read-only archival view never exposes an editor even if callback is passed", () => {
    const props = { ...context, plan: completePlan(), readOnly: true, onApply: vi.fn() };
    const tree = render(props); expect(tree.props["data-pilot-acceptance"]).toBe("PASS");
    expect(elements(tree).some(node => node.type === "form" || node.type === "input")).toBe(false);
    expect(props.onApply).not.toHaveBeenCalled();
  });
});
