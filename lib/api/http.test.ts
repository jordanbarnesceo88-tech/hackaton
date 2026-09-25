import { describe, expect, it } from "vitest";
import { parseCatalogQuery } from "./catalog";
import { apiError, isJsonContentType, readJsonBody, tooManyRequests } from "./http";

// Общие ответы API и разбор запроса: тело только JSON и не больше предела, ошибки — по-русски
// в форме { error, details? }; разбор строки запроса каталога.

function post(body: BodyInit | null, headers: Record<string, string> = { "content-type": "application/json" }): Request {
  return new Request("http://localhost/api/v1/calculate", { method: "POST", body, headers });
}

async function errorOf(res: Response): Promise<{ status: number; error: string }> {
  const json = (await res.json()) as { error: string };
  return { status: res.status, error: json.error };
}

describe("readJsonBody", () => {
  it("разбирает JSON, в том числе с BOM и параметром charset", async () => {
    const a = await readJsonBody(post('{"facility":"warehouse"}'), 1000);
    expect(a).toEqual({ ok: true, value: { facility: "warehouse" } });
    const b = await readJsonBody(post('﻿{"a":1}', { "content-type": "application/json; charset=utf-8" }), 1000);
    expect(b).toEqual({ ok: true, value: { a: 1 } });
  });

  it("не JSON по Content-Type — 415 (защита записей по сессии от подделки запроса)", async () => {
    const res = await readJsonBody(post("a=1", { "content-type": "application/x-www-form-urlencoded" }), 1000);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(await errorOf(res.response)).toMatchObject({ status: 415, error: expect.stringMatching(/Content-Type/) });
    const plain = await readJsonBody(post("{}", { "content-type": "text/plain" }), 1000);
    expect(plain.ok ? 0 : plain.response.status).toBe(415);
  });

  it("больше предела — 413 и по Content-Length, и по фактическим байтам", async () => {
    const byHeader = await readJsonBody(post("{}", { "content-type": "application/json", "content-length": "5000" }), 1000);
    expect(byHeader.ok ? 0 : byHeader.response.status).toBe(413);
    const big = JSON.stringify({ q: "x".repeat(5000) });
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(big));
        controller.close();
      },
    });
    const byBytes = await readJsonBody(
      new Request("http://localhost/x", { method: "POST", body: stream, headers: { "content-type": "application/json" }, duplex: "half" } as RequestInit),
      1000,
    );
    expect(byBytes.ok ? 0 : byBytes.response.status).toBe(413);
  });

  it("пустое тело и не-JSON — 400 с подсказкой", async () => {
    const empty = await readJsonBody(post(""), 1000);
    expect(empty.ok ? null : await errorOf(empty.response)).toEqual({ status: 400, error: "Тело запроса пустое — передайте JSON" });
    const broken = await readJsonBody(post("{facility: warehouse}"), 1000);
    expect(broken.ok ? 0 : broken.response.status).toBe(400);
  });
});

describe("ответы", () => {
  it("ошибка — { error, details? } и Cache-Control: no-store", async () => {
    const res = apiError(422, "Неверно", { errors: ["x"] });
    expect(res.status).toBe(422);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ error: "Неверно", details: { errors: ["x"] } });
    expect(await apiError(404, "Нет").json()).toEqual({ error: "Нет" });
  });

  it("429 — сообщение с секундами и Retry-After", async () => {
    const res = tooManyRequests(41.2);
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("42");
    expect(await res.json()).toEqual({ error: "Слишком много запросов, повторите через 42 с", details: { retryAfterSec: 42 } });
  });

  it("isJsonContentType", () => {
    expect(isJsonContentType("application/json")).toBe(true);
    expect(isJsonContentType("Application/JSON; charset=utf-8")).toBe(true);
    expect(isJsonContentType("application/merge-patch+json")).toBe(true);
    expect(isJsonContentType("text/json")).toBe(false);
    expect(isJsonContentType(null)).toBe(false);
  });
});

describe("parseCatalogQuery", () => {
  const parse = (q: string) => parseCatalogQuery(new URLSearchParams(q));

  it("фильтры, поиск, сортировка, страница и флаги", () => {
    expect(parse("facility=warehouse&process=pallet-transport&status=operation&level=enriched&q=Ronavi&sort=price&page=2&confirmedOnly=1&raas=true")).toEqual({
      ok: true,
      filters: {
        facility: "warehouse",
        process: "pallet-transport",
        status: "operation",
        level: "enriched",
        q: "Ronavi",
        sort: "price",
        page: 2,
        confirmedOnly: true,
        raas: true,
      },
    });
    expect(parse("")).toEqual({ ok: true, filters: {} });
    expect(parse("raas=0&q=")).toEqual({ ok: true, filters: {} });
  });

  it("опечатки и неверные значения — ошибки, а не пустой список", () => {
    const res = parse("facilty=warehouse&facility=factory&page=0&sort=cheap&status=prod&process=flying&solutionType=x&raas=maybe");
    expect(res.ok).toBe(false);
    const text = res.ok ? "" : res.errors.join(" | ");
    for (const part of ["«facilty» не поддерживается", "facility —", "page —", "sort —", "status —", "process «flying»", "solutionType «x»", "raas —"]) {
      expect(text).toContain(part);
    }
    expect(parse("page=1&page=2").ok).toBe(false);
    expect(parse(`q=${"я".repeat(101)}`).ok).toBe(false);
  });
});
