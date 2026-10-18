import { describe, expect, it } from "vitest";
import { scenarioFromRow } from "./queries";

describe("saved delivery assumption", () => {
  const row = { key: "p1", name: "Поставка", kind: "PURCHASE" as const };
  it.each([
    { mode: "separate", costRub: 123_456, source: "КП 17, весь парк" },
    { mode: "included", source: "Договор 2, поставка в цене" },
  ])("reads explicit delivery back without dropping its source", logistics => {
    expect(scenarioFromRow({ ...row, spec: { items: [], logistics } }).logistics).toEqual(logistics);
  });
  it("keeps old absence absent and fails malformed saved data instead of treating it as free", () => {
    expect(scenarioFromRow({ ...row, spec: { items: [] } })).not.toHaveProperty("logistics");
    expect(() => scenarioFromRow({ ...row, spec: { items: [], logistics: { mode: "separate", costRub: -1, source: "КП" } } })).toThrow();
  });
});
