import { describe, expect, it } from "vitest";
import { AiError } from "../client";
import { generateAdvice } from "./generate";
import type { AdviceFacts, AiAdviceContent } from "./types";

const config = { url: "https://ai.example/api/v1", key: "k", model: "m" };

const facts: AdviceFacts = {
  object: "Склад",
  recommended: { name: "Покупка — AMR 1500", kind: "Покупка", metrics: { NPV: "4,0 млн ₽" }, risks: [] },
  alternatives: [{ name: "Как есть", kind: "Как есть (база сравнения)", metrics: {}, risks: [] }],
  platformConclusion: { headline: "Выбор", points: [] },
  limitations: [],
};

const answer = (summary: string): AiAdviceContent => ({
  summary,
  whyThisScenario: "Лучше «Как есть».",
  recommendations: [{ action: "Запросите КП", why: "Цена не подтверждена" }],
  risks: [],
  whenConclusionChanges: [],
  nextSteps: ["Обследование", "КП", "Пилот"],
  missingData: [],
});

/** Сервис ИИ, отвечающий по очереди заданными текстами; запоминает тела запросов. */
function service(...contents: string[]) {
  const bodies: { messages: { role: string; content: string }[]; response_format: { json_schema: { schema: unknown } } }[] = [];
  const fetchImpl: typeof fetch = async (_url, init) => {
    bodies.push(JSON.parse(String(init!.body)));
    const content = contents[bodies.length - 1] ?? contents.at(-1)!;
    return new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: "stop" }] }));
  };
  return { fetchImpl, bodies };
}

describe("generateAdvice", () => {
  it("проверенный ответ с первой попытки; сценарии риска — перечисление из фактов", async () => {
    const ai = service(JSON.stringify(answer("NPV 4,0 млн ₽")));
    const result = await generateAdvice(facts, config, { fetchImpl: ai.fetchImpl });
    expect(result).toEqual({ content: answer("NPV 4,0 млн ₽"), attempts: 1 });
    expect(JSON.stringify(ai.bodies[0]!.response_format.json_schema.schema)).toContain('"enum":["Покупка — AMR 1500","Как есть"]');
  });

  it("выдуманное число — повтор с подсказкой, какие числа убрать", async () => {
    const ai = service(JSON.stringify(answer("NPV 5,5 млн ₽")), JSON.stringify(answer("NPV 4,0 млн ₽")));
    const result = await generateAdvice(facts, config, { fetchImpl: ai.fetchImpl });
    expect(result.attempts).toBe(2);
    expect(ai.bodies[1]!.messages.at(-1)!.content).toContain("5.5");
  });

  it("не помогло и со второй попытки — ошибка, а не сомнительный текст", async () => {
    const numbers = service(JSON.stringify(answer("NPV 5,5 млн ₽")));
    await expect(generateAdvice(facts, config, { fetchImpl: numbers.fetchImpl })).rejects.toMatchObject({ code: "AI_UNVERIFIED_NUMBERS" });
    const broken = service("не json");
    const error = await generateAdvice(facts, config, { fetchImpl: broken.fetchImpl }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AiError);
    expect(error).toMatchObject({ code: "AI_BAD_RESPONSE" });
    expect(broken.bodies).toHaveLength(2);
  });

  it("отклоняет потерю минуса и выдуманную малую цену до выдачи ответа", async () => {
    const negativeFacts = { ...facts, recommended: { ...facts.recommended!, metrics: { NPV: "−18 000 000 ₽" } } };
    const changedSign = service(JSON.stringify(answer("NPV положительный: 18 000 000 ₽")));
    await expect(generateAdvice(negativeFacts, config, { fetchImpl: changedSign.fetchImpl })).rejects.toMatchObject({ code: "AI_UNVERIFIED_NUMBERS" });
    expect(changedSign.bodies).toHaveLength(2);
    const tinyPrice = service(JSON.stringify(answer("Сервис стоит 3 ₽ в год")));
    await expect(generateAdvice(facts, config, { fetchImpl: tinyPrice.fetchImpl })).rejects.toMatchObject({ code: "AI_UNVERIFIED_NUMBERS" });
  });

  it("перезапрашивает длинный ответ целиком и не выдаёт обрезанный текст", async () => {
    const tooLong = JSON.stringify(answer("а".repeat(1200) + " Пилот не подтверждён."));
    const recovered = service(tooLong, JSON.stringify(answer("NPV 4,0 млн ₽")));
    expect(await generateAdvice(facts, config, { fetchImpl: recovered.fetchImpl })).toEqual({ content: answer("NPV 4,0 млн ₽"), attempts: 2 });
    const repeated = service(tooLong);
    await expect(generateAdvice(facts, config, { fetchImpl: repeated.fetchImpl })).rejects.toMatchObject({ code: "AI_BAD_RESPONSE" });
    expect(repeated.bodies).toHaveLength(2);
  });

  it("отклоняет непредставимое число вместо обхода проверки через Number overflow", async () => {
    const overflow = service(JSON.stringify(answer("NPV " + "9".repeat(310) + " ₽")));
    await expect(generateAdvice(facts, config, { fetchImpl: overflow.fetchImpl })).rejects.toMatchObject({ code: "AI_UNVERIFIED_NUMBERS" });
    expect(overflow.bodies).toHaveLength(2);
  });
});
