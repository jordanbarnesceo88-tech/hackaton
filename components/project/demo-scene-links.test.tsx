import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { DemoSceneLinks } from "./demo-scene-links";

it("offers separate complex/cleaning scenes without transferring project inputs or connecting an opener", () => {
  for (const project of [false, true]) {
    const html = renderToStaticMarkup(createElement(DemoSceneLinks, { project }));
    expect(html).toContain('href="/demo/warehouse?case=complex"');
    expect(html).toContain('href="/demo/cleaning"');
    expect(html.match(/target="_blank"/g)).toHaveLength(2);
    expect(html.match(/rel="noopener noreferrer"/g)).toHaveLength(2);
    expect(html).not.toContain(".html");
    expect(html).not.toContain("#project=");
    expect(html).toContain("Отдельные демонстрационные сцены");
    if (project) expect(html).toContain("входы и результат проекта не изменятся");
  }
});
