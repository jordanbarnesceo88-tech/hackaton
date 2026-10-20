import { isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fixtureContext, fixtureSpecs } from "@/lib/tz/econ/fixtures";
import { computeScenariosCore } from "@/lib/tz/econ/core";
import { defaultPilotPlan, type PilotBudgetModel } from "@/lib/tz/pilot-budget";
import { evaluatePilotAcceptance } from "@/lib/tz/pilot-evaluation";
import type { PilotPlanInput } from "@/lib/tz/types";
import { PilotEvaluation } from "./pilot-evaluation";
import { PilotBudgetReadout, PilotPlan } from "./pilot-plan";

const hooks = vi.hoisted(() => ({ values: [] as unknown[], cursor: 0 }));
vi.mock("react", async importOriginal => ({
  ...await importOriginal<typeof import("react")>(),
  useState: (initial: unknown) => {
    const index = hooks.cursor++;
    if (!(index in hooks.values)) hooks.values[index] = typeof initial === "function" ? initial() : initial;
    return [hooks.values[index], (value: unknown) => { hooks.values[index] = typeof value === "function" ? value(hooks.values[index]) : value; }];
  },
}));

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children as ReactNode)];
}
function fixture() {
  const ctx = fixtureContext(), scenarios = fixtureSpecs();
  const model: PilotBudgetModel = { modelVersion: "tz-1.1.0", scenarios, results: computeScenariosCore(ctx, scenarios), paramsUsed: ctx.params, normsUsed: ctx.norms, productSnapshots: ctx.products };
  const plan = defaultPilotPlan(model, "p1"), metric = "completed-operations-hour" as const;
  plan.acceptanceThresholds = { schemaVersion: "pilot-acceptance-1", scope: "Участок А", metric, source: "Согласованные критерии теста", date: "2026-10-01",
    minAcceptedPerUnit: 100, minPlanCompletionPct: 100, maxManualReworkPct: 5, maxDowntimePct: 10, maxIncidents: 0, maxInterventionsPerShift: 1, minCustomerScore: 4, minDurationDays: 2 };
  plan.actualResult = { schemaVersion: "pilot-observation-1", scope: "Участок А", metric, productSlug: scenarios[1]!.items[0]!.productSlug, fleet: plan.fleet,
    periodStart: "2026-10-05", periodEnd: "2026-10-06", observedDays: 2, dayBasis: plan.dayBasis, acceptedQuantity: 2000, plannedQuantity: 2000, manualReworkQuantity: 0,
    scheduledHours: 16, downtimeHours: 0, incidents: 0, interventions: 0, shifts: 2, customerScore: 5, source: "Журнал тестового участка", date: "2026-10-07" };
  scenarios[1]!.pilotPlan = plan;
  return { model, plan, expected: { metric, productSlug: plan.actualResult.productSlug } };
}
function readout(props: Parameters<typeof PilotPlan>[0]) {
  hooks.cursor = 0;
  const editor = PilotPlan(props) as ReactElement<Record<string, unknown>>;
  const tree = (editor.type as (props: Record<string, unknown>) => ReactNode)(editor.props);
  const node = elements(tree).find(element => element.type === PilotBudgetReadout)!;
  const result = PilotBudgetReadout(node.props as Parameters<typeof PilotBudgetReadout>[0]);
  return { props: node.props as Parameters<typeof PilotBudgetReadout>[0], evaluation: elements(result).find(element => element.type === PilotEvaluation)! };
}

describe("pilot facts remain bound to the applied plan while editing its budget", () => {
  beforeEach(() => { hooks.values = []; hooks.cursor = 0; });
  it("keeps draft fleet pricing separate from saved acceptance identity and its apply callback", () => {
    const { model, plan, expected } = fixture();
    const draft = { plan: { ...structuredClone(plan), fleet: 3 }, residual: 0 }, before = structuredClone(draft);
    const onChange = vi.fn(), onEvaluationChange = vi.fn();
    const view = readout({ model, scenarioKey: "p1", draft, onChange, onEvaluationChange });
    expect(view.props.budget.plan.fleet).toBe(3); expect(view.props.evaluationPlan).toEqual(plan);
    expect(view.evaluation.props.plan).toEqual(plan);
    expect(evaluatePilotAcceptance(view.evaluation.props.plan as PilotPlanInput, expected).status).toBe("PASS");
    expect(evaluatePilotAcceptance(draft.plan, expected).status).toBe("INCOMPLETE");
    (view.evaluation.props.onApply as (value: Pick<PilotPlanInput, "acceptanceThresholds" | "actualResult">) => void)({ acceptanceThresholds: plan.acceptanceThresholds, actualResult: plan.actualResult });
    expect(onEvaluationChange).toHaveBeenCalledExactlyOnceWith(plan);
    expect(onChange).not.toHaveBeenCalled(); expect(draft).toEqual(before);
  });
  it("does not display a draft-only completed observation as an applied PASS", () => {
    const { model, plan, expected } = fixture(), draft = { plan: structuredClone(plan), residual: 0 };
    delete plan.acceptanceThresholds; delete plan.actualResult;
    const view = readout({ model, scenarioKey: "p1", draft, onChange: vi.fn(), onEvaluationChange: vi.fn() });
    expect(evaluatePilotAcceptance(draft.plan, expected).status).toBe("PASS");
    expect(evaluatePilotAcceptance(view.evaluation.props.plan as PilotPlanInput, expected).status).toBe("INCOMPLETE");
    expect(view.evaluation.props.plan).toEqual(plan);
  });
});
