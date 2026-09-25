import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { catalogProduct } from "../data/organizer/catalog";
import { paramSpecsFor } from "../data/organizer/params";
import { validateScenarioSpecs } from "../projects/validate";
import { hasErrors, validateParamValues } from "../tz/params/validate";
import { processesForFacility } from "../tz/processes";
import { validateProductSeeds } from "./import";
import {
  EXAMPLE_IMPORT_KEYS,
  EXAMPLE_PRODUCT_SLUG,
  exampleImportSeed,
  listOperations,
  OPENAPI,
  type HttpMethod,
  type OpenApiOperation,
} from "./openapi";

// Сверка описания API с файлами маршрутов (ТЗ §4.2.5 — документировать все API): каждый
// экспортированный обработчик в app/api/v1 описан в OPENAPI, и каждое описание /api/v1 имеет
// обработчик. Плюс проверки самого документа: ссылки на схемы разрешаются, у каждой операции
// есть доступ и ответы, примеры проходят те же проверки, что и настоящие запросы, и не содержат
// выдуманных чисел.

const ROOT = path.resolve(import.meta.dirname, "../..");
const V1_DIR = path.join(ROOT, "app", "api", "v1");
const HANDLER_RE = /export\s+async\s+function\s+(GET|POST|PUT|DELETE)\b/g;

/** Все route.ts в каталоге (рекурсивно). */
function routeFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...routeFiles(full));
    else if (entry.name === "route.ts") out.push(full);
  }
  return out;
}

/** Путь API по файлу: app/api/v1/catalog/[slug]/route.ts → /api/v1/catalog/{slug}. */
function apiPathOf(file: string): string {
  const rel = path.relative(path.join(ROOT, "app"), path.dirname(file)).split(path.sep);
  return `/${rel.map((seg) => seg.replace(/^\[(.+)\]$/, "{$1}")).join("/")}`;
}

/** Методы, экспортированные файлом маршрута. */
function handlersOf(file: string): HttpMethod[] {
  const src = readFileSync(file, "utf8");
  return [...src.matchAll(HANDLER_RE)].map((m) => (m[1] as string).toLowerCase() as HttpMethod);
}

