import { describe, expect, it } from "vitest";
import { PNG_DISCLAIMER, PNG_MODEL_NOTE, SIM_FOOTER, simPngFilename, slugifyRu } from "./export-png";

describe("SIM_FOOTER", () => {
  it("is the footer text of the spec, built from the same lines as the PNG footer", () => {
    expect(SIM_FOOTER).toBe(
      "Упрощённая имитация: маршруты по сетке проходов, без разъездов роботов; времена погрузки — оценка. " +
        "Предварительная оценка, требует обследования объекта.",
    );
    expect(SIM_FOOTER).toBe(`${PNG_MODEL_NOTE} ${PNG_DISCLAIMER}`);
  });
});

describe("slugifyRu", () => {
  it("transliterates Russian names into lowercase Latin with dashes", () => {
    expect(slugifyRu("Покупка — Ronavi H1500")).toBe("pokupka-ronavi-h1500");
    expect(slugifyRu("Услуга (RaaS) — Щётка, ёж")).toBe("usluga-raas-shchetka-ezh");
  });

  it("drops soft and hard signs and trims dashes at the ends", () => {
    expect(slugifyRu("  Подъёмный объект!  ")).toBe("podemnyy-obekt");
  });

  it("keeps the fleet number of a typical variant label", () => {
    expect(slugifyRu("Покупка — Ronavi H1500 — парк по норме организатора (3)")).toBe(
      "pokupka-ronavi-h1500-park-po-norme-organizatora-3",
    );
  });

  it("cuts long names at a dash, not in the middle of a word", () => {
    const slug = slugifyRu(
      "Покупка — Ronavi H1500 — минимальный по имитации (9) — очень длинное название сценария",
    );
    expect(slug.length).toBeLessThanOrEqual(64);
    expect(slug.endsWith("-")).toBe(false);
    expect(slug).toBe("pokupka-ronavi-h1500-minimalnyy-po-imitatsii-9-ochen-dlinnoe");
  });

  it("falls back to a fixed word when nothing usable is left", () => {
    expect(slugifyRu("— — —")).toBe("scenariy");
    expect(slugifyRu("")).toBe("scenariy");
  });
});

describe("simPngFilename", () => {
  it("builds imitaciya-{slug}-seed{n}.png", () => {
    expect(simPngFilename("Покупка — Ronavi H1500 — парк по расчёту (11)", 1)).toBe(
      "imitaciya-pokupka-ronavi-h1500-park-po-raschetu-11-seed1.png",
    );
  });

  it("writes the seed as an integer and never NaN", () => {
    expect(simPngFilename("Услуга", 42.7)).toBe("imitaciya-usluga-seed42.png");
    expect(simPngFilename("Услуга", Number.NaN)).toBe("imitaciya-usluga-seed0.png");
  });

  it("produces only ASCII, so the download attribute is safe in every browser", () => {
    const name = simPngFilename("Покупка — Ёлка «Тест» №5", 3);
    expect(/^[\x21-\x7e]+$/.test(name)).toBe(true);
  });
});
