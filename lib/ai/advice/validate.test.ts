import { describe, expect, it } from "vitest";
import type { AdviceFacts, AiAdviceContent } from "./types";
import { numbersIn, parseAdvice, unknownNumbers } from "./validate";

const facts: AdviceFacts = {
  object: "Склад",
  recommended: {
    name: "Покупка — AMR 1500",
    kind: "Покупка",
    metrics: { CAPEX: "32,8 млн ₽", NPV: "4,0 млн ₽", "Окупаемость (простая)": "3,3 г." },
    risks: [{ severity: "medium", text: "Цена AMR 1500 2 200 000 ₽ не подтверждена производителем" }],
  },
  alternatives: [{ name: "Как есть", kind: "Как есть (база сравнения)", metrics: { "TCO за 5 лет": "234,4 млн ₽" }, risks: [] }],
  platformConclusion: { headline: "Предварительный финансовый выбор", points: ["Покупка окупается при зарплате от 110 939 ₽/мес"] },
  limitations: [],
};

const valid: AiAdviceContent = {
  summary: "Рекомендуем «Покупка — AMR 1500»: NPV 4,0 млн ₽, окупаемость 3,3 г.",
  whyThisScenario: "TCO за 5 лет ниже, чем 234,4 млн ₽ у «Как есть».",
  recommendations: [{ action: "Запросите коммерческое предложение", why: "Цена 2 200 000 ₽ не подтверждена" }],
  risks: [{ scenario: "Покупка — AMR 1500", severity: "medium", risk: "Цена не подтверждена", mitigation: "Запросить КП", checkOnPilot: "Сверить цену" }],
  whenConclusionChanges: ["Если зарплата ниже 110 939 ₽/мес"],
  nextSteps: ["Обследование", "КП", "Пилот"],
  missingData: ["Цена от производителя"],
};

const names = ["Покупка — AMR 1500", "Как есть"];

describe("numbersIn", () => {
  it("разбирает русскую запись: группы по три цифры, запятая, слипшиеся названия", () => {
    expect(numbersIn("CAPEX 38 500 000 ₽, окупаемость 4,1 г.")).toEqual([38500000, 4.1]);
    expect(numbersIn("Цена AMR 1500 2 200 000 ₽")).toEqual([1500, 2200000]);
    expect(numbersIn("NPV −4,1 млн ₽ при 30–70 %")).toEqual([4.1, 30, 70]);
    expect(numbersIn("1 540 000 ₽ и 132,5 пал./ч")).toEqual([1540000, 132.5]);
  });
});

describe("parseAdvice", () => {
  it("принимает ответ по схеме", () => {
    expect(parseAdvice(JSON.stringify(valid), names)).toEqual({ ok: true, content: valid });
  });

  it("отклоняет не JSON и ответ без обязательных полей", () => {
    expect(parseAdvice("не json", names)).toMatchObject({ ok: false });
    expect(parseAdvice(JSON.stringify({ ...valid, summary: "" }), names)).toMatchObject({ ok: false });
    expect(parseAdvice(JSON.stringify({ ...valid, risks: [{ ...valid.risks[0], severity: "critical" }] }), names)).toMatchObject({ ok: false });
  });

  it("риск с неизвестным сценарием отбрасывается, остальное остаётся", () => {
    const parsed = parseAdvice(JSON.stringify({ ...valid, risks: [...valid.risks, { ...valid.risks[0], scenario: "Услутельного (RaaS)" }] }), names);
    expect(parsed.ok && parsed.content.risks).toEqual(valid.risks);
  });

  it("обрезает слишком длинный текст и лишние пункты", () => {
    const long = parseAdvice(JSON.stringify({ ...valid, summary: "а".repeat(5000), nextSteps: Array.from({ length: 20 }, (_, i) => `шаг ${i}`) }), names);
    expect(long.ok && long.content.summary.length).toBe(1200);
    expect(long.ok && long.content.nextSteps.length).toBe(8);
  });
});

describe("unknownNumbers", () => {
  it("все числа ответа есть в фактах", () => {
    expect(unknownNumbers(valid, facts)).toEqual([]);
  });

  it("выдуманный срок или досчитанный NPV — непроверенные числа", () => {
    expect(unknownNumbers({ ...valid, summary: "Окупится за 18 месяцев, NPV 3,98 млн ₽" }, facts)).toEqual([18, 3.98]);
  });

  it("малые целые — счёт пунктов, не данные", () => {
    expect(unknownNumbers({ ...valid, nextSteps: ["Сделайте 3 шага", "Проверьте 2 участка", "Пилот"] }, facts)).toEqual([]);
  });
});

describe("порядок рисков", () => {
  it("от высоких к низким, внутри важности — как ответила модель", () => {
    const risk = (severity: "high" | "medium" | "low", text: string) => ({ ...valid.risks[0], severity, risk: text });
    const parsed = parseAdvice(JSON.stringify({ ...valid, risks: [risk("medium", "м1"), risk("high", "в1"), risk("low", "н1"), risk("high", "в2")] }), names);
    expect(parsed.ok && parsed.content.risks.map((r) => r.risk)).toEqual(["в1", "в2", "м1", "н1"]);
  });
});
