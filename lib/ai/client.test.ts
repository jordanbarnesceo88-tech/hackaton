import { describe, expect, it } from "vitest";
import { AiError, chatJson } from "./client";
import { readAiConfig } from "./config";

const config = { url: "https://ai.example/api/v1", key: "secret-key", model: "test-model" };
const request = { messages: [{ role: "user" as const, content: "Привет" }], schemaName: "r", schema: { type: "object" }, maxTokens: 100 };

function reply(body: unknown, status = 200): typeof fetch {
  return async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  const error = await promise.then(() => null, (e: unknown) => e);
  expect(error).toBeInstanceOf(AiError);
  return (error as AiError).code;
}

describe("readAiConfig", () => {
  it("без любой из трёх переменных ИИ выключен", () => {
    expect(readAiConfig({})).toBeNull();
    expect(readAiConfig({ AI_API_URL: "https://x", AI_API_KEY: "k" })).toBeNull();
    expect(readAiConfig({ AI_API_URL: " ", AI_API_KEY: "k", AI_MODEL: "m" })).toBeNull();
  });

  it("обрезает пробелы и завершающий слэш адреса", () => {
    expect(readAiConfig({ AI_API_URL: " https://x/api/v1/ ", AI_API_KEY: " k ", AI_MODEL: "m" })).toEqual({ url: "https://x/api/v1", key: "k", model: "m" });
  });
});

describe("chatJson", () => {
  it("просит строгий JSON по схеме при нулевой температуре и отдаёт текст ответа", async () => {
    let sent: { url: string; init: RequestInit } | null = null;
    const fetchImpl: typeof fetch = async (url, init) => {
      sent = { url: String(url), init: init! };
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' }, finish_reason: "stop" }] }));
    };
    await expect(chatJson(config, request, { fetchImpl })).resolves.toBe('{"ok":true}');
    expect(sent!.url).toBe("https://ai.example/api/v1/chat/completions");
    expect((sent!.init.headers as Record<string, string>).Authorization).toBe("Bearer secret-key");
    const body = JSON.parse(String(sent!.init.body));
    expect(body).toMatchObject({ model: "test-model", temperature: 0, max_tokens: 100, response_format: { type: "json_schema", json_schema: { name: "r", strict: true } } });
  });

  it("ошибки сервиса сводятся к кодам, ключ в сообщение не попадает", async () => {
    const http = chatJson(config, request, { fetchImpl: reply({ error: "boom" }, 500) });
    const error = await http.catch((e: AiError) => e);
    expect(error).toMatchObject({ code: "AI_HTTP", status: 500 });
    expect(String((error as Error).message)).not.toContain("secret-key");
    expect(await codeOf(chatJson(config, request, { fetchImpl: reply({ choices: [{ message: { content: "{" }, finish_reason: "length" }] }) }))).toBe("AI_TRUNCATED");
    expect(await codeOf(chatJson(config, request, { fetchImpl: reply({ choices: [{ message: { content: "" } }] }) }))).toBe("AI_BAD_RESPONSE");
    expect(await codeOf(chatJson(config, request, { fetchImpl: async () => { throw new TypeError("fetch failed"); } }))).toBe("AI_UNAVAILABLE");
  });

  it("не ждёт дольше предела", async () => {
    const hang: typeof fetch = (_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    });
    expect(await codeOf(chatJson(config, request, { fetchImpl: hang, timeoutMs: 20 }))).toBe("AI_TIMEOUT");
  });
});
