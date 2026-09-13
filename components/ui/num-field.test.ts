import { describe, it, expect } from "vitest";
import { displayValue, nullableDisplayValue, computingOn } from "./num-field";

describe("displayValue", () => {
  it("shows the model's value when nothing is being typed", () => {
    expect(displayValue(null, 500)).toBe("500");
  });

  it("keeps the field empty while it is being cleared to retype", () => {
    // Binding to the number made Number("") === 0 rewrite the box the instant it was emptied.
    expect(displayValue("", 500)).toBe("");
  });

  it("keeps half-typed input", () => {
    expect(displayValue("-", 5)).toBe("-");
    expect(displayValue("12.", 12)).toBe("12.");
  });

  it("keeps the draft while the model agrees with it", () => {
    expect(displayValue("750", 750)).toBe("750");
    expect(displayValue("0.35", 0.35)).toBe("0.35");
  });

  it("lets the model win when it clamped what was typed", () => {
    // AssumptionsPanel clamps a 0..1 fraction: typing 5 must not leave "5" on screen while the
    // page recomputes against 1.
    expect(displayValue("5", 1)).toBe("1");
    expect(displayValue("-3", 0)).toBe("0");
  });

  it("falls back to 0 for a non-finite model value", () => {
    expect(displayValue(null, NaN)).toBe("0");
    expect(displayValue("5", NaN)).toBe("0");
  });

  it("restores the model's number once the field is left", () => {
    // И-6. Очистить поле можно, а вот УЙТИ из него пустым — нет: черновик сбрасывается на
    // blur, и коробка снова показывает то число, по которому считает страница.
    expect(displayValue(null, 40)).toBe("40");
  });
});

describe("computingOn", () => {
  it("names the number the page computes with when the box was cleared", () => {
    // И-6, в двух вызовах: коробка пуста, модель держит 40, и без этого числа страница
    // считает по величине, которой на экране нет нигде.
    const shown = displayValue("", 40);
    expect(shown).toBe("");
    expect(computingOn(shown, 40)).toBe(40);
  });

  it("names it for half-typed states too — they carry no number either", () => {
    expect(computingOn(displayValue("-", 5), 5)).toBe(5);
    // «12.» набирается поверх модели, которая держит совсем другое число.
    expect(computingOn(displayValue("12.", 40), 40)).toBe(40);
  });

  it("says nothing when the box shows the model's number", () => {
    expect(computingOn(displayValue(null, 40), 40)).toBeNull();
    expect(computingOn(displayValue("750", 750), 750)).toBeNull();
    // Точка в конце — это всё ещё то же самое число.
    expect(computingOn(displayValue("12.", 12), 12)).toBeNull();
    // Модель отбила набранное, и коробка уже переписана её значением.
    expect(computingOn(displayValue("5", 1), 1)).toBeNull();
  });

  it("treats an empty box as hiding a zero, not as showing one", () => {
    // Number("") === 0, но пустая коробка ноль не показывает: страница считает по нулю, а на
    // экране его нет. Приравнять одно к другому — то же молчание, что И-6.
    expect(computingOn("", 0)).toBe(0);
    expect(computingOn("0", 0)).toBeNull();
  });

  it("has nothing to announce when the model itself is empty or unusable", () => {
    // Пусто в поле и `null` в модели — это одно и то же утверждение «числа нет».
    expect(computingOn("", null)).toBeNull();
    expect(computingOn("-", null)).toBeNull();
    // NaN назвать нечем: подпись «расчёт идёт по NaN» ничего не объясняет.
    expect(computingOn("", NaN)).toBeNull();
  });
});

describe("nullableDisplayValue", () => {
  it("shows an empty box for an empty model", () => {
    expect(nullableDisplayValue(null, null)).toBe("");
    expect(nullableDisplayValue("", null)).toBe("");
  });

  it("keeps zero on screen — zero is an answer, not an empty field", () => {
    // Ноль («этой работой никто не занят») и пусто («не знаю») — разные инструкции движку.
    expect(nullableDisplayValue(null, 0)).toBe("0");
    expect(nullableDisplayValue("0", 0)).toBe("0");
    // Если модель удержала ноль, коробка не имеет права выглядеть пустой.
    expect(nullableDisplayValue("", 0)).toBe("0");
  });

  it("keeps the draft while the model agrees with it", () => {
    expect(nullableDisplayValue("6.3", 6.3)).toBe("6.3");
    expect(nullableDisplayValue("6.", 6)).toBe("6.");
    expect(nullableDisplayValue("-", null)).toBe("-");
  });

  it("lets the model win when the field refused what was typed", () => {
    // `onChange` не принимает число меньше `min`, поэтому «−1» до модели не доходит. Раньше
    // оно оставалось в коробке: экран показывал −1, страница считала по 5.
    expect(nullableDisplayValue("-1", 5)).toBe("5");
    expect(nullableDisplayValue("-1", null)).toBe("");
  });

  it("shows nothing for a non-finite model value", () => {
    expect(nullableDisplayValue(null, NaN)).toBe("");
  });
});
