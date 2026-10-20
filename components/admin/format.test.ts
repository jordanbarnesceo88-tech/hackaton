import { expect, it } from "vitest";
import { charEditorDefaults, type CharEditorValues } from "./format";

const source: CharEditorValues = { valueNum: null, valueMin: null, valueMax: null, qualifier: null, valueText: "Применимость семейства не подтверждена", valueList: [], unit: null, scope: null, sourceUrl: "https://example.com/Буклет модели.pdf", verifiedAt: "2026-10-20", confirmed: false, note: null };
it("shows a reference-only list's source text without inventing structured items or rewriting its URL", () => {
  expect(charEditorDefaults("list", source, null)).toMatchObject({ valueText: source.valueText, sourceUrl: source.sourceUrl });
  expect(source.valueList).toEqual([]);
});
it("keeps explicit list items and semicolons intact when both forms are present", () => {
  expect(charEditorDefaults("list", { ...source, valueList: ["Wi-Fi; API", "4G"] }, null).valueText).toBe("Wi-Fi; API\n4G");
});
