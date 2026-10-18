import { test, expect } from "@playwright/test";
import { decodeText, parseCsv, toCsv } from "../lib/files/csv";
import { parseParamsFile } from "../lib/tz/params/import";
import { TEMPLATE_HEADERS } from "../lib/tz/params/template";
import type { ParamSpec } from "../lib/tz/types";

test("guest imports and rechecks a 950000-byte CSV within the default Server Action limit", async ({ page, request }, testInfo) => {
  test.setTimeout(90_000);
  const template = await request.get("/api/templates/warehouse?format=csv");
  expect(template.status()).toBe(200);
  expect(template.headers()["content-type"]).toContain("text/csv");
  const definitions = await request.get("/api/v1/facility-types/warehouse/params");
  expect(definitions.status()).toBe(200);
  const { params: defs } = await definitions.json() as { params: ParamSpec[] };
  expect(defs.length).toBeGreaterThan(0);

  const rows = parseCsv(decodeText(await template.body()));
  expect(rows[0]).toEqual([...TEMPLATE_HEADERS]);
  const keyColumn = rows[0]!.indexOf("Ключ");
  const noteColumn = rows[0]!.indexOf("Источник/примечание");
  expect(rows.slice(1).map(row => row[keyColumn]).sort()).toEqual(defs.map(def => def.key).sort());
  // Padding an ignored quoted note preserves real template keys, values and row numbering.
  const row = rows[1]!;
  row[noteColumn] = `${row[noteColumn]}\n`;
  const targetBytes = 950_000;
  const padding = targetBytes - Buffer.byteLength(toCsv(rows), "utf8");
  expect(padding).toBeGreaterThan(0);
  row[noteColumn] += " ".repeat(padding);
  const buffer = Buffer.from(toCsv(rows), "utf8");
  expect(buffer.byteLength).toBe(targetBytes);
  const fileName = "warehouse-boundary.csv";

  // Validate the exact uploaded bytes against the running server's current definitions first.
  const parsed = await parseParamsFile(buffer, fileName, defs);
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error(parsed.message);
  expect(parsed.layout).toBe("template");
  expect(parsed.found).toBe(defs.length);
  expect(parsed.errors).toBe(0);

  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/demo");
  await page.getByRole("navigation", { name: "Шаги расчёта" }).getByRole("link", { name: /^2 / }).click();
  await page.getByText("Загрузить параметры из Excel или CSV по шаблону", { exact: true }).click();
  const importer = page.getByRole("group", { name: "Загрузка параметров из Excel или CSV", exact: true });
  await importer.getByLabel("Файл параметров (.xlsx или .csv)", { exact: true }).setInputFiles({ name: fileName, mimeType: "text/csv", buffer });
  const check = importer.getByRole("button", { name: "Проверить файл", exact: true });
  const requestBytes: number[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const responsePromise = page.waitForResponse(response => response.request().method() === "POST" && Boolean(response.request().headers()["next-action"]));
    await check.click();
    const response = await responsePromise;
    expect(response.status()).toBe(200);
    const requestBodySize = Number((await response.request().allHeaders())["content-length"]);
    requestBytes.push(requestBodySize);
    expect(requestBodySize).toBeGreaterThan(targetBytes);
    expect(requestBodySize).toBeLessThan(1024 * 1024);
    await expect(check).toBeEnabled();
    await expect(importer.getByRole("alert")).toBeEmpty();
    await expect(importer.getByText(new RegExp(`Найдено ${defs.length} параметр.*ошибок 0`))).toBeVisible();
    await expect(importer.getByText(`Файл «${fileName}». Распознан шаблон платформы.`)).toBeVisible();
    await expect(importer.getByRole("table", { name: "Отчёт о проверке файла параметров" })).toBeVisible();
    await expect(importer.getByRole("button", { name: "Применить значения", exact: true })).toBeEnabled();
  }
  // The first report must not be serialized back alongside the file on the second check.
  expect(Math.abs(requestBytes[1]! - requestBytes[0]!)).toBeLessThan(1024);
  expect(errors).toEqual([]);
  console.info("[params-import]", JSON.stringify({ fileBytes: buffer.byteLength, requestBytes, parsedParameters: parsed.found }));
  await testInfo.attach("import-request-sizes", {
    body: JSON.stringify({ fileBytes: buffer.byteLength, requestBytes, parsedParameters: parsed.found }),
    contentType: "application/json",
  });
});
