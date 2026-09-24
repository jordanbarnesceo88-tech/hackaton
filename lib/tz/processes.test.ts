import { describe, it, expect } from "vitest";
import {
  FACILITY_PROCESSES,
  PROCESS_DEFS,
  SOLUTION_TYPE_DEFS,
  isFacilitySlug,
  processDef,
  processesForFacility,
  solutionTypeDef,
  type FacilitySlug,
} from "./processes";

const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const FACILITIES: FacilitySlug[] = ["warehouse", "airport", "medical"];

describe("SOLUTION_TYPE_DEFS", () => {
  it("slug'и уникальны и в kebab-case", () => {
    const slugs = SOLUTION_TYPE_DEFS.map((s) => s.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const s of slugs) expect(s).toMatch(KEBAB);
  });

  it("содержит 14 типов из утверждённого плана, включая «Прочее»", () => {
    expect(SOLUTION_TYPE_DEFS.map((s) => s.slug)).toEqual([
      "pallet-amr",
      "fmr",
      "pallet-shuttle",
      "pallet-asrs",
      "tote-amr",
      "g2p",
      "sorter",
      "inventory",
      "cleaner",
      "tug",
      "yard",
      "patrol",
      "delivery",
      "other",
    ]);
  });

  it("стационарные системы не мобильны, мобильные роботы — мобильны", () => {
    expect(solutionTypeDef("pallet-amr")).toMatchObject({ handlingClass: "jacking", mobile: true });
    expect(solutionTypeDef("fmr")).toMatchObject({ handlingClass: "fork", mobile: true });
    expect(solutionTypeDef("pallet-shuttle")).toMatchObject({ handlingClass: "station", mobile: false });
    expect(solutionTypeDef("tug")).toMatchObject({ handlingClass: "tug", mobile: true });
    expect(solutionTypeDef("nope")).toBeUndefined();
  });
});

describe("PROCESS_DEFS", () => {
  it("slug'и уникальны и в kebab-case", () => {
    const slugs = PROCESS_DEFS.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const s of slugs) expect(s).toMatch(KEBAB);
  });

  it("каждый тип решения в процессе существует", () => {
    const known = new Set(SOLUTION_TYPE_DEFS.map((s) => s.slug));
    for (const p of PROCESS_DEFS) {
      expect(p.solutionTypes.length, p.slug).toBeGreaterThan(0);
      for (const st of p.solutionTypes) expect(known.has(st), `${p.slug} → ${st}`).toBe(true);
    }
  });

  it("каждый процесс относится хотя бы к одному из трёх базовых типов объектов", () => {
    for (const p of PROCESS_DEFS) {
      expect(p.facilityTypes.some((f) => (FACILITIES as string[]).includes(f)), p.slug).toBe(true);
    }
  });

  it("экономика и имитация заявлены только для перемещения паллет (остальное — прототип, §5.7)", () => {
    expect(PROCESS_DEFS.filter((p) => p.calcSupported).map((p) => p.slug)).toEqual(["pallet-transport"]);
    expect(PROCESS_DEFS.filter((p) => p.simSupported).map((p) => p.slug)).toEqual(["pallet-transport"]);
  });

  it("у процесса со спросом есть хотя бы один параметр суммы, а подписи заполнены", () => {
    for (const p of PROCESS_DEFS) {
      expect(p.name.trim(), p.slug).toBeTruthy();
      expect(p.description.trim(), p.slug).toBeTruthy();
      expect(p.demandUnit.trim(), p.slug).toBeTruthy();
      expect(p.throughputUnit.trim(), p.slug).toBeTruthy();
      expect(p.demandFormula.trim(), p.slug).toBeTruthy();
      if (p.demand) expect(p.demand.sumParams.length, p.slug).toBeGreaterThan(0);
    }
  });

  it("персонал процесса задан парой: численность и зарплата вместе или ни одного", () => {
    for (const p of PROCESS_DEFS) {
      expect(p.headcountParam === null, p.slug).toBe(p.salaryParam === null);
    }
  });

  it("перемещение паллет ссылается на параметры склада из утверждённого плана", () => {
    expect(processDef("pallet-transport")).toMatchObject({
      demandUnit: "паллет/сут",
      throughputUnit: "паллет/ч",
      demand: {
        sumParams: ["inboundPalletsPerDay", "outboundPalletsPerDay", "internalPalletMovesPerDay"],
        excludeShareParam: "nonStandardCargoPct",
      },
      peakFactorParam: "peakFactor",
      headcountParam: "forkliftOperatorsCount",
      salaryParam: "forkliftSalaryRubMonth",
      constraints: {
        payloadParam: "avgPalletMassKg",
        aisleParam: "rackAisleWidthM",
        mainAisleParam: "mainAisleWidthM",
        tempRegimeParam: "storageTempRegime",
        heightParam: "maxStorageLevelM",
      },
      solutionTypes: ["pallet-amr", "fmr", "pallet-shuttle", "pallet-asrs", "tug"],
    });
    expect(processDef("nope")).toBeUndefined();
  });
});

describe("FACILITY_PROCESSES", () => {
  it("склад — 6 процессов, аэропорт — 4, медучреждение — 3, в порядке показа", () => {
    expect(FACILITY_PROCESSES.warehouse).toEqual([
      "pallet-transport",
      "storage",
      "piece-picking",
      "sorting",
      "inventory",
      "cleaning",
    ]);
    expect(FACILITY_PROCESSES.airport).toEqual(["baggage-transport", "apron-towing", "terminal-cleaning", "patrol"]);
    expect(FACILITY_PROCESSES.medical).toEqual(["hospital-delivery", "hospital-cleaning", "disinfection"]);
  });

  it("processesForFacility отдаёт определения по строке и пустой список для чужого типа", () => {
    expect(processesForFacility("warehouse").map((p) => p.slug)).toEqual([...FACILITY_PROCESSES.warehouse]);
    expect(processesForFacility("hospitality")).toEqual([]);
    expect(isFacilitySlug("medical")).toBe(true);
    expect(isFacilitySlug("clinic")).toBe(false);
  });

  it("согласован с facilityTypes процессов", () => {
    for (const f of FACILITIES) {
      for (const slug of FACILITY_PROCESSES[f]) expect(processDef(slug)?.facilityTypes).toContain(f);
    }
    const listed = FACILITIES.flatMap((f) => FACILITY_PROCESSES[f]);
    expect(new Set(listed)).toEqual(new Set(PROCESS_DEFS.map((p) => p.slug)));
  });
});
