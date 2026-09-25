import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseCsv } from "../../files/csv";
import { projectCsv } from "./csv";
import { fixtureResults } from "./test-fixtures";

const results = fixtureResults();
const csv = projectCsv(results, { projectName: "=cmd" });
const rows = parseCsv(csv);

function rowStarting(label: string): string[] {
  const row = rows.find((r) => r[0] === label);
  if (!row) throw new Error(`нет строки «${label}»`);
  return row;
}

describe("CSV проекта для русского Excel", () => {
  it("BOM, разделитель «;» и строки через CRLF", () => {
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain("\r\n");
    expect(/[^\r]\n/.test(csv)).toBe(false);
    expect(csv.split("\r\n")[0]).toBe("﻿Предварительная оценка роботизации;'=cmd");
  });

  it("имя проекта «=cmd» не становится формулой", () => {
    expect(rowStarting("Предварительная оценка роботизации")[1]).toBe("'=cmd");
    const lines = csv.slice(1).split("\r\n");
    expect(lines.some((l) => /^[=+@]/.test(l))).toBe(false);
    expect(lines.some((l) => l.split(";").some((c) => /^[=+@]/.test(c)))).toBe(false);
  });

  it("сравнение, затем денежные потоки, последней строкой — оговорка", () => {
    const iCompare = rows.findIndex((r) => r[0] === "Сравнение сценариев");
    const iFirstFlow = rows.findIndex((r) => (r[0] ?? "").startsWith("Денежный поток: "));
    expect(iCompare).toBeGreaterThan(0);
    expect(iFirstFlow).toBeGreaterThan(iCompare);
    expect(rows[rows.length - 1]).toEqual([
      "Результат является предварительной оценкой и требует верификации при обследовании объекта.",
    ]);
    const flows = rows.filter((r) => (r[0] ?? "").startsWith("Денежный поток: ")).map((r) => r[0]);
    expect(flows).toEqual(results.results.map((r) => `Денежный поток: ${r.name}${r.key === "p2" ? " ⚠" : ""}`));
  });

  it("числа — числами с десятичной запятой, единица — в подписи", () => {
    const header = rowStarting("Показатель");
    expect(header.slice(1)).toEqual([
      "Как есть",
      "Покупка — Ronavi H1500",
      "Услуга (RaaS) — Ronavi H1500",
      "Покупка — DMR Carrier P ⚠",
      "Услуга (RaaS) — DMR Carrier P",
    ]);
    expect(rowStarting("CAPEX, ₽").slice(1, 3)).toEqual(["0", "35420000"]);
    expect(rowStarting("NPV, ₽")[2]).toBe("640375");
    expect(rowStarting("Окупаемость (простая), лет")[2]).toBe("3,61");
    expect(rowStarting("ROI по ТЗ, %")[2]).toBe("140,3");
    expect(rowStarting("ROI чистый, %")[4]).toBe("-65,8");
    expect(rowStarting("CAPEX, ₽")[5]).toBe("—");
    expect(rowStarting("Ставка дисконтирования, %")[1]).toBe("12");
  });

  it("поток года 0 — минус CAPEX, отказ — сообщением", () => {
    const i = rows.findIndex((r) => r[0] === "Денежный поток: Покупка — Ronavi H1500");
    expect(rows[i + 2]?.[0]).toBe("Год");
    expect(rows[i + 3]).toEqual(["0", "35420000", "0", "0", "0", "0", "-35420000", "-35420000"]);
    const j = rows.findIndex((r) => r[0] === "Денежный поток: Услуга (RaaS) — DMR Carrier P");
    expect(rows[j + 1]?.[0]).toBe("Не рассчитан");
  });

  it("модуль клиентский: не импортирует exceljs", () => {
    for (const f of ["csv.ts", "rows.ts", "tables.ts"]) {
      const src = readFileSync(path.join(import.meta.dirname, f), "utf8");
      expect(src).not.toMatch(/exceljs|\.\/xlsx"/);
    }
  });
});