describe("OPENAPI ↔ файлы маршрутов", () => {
  const files = routeFiles(V1_DIR);

  it("в app/api/v1 есть маршруты", () => {
    expect(files.length).toBeGreaterThanOrEqual(9);
  });

  it("каждый обработчик app/api/v1 описан в OPENAPI.paths", () => {
    const missing: string[] = [];
    for (const file of files) {
      const p = apiPathOf(file);
      const methods = handlersOf(file);
      expect(methods.length, `${p}: нет экспортированных обработчиков`).toBeGreaterThan(0);
      for (const m of methods) if (!OPENAPI.paths[p]?.[m]) missing.push(`${m.toUpperCase()} ${p}`);
    }
    expect(missing).toEqual([]);
  });

  it("каждая операция /api/v1 из OPENAPI имеет обработчик", () => {
    const actual = new Set(files.flatMap((f) => handlersOf(f).map((m) => `${m} ${apiPathOf(f)}`)));
    const orphans = listOperations()
      .filter((o) => o.path.startsWith("/api/v1/"))
      .map((o) => `${o.method} ${o.path}`)
      .filter((key) => !actual.has(key));
    expect(orphans).toEqual([]);
  });

  it("описанные служебные маршруты вне v1 существуют: /api/health и /api/templates/{facility}", () => {
    for (const op of listOperations().filter((o) => !o.path.startsWith("/api/v1/"))) {
      const dir = op.path.replace(/^\//, "").replace(/\{([^}]+)\}/g, "[$1]").split("/");
      const file = path.join(ROOT, "app", ...dir, "route.ts");
      expect(existsSync(file), `${op.path}: нет файла ${file}`).toBe(true);
      expect(handlersOf(file)).toContain(op.method);
    }
  });
});

describe("документ OPENAPI", () => {
  it("OpenAPI 3.1 и сериализуется в JSON без потерь", () => {
    expect(OPENAPI.openapi).toBe("3.1.0");
    expect(JSON.parse(JSON.stringify(OPENAPI))).toEqual(OPENAPI);
  });

  it("все $ref указывают на существующие схемы", () => {
    const refs = [...JSON.stringify(OPENAPI).matchAll(/"\$ref":"#\/components\/schemas\/([^"]+)"/g)].map((m) => m[1] as string);
    expect(refs.length).toBeGreaterThan(10);
    const broken = [...new Set(refs)].filter((r) => !(r in OPENAPI.components.schemas));
    expect(broken).toEqual([]);
  });

  it("у каждой операции есть id, описание, доступ, безопасность по доступу и ответы", () => {
    const ids = new Set<string>();
    for (const { path: p, method, op } of listOperations()) {
      const where = `${method.toUpperCase()} ${p}`;
      expect(op.operationId, where).toMatch(/^[a-zA-Z]+$/);
      expect(ids.has(op.operationId), `${where}: повтор operationId`).toBe(false);
      ids.add(op.operationId);
      expect(op.summary.length, where).toBeGreaterThan(3);
      expect(op.description.length, where).toBeGreaterThan(20);
      expect(Object.keys(op.responses).length, where).toBeGreaterThan(0);
      expect(op.tags.every((t) => OPENAPI.tags.some((tag) => tag.name === t)), where).toBe(true);
      const schemes = op.security.flatMap((s) => Object.keys(s)).sort();
      const expected: Record<OpenApiOperation["x-access"], string[]> = {
        public: [],
        user: ["sessionCookie"],
        admin: ["adminToken", "sessionCookie"],
      };
      expect(schemes, where).toEqual(expected[op["x-access"]]);
      for (const s of schemes) expect(OPENAPI.components.securitySchemes[s], where).toBeDefined();
      // Записи и закрытые чтения описывают отказ доступа.
      if (op["x-access"] !== "public") expect(op.responses["401"], `${where}: нет ответа 401`).toBeDefined();
      if (op["x-access"] === "admin") expect(op.responses["403"], `${where}: нет ответа 403`).toBeDefined();
    }
  });

  it("в описании и на странице нет строк, зарезервированных за e2e-тестами прежней модели", () => {
    const forbidden = [
      "Рассчитать",
      "Далее",
      "Сохранить расчёт",
      "Сохранено",
      "Открыть отчёт",
      "Отчёт ROI",
      "не оферта",
      "Проверить свой объект",
      "Посмотреть на готовом примере",
      "Откуда цифры",
    ];
    const page = readFileSync(path.join(ROOT, "app", "api-docs", "page.tsx"), "utf8");
    const doc = JSON.stringify(OPENAPI);
    for (const s of forbidden) {
      expect(doc.includes(s), `OPENAPI содержит «${s}»`).toBe(false);
      expect(page.includes(s), `страница содержит «${s}»`).toBe(false);
    }
    expect(page.match(/<h1[\s>]/g)?.length).toBe(1);
  });
});

describe("примеры документа", () => {
  it("пример импорта проходит проверку и не выдумывает значений: характеристики — копия данных организатора", () => {
    const seed = exampleImportSeed();
    const checked = validateProductSeeds([seed]);
    expect(checked.ok ? [] : checked.issues).toEqual([]);
    const source = catalogProduct(EXAMPLE_PRODUCT_SLUG);
    expect(source).toBeDefined();
    expect(Object.keys(seed.characteristics).sort()).toEqual([...EXAMPLE_IMPORT_KEYS].sort());
    for (const key of EXAMPLE_IMPORT_KEYS) expect(seed.characteristics[key]).toEqual(source?.characteristics[key]);
    // В подбор и расчёт пример не попадает, slug данных организатора не занимает.
    expect(seed.level).toBe("identification");
    expect(seed.slug).not.toBe(EXAMPLE_PRODUCT_SLUG);
    expect(catalogProduct(seed.slug)).toBeUndefined();
  });

  it("примеры расчёта проходят проверку параметров и сценариев", () => {
    const op = OPENAPI.paths["/api/v1/calculate"]?.post;
    const examples = Object.values(op?.requestBody?.content["application/json"]?.examples ?? {});
    expect(examples.length).toBeGreaterThanOrEqual(2);
    const specs = paramSpecsFor("warehouse");
    const products = [EXAMPLE_PRODUCT_SLUG];
    for (const ex of examples) {
      const body = ex.value as { facility: string; params?: Record<string, unknown>; scenarios?: unknown };
      expect(body.facility).toBe("warehouse");
      const checked = validateParamValues(specs, body.params ?? {}, { origin: "api" });
      expect(hasErrors(checked.issues), ex.summary).toBe(false);
      if (body.scenarios !== undefined) {
        const res = validateScenarioSpecs(
          body.scenarios,
          "warehouse",
          products,
          processesForFacility("warehouse").map((p) => p.slug),
        );
        expect(res.ok ? [] : res.errors, ex.summary).toEqual([]);
      }
    }
  });

  it("пример зарплаты — граница диапазона организатора, а не придуманное число", () => {
    const op = OPENAPI.paths["/api/v1/calculate"]?.post;
    const salary = op?.requestBody?.content["application/json"]?.examples?.salary?.value as { params: Record<string, number> };
    const spec = paramSpecsFor("warehouse").find((s) => s.key === "forkliftSalaryRubMonth");
    expect(spec?.origin).toBe("organizer");
    expect(salary.params.forkliftSalaryRubMonth).toBe(spec?.max);
  });

  it("числа расчёта в примерах ответов не приводятся — только заглушки", () => {
    const op = OPENAPI.paths["/api/v1/calculate"]?.post;
    const value = op?.responses["200"]?.content?.["application/json"]?.examples?.example?.value as {
      summary: Record<string, unknown>[];
    };
    for (const key of ["capexRub", "opexYearRub", "npvRub", "tcoRub", "paybackYears"]) {
      expect(typeof value.summary[0]?.[key], key).toBe("string");
    }
  });
});
