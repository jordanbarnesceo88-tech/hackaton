import { describe, expect, it } from "vitest";
import { BOTTLENECK_LABELS, NO_RUN_VALUE, VERDICT_LABELS, simSummaryRows } from "./export-rows";
import { H1500_ROBOT, warehouseBaseInput } from "./fixtures";
import { toStored } from "./metrics";
import { runSimSync } from "./runner";

describe("simSummaryRows", () => {
  it("первые десять строк — показатели сверки с расчётом, в заданном порядке", () => {
    const rows = simSummaryRows(toStored(runSimSync(warehouseBaseInput(11))));
    expect(rows.slice(0, 10).map(([label]) => label)).toEqual([
      "Рассчитано, пал./ч",
      "Достигнуто, пал./ч",
      "Загрузка парка, %",
      "Простой, %",
      "Зарядка, %",
      "Ожидание у точек, %",
      "Очередь, макс.",
      "Ожидание p95, мин",
      "Узкое место",
      "Вердикт",
    ]);
    expect(rows[0]![1]).toBe(129.5);
    expect(rows[8]![1]).toBe("нет");
    expect(rows[9]![1]).toBe(VERDICT_LABELS.CONFIRMED);
  });

  it("числа округлены до десятых и остаются числами; «не подтверждён» называет узкое место", () => {
    const rows = simSummaryRows(toStored(runSimSync(warehouseBaseInput(3))));
    for (const [, value] of rows.slice(0, 8)) {
      expect(typeof value).toBe("number");
      expect(Math.round((value as number) * 10) / 10).toBe(value);
    }
    expect(rows[9]![1]).toBe(`Не подтверждён: ${BOTTLENECK_LABELS.fleet}`);
  });

  it("незаполненные поля перебора и нормы подписаны словами", () => {
    const rows = new Map(simSummaryRows(toStored(runSimSync(warehouseBaseInput(11)))));
    expect(rows.get("Минимальный парк по имитации")).toBe("не определён");
    expect(rows.get("Парк по норме организатора")).toBe("нет нормы");
    expect(rows.get("Вердикт при парке по норме")).toBe("не проверялся");
    expect(rows.get("Модель имитации")).toBe("sim-1.0.0");
  });

  it("парк избыточен — отмечено в вердикте", () => {
    const stored = { ...toStored(runSimSync(warehouseBaseInput(11))), oversized: true };
    expect(new Map(simSummaryRows(stored)).get("Вердикт")).toBe(`${VERDICT_LABELS.CONFIRMED} (парк избыточен)`);
  });
});

describe("simSummaryRows без прогона", () => {
  it("вход отклонён проверкой — показатели прогона словами, а не «Простой 0 %»; парк — запрошенный", () => {
    for (const input of [
      warehouseBaseInput(5, { robots: { ...H1500_ROBOT, count: 5, payloadKg: 100 } }),
      warehouseBaseInput(5, { robots: { ...H1500_ROBOT, count: 5, speedMps: 0 } }),
    ]) {
      const rows = new Map(simSummaryRows(toStored(runSimSync(input))));
      for (const label of [
        "Достигнуто, пал./ч",
        "Загрузка парка, %",
        "Простой, %",
        "Зарядка, %",
        "Ожидание у точек, %",
        "Очередь, макс.",
        "Ожидание p95, мин",
        "Обслужено заданий пика, %",
      ]) {
        expect(rows.get(label)).toBe(NO_RUN_VALUE);
      }
      expect(rows.get("Рассчитано, пал./ч")).toBe(129.5);
      expect(rows.get("Роботов в прогоне")).toBe(5);
    }
  });
});
