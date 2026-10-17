import { describe, expect, it } from "vitest";
import { acceptedCreateJobId } from "./new-project-form";
import { stableJson } from "@/lib/tz/version";
import type { CalculationRequest } from "@/lib/calculation-jobs/service";

describe("CREATE acknowledgement routing", () => {
  const original: CalculationRequest = { operation: "CREATE", name: "Склад А", facility: "warehouse", paramsSource: { kind: "demo" } };
  const accepted = { inputKey: stableJson(original), id: "known-job" };

  it("reopens the known operation for the same form, including reordered JSON keys", () => {
    expect(acceptedCreateJobId({ paramsSource: { kind: "demo" }, facility: "warehouse", name: "Склад А", operation: "CREATE" }, accepted)).toBe("known-job");
    expect(acceptedCreateJobId(original, null)).toBeNull();
  });

  it("does not route edited names, objects, facilities, sources or uploaded inputs into the previous job", () => {
    for (const edited of [
      { ...original, name: "Склад Б" }, { ...original, objectName: "Другой объект" },
      { ...original, facility: "airport" }, { ...original, paramsSource: { kind: "manual" as const } },
      { ...original, paramsSource: { kind: "upload" as const, fileName: "объект.csv" }, params: { activeAreaM2: 3000 } },
    ]) expect(acceptedCreateJobId(edited, accepted)).toBeNull();
  });
});
