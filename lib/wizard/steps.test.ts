import { describe, it, expect } from "vitest";
import { parseWizardParams, buildWizardQuery, WIZARD_STEPS } from "./steps";

describe("занятость по задачам в query-строке (A-9)", () => {
  it("читается по префиксу и попадает в params.taskStaffing", () => {
    const s = parseWizardParams({
      area: "8000", ops: "5000", staff: "40",
      task_cleaning: "6", "task_class-amr-transport": "12",
    });
    expect(s.params.taskStaffing).toEqual({ cleaning: 6, "class-amr-transport": 12 });
  });

  it("ноль — это ответ «никто не занят», а не пропуск", () => {
    // Отличие от площади и персонала, где ноль отклоняется как вырожденный ввод: там ноль
    // ломает расчёт, здесь он его определяет. resolveTaskFte различает их так же.
    const s = parseWizardParams({ task_cleaning: "0" });
    expect(s.params.taskStaffing).toEqual({ cleaning: 0 });
  });

  it("отрицательное и мусор отбрасываются, а не превращаются в ноль", () => {
    const s = parseWizardParams({ task_a: "-3", task_b: "не число", task_c: "4" });
    expect(s.params.taskStaffing).toEqual({ c: 4 });
  });

  it("отсутствие ключей означает отсутствие карты, а не пустую карту", () => {
    // Пустая карта и её отсутствие — разные инструкции движку: по отсутствию он берёт
    // норматив категории, по нулю — считает, что задачей никто не занят.
    expect(parseWizardParams({ area: "100" }).params.taskStaffing).toBeUndefined();
  });

  it("число ключей ограничено — query-строка это чужой ввод (Г-3)", () => {
    const q: Record<string, string> = {};
    for (let i = 0; i < 500; i++) q[`task_slug${i}`] = "1";
    const got = parseWizardParams(q).params.taskStaffing ?? {};
    expect(Object.keys(got).length).toBeLessThanOrEqual(40);
  });

  it("занятость попадает в provided — иначе неполный набор её теряет", () => {
    // Регрессия, пойманная e2e: `provided` нёс три числа и не нёс занятость, поэтому экран
    // расчёта, собиравший параметры из него, снова отказывался считать — сразу после того,
    // как человек заполнил экран «кто чем занят».
    const s = parseWizardParams({ area: "8000", ops: "0", staff: "25", task_cleaning: "6" });
    expect(s.complete).toBe(false);
    expect(s.provided.taskStaffing).toEqual({ cleaning: 6 });
    const q = buildWizardQuery({ facility: "warehouse", params: s.provided });
    expect(q).toMatch(/task_cleaning=6/);
  });

  it("сборка и разбор — обратные операции и для занятости", () => {
    const taskStaffing = { cleaning: 6, "class-amr-transport": 0 };
    const q = buildWizardQuery({
      facility: "warehouse",
      params: { areaM2: 8000, opsPerDay: 5000, staffCount: 40, taskStaffing },
    });
    const back = parseWizardParams(Object.fromEntries(new URLSearchParams(q)));
    expect(back.params.taskStaffing).toEqual(taskStaffing);
  });
});

