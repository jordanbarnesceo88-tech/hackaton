import { describe, expect, it } from "vitest";
import { PARAM_SPECS } from "../../data/organizer/params.generated";
import { DEFAULT_PARAM_LABELS, FACILITY_PARAM_KEYS } from "./context";

/**
 * Встроенные подписи параметров (DEFAULT_PARAM_LABELS) не расходятся с датасетом организатора и
 * дополнениями (lib/data/organizer/params.generated.ts): по каждому ключу параметр существует,
 * а его подпись совпадает со встроенной или начинается с неё (общая часть подписей разных типов
 * объектов, например «Общая площадь» у «Общая площадь склада» и «Общая площадь здания(й)»).
 */
describe("подписи параметров для сообщений", () => {
  it("каждый ключ есть в параметрах организатора, подпись совпадает или является общей частью", () => {
    for (const [key, label] of Object.entries(DEFAULT_PARAM_LABELS)) {
      const specs = PARAM_SPECS.filter((s) => s.key === key);
      expect(specs.length, `нет параметра ${key}`).toBeGreaterThan(0);
      for (const s of specs) {
        expect(s.label === label || s.label.startsWith(label), `${key} (${s.facility}): «${s.label}» ≠ «${label}»`).toBe(true);
      }
    }
  });

  it("у каждого параметра объекта, который движок читает по имени, есть встроенная подпись", () => {
    for (const key of Object.values(FACILITY_PARAM_KEYS)) {
      expect(DEFAULT_PARAM_LABELS[key], key).toBeTruthy();
    }
  });
});
