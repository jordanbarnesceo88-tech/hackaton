import { describe, expect, it } from "vitest";
import { SOLUTION_TYPE_DEFS } from "../tz/processes";
import { CATALOG } from "../data/organizer/catalog";
import { VENDOR_CLEANING_PRODUCTS } from "../data/vendor-cleaning";
import { implementationResources, RESOURCE_KIND_LABELS } from "./resources";

describe("model-specific OEM resource registry", () => {
  it("has source metadata and explicit applicability, without pretending every class has an OEM manual", () => {
    const resources = SOLUTION_TYPE_DEFS.flatMap(type => implementationResources(type.slug));
    const unique = new Map(resources.map(resource => [resource.id, resource]));
    expect(unique.size).toBe(18);
    for (const resource of unique.values()) {
      const url = new URL(resource.url);
      expect(url.protocol).toBe("https:");
      expect(url.username + url.password).toBe("");
      expect(resource.checkedAt).toBe("2026-10-18");
      expect(resource.models.length).toBeGreaterThan(0);
      expect(resource.sections.length).toBeGreaterThan(0);
      expect(resource.limits.length).toBeGreaterThan(0);
      expect(RESOURCE_KIND_LABELS[resource.kind]).toBeTruthy();
      expect(Object.keys(resource)).not.toContain("manufacturerAliases");
      for (const type of resource.solutionTypes) expect(SOLUTION_TYPE_DEFS.some(def => def.slug === type)).toBe(true);
    }
    expect(implementationResources("patrol").map(resource => resource.id)).toEqual(["smp-tral-patrol-5-1-spec"]);
    expect(implementationResources("other")).toEqual([]);
    expect(implementationResources("constructor")).toEqual([]);
  });

  it("matches real seed names and exact manufacturer aliases, including long organizer names", () => {
    const expected = ["ronavi-h1500", "ronavi-h2000", "ronavi-m", "ronavi-sr", "ronavi-sd", "robocv-shtabeler", "robocv-tyagach", "pudubot-2", "stelkon-pallet-shuttle", "ars-smartcube", "yandex-robot-inventarizator", "evocargo-n1", "dikom-as-rs-p", "dikom-as-rs-b", "smp-tral-patrul-5"];
    for (const slug of expected) {
      const product = CATALOG.find(item => item.slug === slug)!;
      expect(product, slug).toBeDefined();
      expect(implementationResources(product.solutionType, product.manufacturer, product.name), slug).not.toHaveLength(0);
    }
    for (const product of VENDOR_CLEANING_PRODUCTS) expect(implementationResources(product.solutionType, product.manufacturer, product.name)).toHaveLength(1);
    expect(implementationResources("cleaner", "  PUDU Robotics ", " PUDU   CC1 ")).toHaveLength(1);
  });

  it("does not transfer a manual to a derivative, another brand, or a whole manufacturer", () => {
    expect(implementationResources("cleaner", "Pudu Robotics", "PUDU CC1 Pro")).toEqual([]);
    expect(implementationResources("cleaner", "VIGGO", "SC80Pro")).toEqual([]);
    expect(implementationResources("cleaner", "NotPudu", "PUDU CC1")).toEqual([]);
    expect(implementationResources("cleaner", "Pudu Robotics")).toEqual([]);
    expect(implementationResources("cleaner", "Pudu Robotics", "")).toEqual([]);
    expect(implementationResources("fmr", "Ronavi Robotics", "Ronavi H1500")).toEqual([]);
    expect(implementationResources("cleaner", null, "Fake PUDU CC1")).toEqual([]);
    expect(implementationResources("patrol", "СМП Сервис", "Трал Патруль T5.3")).toEqual([]);
    expect(implementationResources("patrol", "СМП Сервис", "Трал Патруль 7")).toEqual([]);
    expect(implementationResources("patrol", 'ООО "Гумич РТК"', "Робот Городовой")).toEqual([]);
    expect(implementationResources("pallet-asrs", "ДиКом", "AS-RS B")).toEqual([]);
  });

  it("distinguishes manuals from specs and manufacturer cases", () => {
    expect(implementationResources("cleaner").filter(resource => resource.kind === "manual").map(resource => resource.id)).toEqual(["pudu-cc1-operation-v6"]);
    expect(implementationResources("inventory")[0]?.kind).toBe("case-study");
    expect(implementationResources("g2p").some(resource => resource.limits.some(limit => limit.includes("14 м")))).toBe(true);
    expect(implementationResources("pallet-asrs", "ДиКом", "AS-RS P")[0]?.kind).toBe("brochure");
    expect(implementationResources("g2p", "ДиКом", "AS-RS B")[0]?.kind).toBe("brochure");
    expect(implementationResources("patrol").every(resource => resource.kind !== "manual")).toBe(true);
  });

  it("returns detached snapshots, so editing one project cannot change the registry", () => {
    const first = implementationResources("cleaner", "Pudu", "CC1");
    first[0]!.models.push("Invented");
    first[0]!.limits[0] = "changed";
    const second = implementationResources("cleaner", "Pudu", "CC1");
    expect(second[0]!.models).not.toContain("Invented");
    expect(second[0]!.limits[0]).not.toBe("changed");
    expect(JSON.parse(JSON.stringify(second))).toEqual(second);
  });
});
