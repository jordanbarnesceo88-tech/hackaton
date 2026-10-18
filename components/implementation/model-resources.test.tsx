import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { implementationResources } from "@/lib/implementation/resources";
import { buildImplementationSnapshot } from "@/lib/implementation/snapshot";
import { ModelResources } from "./model-resources";

describe("model-specific OEM materials", () => {
  it("distinguishes an actual CC1 manual from model specifications and shows its limits", () => {
    const resources = implementationResources("cleaner", "Pudu", "PUDU CC1");
    const html = renderToStaticMarkup(createElement(ModelResources, { resources }));
    expect(html).toContain("Руководство производителя");
    expect(html).toContain("CC1");
    expect(html).toContain("V6");
    expect(html).not.toContain("SC80");
    expect(html).toContain("target=\"_blank\"");
    expect(html).toContain("noopener noreferrer");
  });

  it("does not attach class examples to an unidentified product or backfill a legacy snapshot", () => {
    expect(buildImplementationSnapshot("cleaner", null).resources).toEqual([]);
    expect(buildImplementationSnapshot("cleaner", null, undefined, " ").resources).toEqual([]);
    const html = renderToStaticMarkup(createElement(ModelResources, { resources: [] }));
    expect(html).toContain("в этом снимке не сохранены");
    expect(html).not.toContain("href=");
  });

  it("does not render an executable URL from a malformed saved material", () => {
    const resources = implementationResources("cleaner", "Pudu", "PUDU CC1");
    resources[0]!.url = "javascript:alert(1)";
    const html = renderToStaticMarkup(createElement(ModelResources, { resources }));
    expect(html).toContain("PUDU CC1");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("href=");
  });
});
