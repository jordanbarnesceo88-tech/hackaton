import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import type { ParamSpec } from "../types";
import { missingProcessParamKeys, paramKeysOfProcess, processParamKeys } from "./coverage";
import { parseParamsSheets } from "./sheets";
import { applyDefaults } from "./schema";
import { paramsTemplateCsv } from "./template";
import { decodeText, parseCsv } from "../../files/csv";
import { encodeCp1251, spec, WAREHOUSE_ROWS } from "./test-fixtures";
import { PROCESS_DEFS } from "../processes";

const FACILITIES = ["warehouse", "airport", "medical"] as const;

describe("processParamKeys", () => {
  it("склад: спрос, пик, персонал, зарплата и ограничения перемещения паллет", () => {
    const p = PROCESS_DEFS.find((x) => x.slug === "pallet-transport");
    expect(p && paramKeysOfProcess(p)).toEqual([
      "inboundPalletsPerDay",
      "outboundPalletsPerDay",
      "internalPalletMovesPerDay",
      "nonStandardCargoPct",
      "peakFactor",
      "forkliftOperatorsCount",
      "forkliftSalaryRubMonth",
      "avgPalletMassKg",
      "rackAisleWidthM",
      "mainAisleWidthM",
      "storageTempRegime",
      "maxStorageLevelM",
    ]);
    const keys = processParamKeys("warehouse");
    expect(keys).toContain("cleaningsPerDay");
    expect(keys).toEqual([...keys].sort());
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("неизвестный тип объекта — пусто", () => {
    expect(processParamKeys("spaceport")).toEqual([]);
  });

  it("missingProcessParamKeys называет недостающие ключи только своего объекта", () => {
    const defs = processParamKeys("airport").map((key) => spec({ key, facility: "airport" }));
    expect(missingProcessParamKeys(defs, "airport")).toEqual([]);
    expect(missingProcessParamKeys(defs.slice(1), "airport")).toEqual([processParamKeys("airport")[0]]);
    expect(missingProcessParamKeys(defs, "warehouse")).toEqual(processParamKeys("warehouse"));
  });
});

/**
 * Перекрёстная проверка с настоящими описаниями параметров (T1.1, lib/data/organizer). Модуль
 * генерируется параллельной задачей; пока его нет, проверка пропускается, а после появления
 * работает в каждом прогоне: процессы обеспечены параметрами, лист организатора «Склад»
 * сопоставляется с описаниями, шаблон каждого объекта читается обратно без ошибок.
 */
const PARAMS_MODULE = fileURLToPath(new URL("../../data/organizer/params.ts", import.meta.url));
const hasOrganizerParams = existsSync(PARAMS_MODULE);

async function loadParamSpecs(): Promise<readonly ParamSpec[]> {
  const id: string = "@/lib/data/organizer/params";
  const mod = (await import(/* @vite-ignore */ id)) as { PARAM_SPECS?: readonly ParamSpec[] };
  if (!mod.PARAM_SPECS) throw new Error("lib/data/organizer/params не экспортирует PARAM_SPECS");
  return mod.PARAM_SPECS;
}

describe.skipIf(!hasOrganizerParams)("описания параметров организатора (lib/data/organizer)", () => {
  it("каждый ключ, на который ссылаются процессы, есть среди описаний своего объекта", async () => {
    const specs = await loadParamSpecs();
    for (const f of FACILITIES) expect(missingProcessParamKeys(specs, f), f).toEqual([]);
  });

  it("лист «Склад» организатора сопоставляется: ≥ 40 строк из 42, без ошибок", async () => {
    const defs = (await loadParamSpecs()).filter((d) => d.facility === "warehouse");
    const rows: string[][] = [
      ["Параметр", "Ед. изм.", "Базовое значение", "Диапазон (min)", "Диапазон (max)"],
      ...WAREHOUSE_ROWS.map(([, label, unit, base, min, max]) => [label, unit, String(base), String(min), String(max)]),
    ];
    const r = parseParamsSheets([{ name: "Склад", rows }], defs);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.found).toBeGreaterThanOrEqual(40);
    expect(r.report.filter((i) => i.severity === "error")).toEqual([]);
  });

  it("шаблон каждого объекта читается обратно в значения по умолчанию без ошибок", async () => {
    const specs = await loadParamSpecs();
    for (const f of FACILITIES) {
      const defs = specs.filter((d) => d.facility === f);
      const r = parseParamsSheets([{ name: null, rows: parseCsv(paramsTemplateCsv(defs)) }], defs);
      expect(r.ok, f).toBe(true);
      if (!r.ok) continue;
      expect(r.report.filter((i) => i.severity === "error"), f).toEqual([]);
      expect(r.values, f).toEqual(applyDefaults(defs, {}));
    }
  });

  it("CSV русского Excel (Windows-1251: «м?», «1200?800?1600», «?18 °C») читается без ошибок", async () => {
    const specs = await loadParamSpecs();
    const num = (v: number | string | null) => (typeof v === "number" ? String(v).replace(".", ",") : (v ?? ""));
    const q = (s: string) => (/[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
    for (const f of FACILITIES) {
      const defs = specs.filter((d) => d.facility === f);
      const defaults = applyDefaults(defs, {});

      // Наш шаблон, открытый и пересохранённый как «CSV (разделители — точки с запятой)».
      const template = decodeText(encodeCp1251(paramsTemplateCsv(defs).replace(/^﻿/, "")));
      const t = parseParamsSheets([{ name: null, rows: parseCsv(template) }], defs);
      expect(t.ok, f).toBe(true);
      if (t.ok) {
        expect(t.report.filter((i) => i.severity === "error"), `${f}: шаблон`).toEqual([]);
        expect(t.values, `${f}: шаблон`).toEqual(defaults);
      }

      // Лист в раскладке организатора с подписями, единицами и базовыми значениями описаний.
      const lines = [
        "Параметр;Ед. изм.;Базовое значение;Диапазон (min);Диапазон (max)",
        ...defs.map((d) => [d.label, d.unit ?? "-", num(d.base), num(d.min), num(d.max)].map(q).join(";")),
      ];
      const sheet = decodeText(encodeCp1251(lines.join("\r\n")));
      expect(sheet, f).toContain("?");
      const o = parseParamsSheets([{ name: null, rows: parseCsv(sheet) }], defs);
      expect(o.ok, f).toBe(true);
      if (o.ok) {
        expect(o.report.filter((i) => i.severity === "error"), `${f}: лист`).toEqual([]);
        expect(o.values, `${f}: лист`).toEqual(defaults);
      }
    }
  });
});
