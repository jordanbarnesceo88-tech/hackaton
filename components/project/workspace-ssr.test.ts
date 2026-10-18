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
