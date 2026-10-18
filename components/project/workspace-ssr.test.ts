import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { projectSnapshotModel } from "@/lib/projects/archive";
import { fixtureDefs, fixtureResults } from "@/lib/report/tz/test-fixtures";
import { Workspace, type WorkspaceProps } from "./workspace";

vi.mock("@/lib/projects/actions", () => ({
  copyProjectAction: vi.fn(),
  deleteProjectAction: vi.fn(),
}));

describe("workspace first server render", () => {
  it("keeps an owner's saved revision ready on opening instead of starting a new calculation", () => {
    const stored = fixtureResults();
    const props: WorkspaceProps = {
      mode: "owner", initialStep: 1,
      project: { id: "saved-project", revision: 7, name: "Saved", facility: "warehouse", facilityLabel: "Склад" },
      defs: fixtureDefs(), baseValues: stored.paramsUsed, initialParams: stored.paramsUsed,
      initialScenarios: stored.scenarios, products: [], normRows: [], processes: [],
      initialModel: projectSnapshotModel(stored), initialMs: 0,
      stored: { results: stored, liveDataVersion: stored.dataVersion },
    };
    const html = renderToStaticMarkup(createElement(Workspace, props));
    expect(html).toContain('data-project-revision="7"');
    expect(html).toContain('data-server-calculation="ready"');
    expect(html).toContain("Сохранённый расчёт");
    expect(html).not.toContain("Сервер проверяет текущие условия");
  });
  it("marks a guest bootstrap as pending on every initial step and withholds its terminal decision", () => {
    const stored = fixtureResults();
    stored.conclusion.headline = "Bootstrap recommendation must stay hidden";
    const props: WorkspaceProps = {
      mode: "guest", project: { name: "Guest", facility: "warehouse", facilityLabel: "Склад" },
      defs: fixtureDefs(), baseValues: stored.paramsUsed, initialParams: stored.paramsUsed,
      initialScenarios: stored.scenarios, products: [], normRows: [], processes: [],
      initialModel: projectSnapshotModel(stored), initialMs: 0,
    };
    for (const initialStep of [1, 5, 6, 7, 8]) {
      const html = renderToStaticMarkup(createElement(Workspace, { ...props, initialStep }));
      expect(html).toContain('data-calculation-state="running"');
      expect(html).toContain('data-guest-calculation="running"');
      expect(html).toContain("Сервер рассчитывает");
      expect(html).not.toContain("data-decision-status=");
      expect(html).not.toContain("Принять парк по имитации");
      expect(html).not.toContain("Не проверено в 3D");
      expect(html).not.toContain("Bootstrap recommendation must stay hidden");
      if (initialStep === 5) expect(html).toContain("data-economics-pending");
      if (initialStep === 6) {
        expect(html).toContain("data-comparison-pending");
        expect(html).not.toContain("<table");
        expect(html).not.toContain("Сценарий для анализа чувствительности");
      }
    }
  });
  it("renders only the requested step's content, with all navigation anchors available", () => {
    const stored = fixtureResults();
    stored.conclusion.headline = "SSR saved conclusion sentinel";
    const props: WorkspaceProps = {
      archive: true,
      mode: "readonly",
      project: { id: "ssr-project", revision: 0, name: "SSR archive", facility: "warehouse", facilityLabel: "Склад" },
      defs: fixtureDefs(),
      baseValues: stored.paramsUsed,
      initialParams: stored.paramsUsed,
      initialScenarios: stored.scenarios,
      products: Object.values(stored.productSnapshots).filter(product => product !== null),
      normRows: [],
      processes: [],
      initialModel: projectSnapshotModel(stored),
      initialMs: 0,
      stored: { results: stored, liveDataVersion: stored.dataVersion },
    };
    const render = (initialStep: number) => renderToStaticMarkup(createElement(Workspace, { ...props, initialStep }));
    const first = render(1);
    const simulation = render(7);
    const report = render(8);
    for (const html of [first, simulation, report]) {
      for (const id of ["object", "params", "selection", "comparison", "economics", "scenarios", "simulation", "report"]) {
        expect(html).toContain(`<section id="${id}"`);
      }
      expect(html.match(/<h2\b/g)).toHaveLength(8);
      // Parameter forms are unvisited in all three initial routes.
      expect(html).not.toContain("<input");
    }
    // The object/simulation routes must not server-render hidden financial or pilot tables.
    expect(first).not.toContain("<table");
    expect(simulation).not.toContain("<table");
    expect(first).toContain("<dd>SSR archive</dd>");
    expect(first).not.toContain("data-archive-simulation");
    expect(first).not.toContain("SSR saved conclusion sentinel");
    expect(simulation).toContain("data-archive-simulation");
    expect(simulation).not.toContain("<dd>SSR archive</dd>");
    expect(simulation).not.toContain("SSR saved conclusion sentinel");
    expect(report).toContain("SSR saved conclusion sentinel");
    expect(report).not.toContain("data-archive-simulation");
    expect(report).not.toContain("<dd>SSR archive</dd>");
  });
});
