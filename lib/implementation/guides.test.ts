import { describe, expect, it } from "vitest";
import { SOLUTION_TYPE_DEFS } from "../tz/processes";
import { implementationGuide, IMPLEMENTATION_CLASSES } from "./guides";
import { serviceProviders } from "./service-directory";
import { buildImplementationSnapshot } from "./snapshot";

describe("implementation knowledge and source-backed contacts", () => {
  it("covers each catalogue class with preparation, acceptance and operations", () => {
    expect(new Set(IMPLEMENTATION_CLASSES)).toEqual(new Set(SOLUTION_TYPE_DEFS.map(type => type.slug)));
    for (const type of IMPLEMENTATION_CLASSES) {
      const guide = implementationGuide(type)!;
      expect(guide.solutionType).toBe(type);
      for (const key of ["bottlenecks", "preparation", "acceptance", "operations", "customer"] as const) expect(guide[key].length).toBeGreaterThan(0);
    }
    expect(implementationGuide("not-a-class")).toBeNull();
    expect(implementationGuide("constructor")).toBeNull();
    expect(implementationGuide("__proto__")).toBeNull();
  });

  it("never assigns another brand's service through loose name matching", () => {
    expect(serviceProviders("pallet-amr", "NotRonavi")).toEqual([]);
    expect(serviceProviders("pallet-amr", null)).toEqual([]);
    expect(serviceProviders("pallet-amr", "Ronavi Robotics").map(provider => provider.id)).toEqual(["ronavi"]);
    expect(serviceProviders("cleaner", "Pudu Robotics").map(provider => provider.id)).toEqual(["spi", "alfa-service"]);
    expect(serviceProviders("cleaner", "Viggo").map(provider => provider.id)).toEqual(["alfa-service"]);
    for (const provider of serviceProviders("cleaner", "Pudu")) {
      expect(provider.responseSla).toBeNull(); expect(provider.onsiteSla).toBeNull();
      expect(provider.sourceUrl || provider.sourceRef).toBeTruthy();
    }
  });

  it("returns detached, serializable snapshots so edits cannot contaminate another project", () => {
    const first = buildImplementationSnapshot("cleaner", "Pudu");
    first.guide!.acceptance[0] = "changed"; first.providers[0]!.coverage = "changed";
    const second = buildImplementationSnapshot("cleaner", "Pudu");
    expect(second.guide!.acceptance[0]).not.toBe("changed"); expect(second.providers[0]!.coverage).not.toBe("changed");
    expect(JSON.parse(JSON.stringify(second))).toEqual(second);
  });
});
