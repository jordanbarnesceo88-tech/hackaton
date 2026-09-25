import { describe, expect, it, vi } from "vitest";
import type { NormRow } from "../catalog/queries";
import { DEFAULT_NORMS, normDef, NORM_DEFS } from "../tz/norms";
import { applyNormValues, clampNorm, normApiRows, validateNormUpdate } from "./norms";

// Нормативы через API: проверка тела PUT, прижатие к границам, запись с журналом (на
// подменённом клиенте БД) и форма ответа GET.

describe("validateNormUpdate", () => {
  it("принимает известные ключи с числами и причину", () => {
    const res = validateNormUpdate({ values: { utilization: 0.8, reservePct: 0.2 }, reason: "  пилот  " });
    expect(res).toEqual({ ok: true, value: { values: [["utilization", 0.8], ["reservePct", 0.2]], reason: "пилот" } });
  });

  it("отклоняет неизвестный ключ, не-число, пустые values и лишние поля", () => {
    const bad = validateNormUpdate({ values: { utilisation: 0.8, reservePct: "0.2", availability: Number.NaN }, extra: 1 });
    expect(bad.ok).toBe(false);
    const errors = bad.ok ? [] : bad.errors;
    expect(errors.join(" ")).toMatch(/Неизвестные поля extra/);
    expect(errors.join(" ")).toMatch(/«utilisation» неизвестен/);
    expect(errors.filter((e) => e.includes("значение — число"))).toHaveLength(2);
    expect(validateNormUpdate({ values: {} }).ok).toBe(false);
    expect(validateNormUpdate([]).ok).toBe(false);
    expect(validateNormUpdate({ values: { utilization: 0.8 }, reason: 5 }).ok).toBe(false);
  });
});

describe("clampNorm", () => {
  it("прижимает к [min, max], null-граница не ограничивает", () => {
    expect(clampNorm({ min: 0.7, max: 0.85 }, 0.99)).toBe(0.85);
    expect(clampNorm({ min: 0.7, max: 0.85 }, 0.5)).toBe(0.7);
    expect(clampNorm({ min: 0, max: null }, 1e9)).toBe(1e9);
  });
});

function fakeDb(rows: Record<string, number>) {
  const calls: { op: string; args: unknown }[] = [];
  const db = {
    norm: {
      findUnique: vi.fn(async ({ where }: { where: { key: string } }) =>
        where.key in rows ? { key: where.key, value: rows[where.key] } : null,
      ),
      update: vi.fn(async (args: unknown) => calls.push({ op: "norm.update", args })),
      create: vi.fn(async (args: unknown) => calls.push({ op: "norm.create", args })),
    },
    changeLog: { create: vi.fn(async (args: unknown) => calls.push({ op: "changeLog.create", args })) },
  };
  return { db, calls };
}

describe("applyNormValues", () => {
  it("пишет значение, признак правки и журнал; вне диапазона — граница с пояснением", async () => {
    const util = normDef("utilization");
    const { db, calls } = fakeDb({ utilization: util.value });
    const out = await applyNormValues(db as never, { values: [["utilization", 0.99]], reason: null }, { userId: "a1", via: "session" });
    expect(out[0]).toMatchObject({ key: "utilization", requested: 0.99, oldValue: util.value, newValue: util.max, clamped: true, status: "updated" });
    expect(out[0]?.message).toMatch(/вне допустимого диапазона/);
    expect(calls.map((c) => c.op)).toEqual(["norm.update", "changeLog.create"]);
    expect(calls[0]?.args).toEqual({ where: { key: "utilization" }, data: { value: util.max, editedByAdmin: true, updatedById: "a1" } });
    expect(calls[1]?.args).toEqual({
      data: {
        entity: "norm",
        entityId: "utilization",
        userId: "a1",
        field: "value",
        autoValue: util.value,
        oldValue: util.value,
        newValue: util.max,
        unit: util.unit,
        reason: "Изменено через API",
      },
    });
  });

  it("то же значение — без записи и без журнала; зафиксированный норматив не меняется", async () => {
    const payroll = normDef("payrollMultiplier");
    const { db, calls } = fakeDb({ utilization: 0.8, payrollMultiplier: payroll.value });
    const out = await applyNormValues(
      db as never,
      { values: [["utilization", 0.8], ["payrollMultiplier", 2]], reason: "проверка" },
      { userId: null, via: "bearer" },
    );
    expect(out.map((o) => o.status)).toEqual(["unchanged", "unchanged"]);
    expect(out[1]).toMatchObject({ clamped: true, newValue: payroll.value });
    expect(out[1]?.message).toMatch(/зафиксирован/);
    expect(calls).toEqual([]);
  });

  it("строки ещё нет (данные не засеяны) — создаётся с метаданными из кода; токен пишет журнал без пользователя", async () => {
    const def = normDef("reservePct");
    const { db, calls } = fakeDb({});
    await applyNormValues(db as never, { values: [["reservePct", 0.2]], reason: null }, { userId: null, via: "bearer" });
    expect(calls[0]).toMatchObject({
      op: "norm.create",
      args: { data: { key: "reservePct", value: 0.2, label: def.label, min: def.min, max: def.max, editedByAdmin: true, updatedById: null } },
    });
    expect(calls[1]).toMatchObject({ op: "changeLog.create", args: { data: { userId: null, oldValue: def.value, reason: "Изменено через API (токен администратора)" } } });
  });
});

describe("normApiRows", () => {
  it("пустая таблица — все нормативы из кода, итоговые значения — умолчания", () => {
    const res = normApiRows([]);
    expect(res.source).toBe("code");
    expect(res.norms).toHaveLength(NORM_DEFS.length);
    for (const n of res.norms) expect(n.effectiveValue).toBe(DEFAULT_NORMS[n.key as keyof typeof DEFAULT_NORMS]);
  });

  it("строки БД: значение, умолчание и итог расчёта; устаревший ключ — без итога", () => {
    const row = (key: string, value: number): NormRow => ({
      key,
      value,
      label: key,
      unit: null,
      origin: "estimate",
      basis: "",
      sourceUrl: null,
      sourceRef: null,
      min: null,
      max: null,
      group: "",
      order: 0,
      editedByAdmin: true,
      updatedAt: new Date("2026-09-24T00:00:00Z"),
    });
    const res = normApiRows([row("utilization", 0.99), row("legacyKey", 1)]);
    expect(res.source).toBe("db");
    const util = res.norms.find((n) => n.key === "utilization");
    // В таблице 0,99, но расчёт прижимает к границе кода.
    expect(util).toMatchObject({ value: 0.99, defaultValue: normDef("utilization").value, effectiveValue: normDef("utilization").max });
    expect(res.norms.find((n) => n.key === "legacyKey")).toMatchObject({ defaultValue: null, effectiveValue: null });
    expect(util?.updatedAt).toBe("2026-09-24T00:00:00.000Z");
  });
});
