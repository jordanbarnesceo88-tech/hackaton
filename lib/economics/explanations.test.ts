import { describe, it, expect } from "vitest";
import { EXPLANATIONS } from "./explanations";
import { economicsRows, PANEL_LABELS, REPORT_LABELS } from "@/components/calculator/economics-rows";
import { computeEconomics } from "./calculate";
import { makeAssumptions, makeCapacity, makeParams } from "./fixtures";

describe("реестр объяснений", () => {
  const r = computeEconomics(makeCapacity(), makeParams(), makeAssumptions());

  it("покрывает каждый показатель, который рендерят панель и отчёт", () => {
    if (!("quantity" in r)) throw new Error("ожидался считаемый результат");
    for (const labels of [PANEL_LABELS, REPORT_LABELS]) {
      for (const row of economicsRows(r, 90, labels)) {
        expect(EXPLANATIONS[row.key], `нет объяснения для ${row.key}`).toBeDefined();
      }
    }
  });

  it("объяснение отвечает на вопрос, а не переименовывает подпись", () => {
    // Объяснение короче ста знаков — это переформулированная подпись, а не ответ «откуда».
    // Порог грубый намеренно: он ловит не стиль, а отсутствие содержания.
    for (const [key, e] of Object.entries(EXPLANATIONS)) {
      expect(e.title.length, `${key}: пустой заголовок`).toBeGreaterThan(10);
      expect(e.body.length, `${key}: объяснение слишком короткое, чтобы что-то объяснить`)
        .toBeGreaterThan(100);
    }
  });

  it("заголовок сформулирован как вопрос читателя, а не как название поля", () => {
    // Заголовок, совпадающий с подписью показателя, ничего не добавляет: раскрытие должно
    // отвечать на сомнение, а не повторять то, на что человек и так смотрит.
    const labels = new Set(Object.values(PANEL_LABELS));
    for (const [key, e] of Object.entries(EXPLANATIONS)) {
      expect(labels.has(e.title), `${key}: заголовок повторяет подпись показателя`).toBe(false);
    }
  });
});