describe("parseWizardParams", () => {
  it("разбирает полный набор", () => {
    const s = parseWizardParams({
      industry: "retail", facility: "warehouse", area: "1000", ops: "500", staff: "10",
    });
    expect(s.industry).toBe("retail");
    expect(s.facility).toBe("warehouse");
    expect(s.params).toEqual({ areaM2: 1000, opsPerDay: 500, staffCount: 10 });
    expect(s.complete).toBe(true);
  });

  it("мусор в числах не роняет разбор и не проникает в расчёт", () => {
    const s = parseWizardParams({
      industry: "retail", facility: "warehouse", area: "не число", ops: "-5", staff: "",
    });
    // Все три поля конечны — движок не увидит NaN ни при каком вводе в адресной строке.
    expect(Number.isFinite(s.params.areaM2)).toBe(true);
    expect(Number.isFinite(s.params.opsPerDay)).toBe(true);
    expect(Number.isFinite(s.params.staffCount)).toBe(true);
    // Отрицательное — мусор, а не вывод: заменено значением по умолчанию, как и в форме.
    expect(s.params.opsPerDay).toBeGreaterThan(0);
    // И набор не считается собранным: пользователя вернут на шаг параметров.
    expect(s.complete).toBe(false);
  });

  it("принятые поля переживают отклонение соседнего (И-4)", () => {
    // Человек ввёл площадь 8000 и персонал 25, а объём операций — 0. Ноль отклоняется, и это
    // верно. Неверно было другое: `complete: false` заставлял вызывающего передать дальше
    // params: null, поэтому вместе с нулём терялись ОБА годных числа, а калькулятор молча
    // считал по 1000 / 500 / 10 — то есть отвечал на вопрос, которого никто не задавал.
    const s = parseWizardParams({ area: "8000", ops: "0", staff: "25" });
    expect(s.complete).toBe(false);
    expect(s.rejected).toEqual(["ops"]);
    expect(s.provided).toEqual({ areaM2: 8000, staffCount: 25 });
  });

  it("годные поля доезжают до следующего экрана через query", () => {
    const s = parseWizardParams({ area: "8000", ops: "0", staff: "25" });
    const q = buildWizardQuery({ facility: "warehouse", params: s.provided });
    expect(q).toMatch(/area=8000/);
    expect(q).toMatch(/staff=25/);
    expect(q).not.toMatch(/ops=/);
  });

  it("provided пуст, когда не прислали ничего — это не то же самое, что значения по умолчанию", () => {
    const s = parseWizardParams({ industry: "retail" });
    expect(s.provided).toEqual({});
    // params при этом заполнены умолчаниями, и различить их можно только по provided.
    expect(s.params.areaM2).toBeGreaterThan(0);
  });

  it("неполный набор не считается завершённым", () => {
    expect(parseWizardParams({ industry: "retail" }).complete).toBe(false);
    expect(parseWizardParams({ industry: "retail", facility: "warehouse" }).complete).toBe(false);
  });

  it("массив в параметре (?industry=a&industry=b) берёт первое значение, а не падает", () => {
    expect(parseWizardParams({ industry: ["retail", "logistics"] }).industry).toBe("retail");
  });

  it("название объекта обрезается до 80 символов", () => {
    const long = "х".repeat(200);
    expect(parseWizardParams({ obj: long }).objectName!.length).toBe(80);
  });

  it("сборка и разбор — обратные операции", () => {
    const state = {
      industry: "retail",
      facility: "warehouse",
      params: { areaM2: 1000, opsPerDay: 500, staffCount: 10 },
    };
    const back = parseWizardParams(
      Object.fromEntries(new URLSearchParams(buildWizardQuery(state)))
    );
    expect(back.params).toEqual(state.params);
    expect(back.industry).toBe(state.industry);
    expect(back.facility).toBe(state.facility);
    expect(back.complete).toBe(true);
  });
});

describe("WIZARD_STEPS", () => {
  it("шаги перечислены по порядку и без дублей", () => {
    const keys = WIZARD_STEPS.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys[0]).toBe("industry");
    expect(keys.at(-1)).toBe("calc");
  });
});

describe("отказ от ввода различим и объясним", () => {
  const base = { industry: "retail", facility: "warehouse", area: "1000", ops: "500" };

  it("ноль в персонале не принимается: это вырожденный ввод, а не «мало»", () => {
    // Находка ревью: с нулевым персоналом замещать некого, каждое решение становится
    // убыточным, и экран уверенно объяснял это тем, что «объём операций слишком мал» —
    // уверенное неверное объяснение вместо просьбы заполнить поле.
    const s = parseWizardParams({ ...base, staff: "0" });
    expect(s.complete).toBe(false);
    expect(s.rejected).toContain("staff");
  });

  it("отличает «прислали негодное» от «не прислали»", () => {
    expect(parseWizardParams({ ...base, staff: "-5" }).rejected).toEqual(["staff"]);
    expect(parseWizardParams(base).rejected).toEqual([]);
  });

  it("считает набор полным без отрасли: она не входит в расчёт", () => {
    // Ссылка, у которой отрасль потерялась при пересылке, не должна молча выбрасывать все
    // три числа и стартовать с 1000/500/10, противореча тому, что видно в адресной строке.
    const s = parseWizardParams({ facility: "warehouse", area: "1000", ops: "500", staff: "10" });
    expect(s.complete).toBe(true);
    expect(s.params.staffCount).toBe(10);
  });
});
