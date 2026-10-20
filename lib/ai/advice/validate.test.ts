import { describe, expect, it } from "vitest";
import type { AdviceFacts, AiAdviceContent } from "./types";
import { numbersIn, parseAdvice, unknownNumbers } from "./validate";
import { adviceSchema, ADVICE_TEXT_MAX_LENGTH } from "./prompt";

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
    expect(numbersIn("NPV −4,1 млн ₽ при 30–70 %")).toEqual([-4.1, 30, 70]);
    expect(numbersIn("1 540 000 ₽ и 132,5 пал./ч")).toEqual([1540000, 132.5]);
  });

  it("сохраняет ASCII/Unicode минус и плюс, не превращая дефис модели или диапазона в знак", () => {
    expect(numbersIn("−18 000 000 ₽, - 3,5 %, +2 года, AMR-1500, CC1, 30-70 %")).toEqual([-18000000, -3.5, 2, 1500, 1, 30, 70]);
    expect(numbersIn("NPV−18 000 000 ₽")).toEqual([-18000000]);
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

  it("отклоняет длинную строку целиком, сохраняя право на оговорку в конце ответа", () => {
    const summary = "а".repeat(ADVICE_TEXT_MAX_LENGTH) + " Экономика не подтверждена.";
    expect(parseAdvice(JSON.stringify({ ...valid, summary }), names)).toEqual({ ok: false, reason: "ответ не по схеме" });
    expect(parseAdvice(JSON.stringify({ ...valid, summary: "а".repeat(ADVICE_TEXT_MAX_LENGTH) }), names).ok).toBe(true);
    expect(parseAdvice(JSON.stringify({ ...valid, recommendations: [{ action: "а".repeat(1201), why: "Оговорка" }] }), names).ok).toBe(false);
  });

  it("отклоняет лишние пункты во всех списках вместо потери хвостовых ограничений", () => {
    for (const [field, limit] of Object.entries({ recommendations: 5, risks: 8, whenConclusionChanges: 5, nextSteps: 5, missingData: 8 })) {
      const sample = valid[field as keyof AiAdviceContent] as unknown[];
      const items = Array.from({ length: limit }, () => sample[0]);
      expect(parseAdvice(JSON.stringify({ ...valid, [field]: items }), names).ok, field).toBe(true);
      expect(parseAdvice(JSON.stringify({ ...valid, [field]: [...items, sample[0]] }), names).ok, field).toBe(false);
    }
  });

  it("объявляет тот же maxLength для каждого свободного текста в схеме провайдера", () => {
    const schema = adviceSchema(names);
    const visit = (value: unknown) => {
      if (!value || typeof value !== "object") return;
      const node = value as Record<string, unknown>;
      if (node.type === "string" && !node.enum) expect(node.maxLength).toBe(ADVICE_TEXT_MAX_LENGTH);
      for (const child of Object.values(node)) visit(child);
    };
    visit(schema);
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
    expect(unknownNumbers({ ...valid, nextSteps: ["Сделайте 3 шага", "Проверьте 2 участка", "1. Обследование\n2) Пилот"] }, facts)).toEqual([]);
  });

  it("не принимает положительный NPV, если в фактах есть только отрицательное значение", () => {
    const negative = { ...facts, recommended: { ...facts.recommended!, metrics: { NPV: "−18 000 000 ₽" } } };
    const baseline = { ...valid, summary: "NPV −18 000 000 ₽", whyThisScenario: "Нужна проверка", recommendations: [{ action: "Запросите КП", why: "Нужна цена" }], whenConclusionChanges: [] };
    expect(unknownNumbers(baseline, negative)).toEqual([]);
    expect(unknownNumbers({ ...baseline, summary: "NPV положительный: 18 000 000 ₽" }, negative)).toEqual([18000000]);
    expect(unknownNumbers({ ...baseline, summary: "NPV -18 000 000 ₽" }, negative)).toEqual([]);
    expect(unknownNumbers({ ...baseline, summary: "NPV−18 000 000 ₽" }, negative)).toEqual([]);
  });

  it.each(["Сервис стоит 3 ₽ в год", "Скидка 2 %", "Окупится за 1 год", "Доставка за 5 дней", "NPV 0", "Платформа стоит 3 рубля", "Пилот длится 2 месяца", "Зарядка длится 1 час", "Расходы −3 ₽", "Доход +3 ₽"])("проверяет малые числа в значимом контексте: %s", (summary) => {
    const noNumbers: AdviceFacts = { object: "Склад", recommended: null, alternatives: [{ name: "База", kind: "База", metrics: {}, risks: [] }], platformConclusion: { headline: "Нет выбора", points: [] }, limitations: [] };
    const content: AiAdviceContent = { summary, whyThisScenario: "Нет выбора", recommendations: [{ action: "Запросите КП", why: "Нет цены" }], risks: [], whenConclusionChanges: [], nextSteps: ["Пилот"], missingData: [] };
    expect(unknownNumbers(content, noNumbers)).not.toEqual([]);
  });

  it("разрешает малое значение, действительно присутствующее в фактах", () => {
    expect(unknownNumbers({ ...valid, summary: "Срок сравнения 5 лет" }, facts)).toEqual([]);
  });

  it("не пропускает числовой токен, переполняющий Number", () => {
    expect(unknownNumbers({ ...valid, summary: "NPV " + "9".repeat(310) + " ₽" }, facts)).toEqual([Infinity]);
    expect(unknownNumbers({ ...valid, summary: "NPV −" + "9".repeat(310) + " ₽" }, facts)).toEqual([-Infinity]);
  });
});

describe("порядок рисков", () => {
  it("от высоких к низким, внутри важности — как ответила модель", () => {
    const risk = (severity: "high" | "medium" | "low", text: string) => ({ ...valid.risks[0], severity, risk: text });
    const parsed = parseAdvice(JSON.stringify({ ...valid, risks: [risk("medium", "м1"), risk("high", "в1"), risk("low", "н1"), risk("high", "в2")] }), names);
    expect(parsed.ok && parsed.content.risks.map((r) => r.risk)).toEqual(["в1", "в2", "м1", "н1"]);
  });
});

describe("чистка пунктов", () => {
  it("убирает хвостовые запятые и точки с запятой, точку оставляет", () => {
    const parsed = parseAdvice(JSON.stringify({ ...valid, recommendations: [{ action: "Запросите условия поставки,", why: "Доставка не оценена;" }], nextSteps: ["Обследование;", "КП.", "Пилот"] }), names);
    expect(parsed.ok && parsed.content.recommendations[0]).toEqual({ action: "Запросите условия поставки", why: "Доставка не оценена" });
    expect(parsed.ok && parsed.content.nextSteps).toEqual(["Обследование", "КП.", "Пилот"]);
  });
});
