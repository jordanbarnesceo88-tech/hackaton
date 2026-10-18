import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { warehouseBaseInput } from "@/lib/sim/fixtures";
import { simInputIdentity } from "@/lib/sim/identity";
import { SPATIAL_MODEL_VERSION } from "@/lib/sim/spatial-bridge";
import type { SpatialEvidence } from "@/lib/tz/types";
import { WarehouseSimulation, type WarehouseSimulationProps } from "./warehouse-simulation";
import { runSimSync } from "@/lib/sim/runner";
import { toStored } from "@/lib/sim/metrics";

function fixture(): WarehouseSimulationProps {
  const input = warehouseBaseInput(5);
  input.transportWorkflow = "closed-pod-1";
  input.layout.chargers = 2;
  input.demand.peakPerH = 51.81818181818181;
  const evidence: SpatialEvidence = { input: structuredClone(input), sourceInputKey: simInputIdentity(input),
    executionInputKey: "completed-fixture", simModelVersion: SPATIAL_MODEL_VERSION,
    assessment: { status: "PARTIAL", terminal: true, headline: "Есть ограничения при заданной нагрузке" },
    summary: { fleet: 5, requiredPerH: input.demand.peakPerH, achievedPerH: 51, queueEnd: 5, waitP95Min: 9.983333333333333 } };
  return { initialKey: "purchase", selectedScenarioKey: "purchase", scenarios: [{ key: "purchase", name: "Покупка",
    variants: [{ id: "calculated", label: "Парк5", input }, { id: "minStable", label: "Минимальный парк3", input: { ...input, robots: { ...input.robots, count: 3 } } }] }],
    spatialEvidenceByKey: { purchase: evidence } };
}

describe("canonical warehouse validation", () => {
  it("shows the matching server single-leg summary without mounting the 3D bridge or a second simulation", () => {
    const input = warehouseBaseInput(11, { transportWorkflow: "single-leg-pallet-1" });
    const stored = { ...toStored(runSimSync(input)), scenarioKey: "fork" };
    const props: WarehouseSimulationProps = { initialKey: "fork", scenarios: [{ key: "fork", name: "Вилочный робот",
      stored, variants: [{ id: "calculated", label: "Текущий парк", input }] }] };
    const html = renderToStaticMarkup(createElement(WarehouseSimulation, props));
    expect(html).toContain('data-validation-kind="analytical"');
    expect(html).toContain(`data-analytical-receipt="${stored.verdict}"`);
    expect(html).toContain("Результат аналитической проверки");
    expect(html).toContain("Максимальная очередь заданий");
    expect(html).toContain("Упрощённая аналитическая проверка");
    expect(html).not.toContain("Пространственный просмотр");
    expect(html).not.toContain("Проверить этот вариант в 3D");
    expect(html).not.toContain("Вывод о выполнении нагрузки берётся из пространственной проверки");
    expect(html).not.toContain("▶ Старт");
    expect(html).not.toContain('data-spatial-receipt=');
    expect(html).not.toContain("<iframe");
    expect(html).not.toContain("<details open");
    for (const summary of [{ ...stored, simModelVersion: "old" }, { ...stored, scenarioKey: "other" }, { ...stored, inputKey: "old" }]) {
      props.scenarios[0]!.stored = summary;
      const stale = renderToStaticMarkup(createElement(WarehouseSimulation, props));
      expect(stale).toContain('data-analytical-receipt="stale"');
      expect(stale).not.toContain("Результат аналитической проверки");
    }
    props.scenarios[0]!.stored = stored;
    props.stale = true;
    const edited = renderToStaticMarkup(createElement(WarehouseSimulation, props));
    expect(edited).toContain("Условия изменены");
    expect(edited).not.toContain("Результат аналитической проверки");
  });

  it("does not offer underlift 3D or a local simulation for an unsupported input", () => {
    const html = renderToStaticMarkup(createElement(WarehouseSimulation, { initialKey: "unsupported", scenarios: [
      { key: "unsupported", name: "Другой процесс", variants: [], unavailableReason: "Процесс не поддерживается" },
    ] }));
    expect(html).toContain('data-validation-kind="unsupported"');
    expect(html).toContain("Процесс не поддерживается");
    expect(html).not.toContain("Проверить этот вариант в 3D");
    expect(html).not.toContain("Упрощённая аналитическая проверка");
  });
  it("shows the fresh spatial receipt and exact-input bridge while leaving analytical simulation unmounted", () => {
    const html = renderToStaticMarkup(createElement(WarehouseSimulation, fixture()));
    expect(html).toContain('data-spatial-receipt="PARTIAL"');
    expect(html).toContain("Есть ограничения при заданной нагрузке");
    expect(html).toContain("51,0 / 51,8 пал./ч");
    expect(html).toContain("Проверить этот вариант в 3D");
    expect(html).toContain("Упрощённая аналитическая проверка");
    expect(html).not.toContain("Минимальный парк3");
    expect(html).not.toContain("Принять парк");
    expect(html).not.toContain("Сценарий и парк");
    expect(html).not.toContain("<canvas");
    expect(html).not.toContain("<details open");
  });

  it("does not present missing, outdated or unmeasured evidence as delivered zero or current success", () => {
    const missing = fixture(); missing.spatialEvidenceByKey = {};
    const absent = renderToStaticMarkup(createElement(WarehouseSimulation, missing));
    expect(absent).toContain('data-spatial-receipt="missing"');
    expect(absent).not.toContain("Результат пространственной проверки");
    const changed = fixture(); changed.scenarios[0]!.variants[0]!.input!.robots.count = 6;
    const stale = renderToStaticMarkup(createElement(WarehouseSimulation, changed));
    expect(stale).toContain('data-spatial-receipt="stale"');
    expect(stale).not.toContain("51,0 / 51,8");
    const unmeasured = fixture(); unmeasured.spatialEvidenceByKey!.purchase!.assessment.status = "NOT_EVALUATED";
    unmeasured.spatialEvidenceByKey!.purchase!.assessment.headline = "Пространственный прогон не выполнен";
    const notRun = renderToStaticMarkup(createElement(WarehouseSimulation, unmeasured));
    expect(notRun).toContain('data-spatial-receipt="NOT_EVALUATED"');
    expect(notRun).toContain("Пространственный прогон не выполнен");
    expect(notRun).not.toContain("Результат пространственной проверки");
  });

  it("uses the selected financial scenario and suppresses its old receipt while edits are pending", () => {
    const props = fixture();
    props.scenarios.push({ ...props.scenarios[0]!, key: "raas", name: "Услуга" });
    props.spatialEvidenceByKey!.raas = { ...props.spatialEvidenceByKey!.purchase!,
      assessment: { status: "FAIL", terminal: true, headline: "Ограничение выбранной услуги" } };
    props.selectedScenarioKey = "raas";
    const chosen = renderToStaticMarkup(createElement(WarehouseSimulation, props));
    expect(chosen).toContain('data-spatial-receipt="FAIL"');
    expect(chosen).toContain("Ограничение выбранной услуги");
    expect(chosen).not.toContain("Есть ограничения при заданной нагрузке");
    props.stale = true;
    const edited = renderToStaticMarkup(createElement(WarehouseSimulation, props));
    expect(edited).toContain("Условия изменены");
    expect(edited).not.toContain("51,0 / 51,8");
  });
});
