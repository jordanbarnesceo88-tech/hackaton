import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cancelCalculation, forgetSubmission, readCalculation, submitCalculation, waitForCalculation } from "./client";

const fetchMock = vi.fn();
const storage = new Map<string, string>();
const input = { operation: "CALCULATE" as const, facility: "warehouse" };
beforeEach(() => {
  storage.clear(); fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("sessionStorage", { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) });
  forgetSubmission("test");
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
const accepted = () => Response.json({ job: { id: "j1", status: "QUEUED" } }, { status: 202 });

it("explains the secure-context requirement before sending on an HTTP LAN origin", async () => {
  vi.stubGlobal("crypto", { getRandomValues: vi.fn() });
  await expect(submitCalculation(input, "test")).rejects.toThrow("HTTPS или localhost");
  expect(fetchMock).not.toHaveBeenCalled();
});

it("reuses a persisted key after a lost response, but changes it for a new intent", async () => {
  fetchMock.mockRejectedValueOnce(new TypeError("network lost")).mockImplementation(async () => accepted());
  await expect(submitCalculation(input, "test")).rejects.toThrow("не создаст дубликат");
  await submitCalculation(input, "test");
  await submitCalculation({ ...input, facility: "medical" }, "test");
  const headers = fetchMock.mock.calls.map(call => call[1].headers["Idempotency-Key"]);
  expect(headers[0]).toBe(headers[1]); expect(headers[2]).not.toBe(headers[1]);
  expect([...storage.values()][0]).not.toContain("medical");
});

it("does not silently resubmit a deliberately removed result; the next manual attempt gets a fresh key", async () => {
  fetchMock.mockResolvedValueOnce(Response.json({ error: "Результат удалён" }, { status: 410 })).mockImplementation(async () => accepted());
  await expect(submitCalculation(input, "test")).rejects.toThrow("Результат удалён");
  expect(fetchMock).toHaveBeenCalledTimes(1);
  await submitCalculation(input, "test");
  expect(fetchMock.mock.calls[0]![1].headers["Idempotency-Key"]).not.toBe(fetchMock.mock.calls[1]![1].headers["Idempotency-Key"]);
});

it("preserves the queue error code so the form can offer its active operations", async () => {
  fetchMock.mockResolvedValue(Response.json({ error: "Очередь заполнена", details: { code: "QUEUE_FULL" } }, { status: 429 }));
  await expect(submitCalculation(input, "test")).rejects.toMatchObject({ status: 429, code: "QUEUE_FULL", message: "Очередь заполнена" });
  expect(fetchMock).toHaveBeenCalledOnce();
});

it("bounds every GET with a timeout and respects an already closed view", async () => {
  const parent = new AbortController(); parent.abort();
  fetchMock.mockImplementation(async (_url, options) => {
    expect(options.signal.aborted).toBe(true);
    throw new DOMException("Closed", "AbortError");
  });
  await expect(readCalculation("j1", parent.signal)).rejects.toMatchObject({ name: "AbortError" });
  expect(fetchMock.mock.calls[0]![1].signal).toBeInstanceOf(AbortSignal);
});

it("polls compact state and closing the watcher never sends a cancellation", async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  fetchMock.mockResolvedValue(Response.json({ job: { id: "j1", status: "RUNNING" } }));
  const progress = vi.fn();
  const promise = waitForCalculation("j1", progress, controller.signal);
  const rejected = expect(promise).rejects.toMatchObject({ name: "AbortError" });
  await vi.advanceTimersByTimeAsync(1);
  controller.abort(); await rejected;
  expect(progress).toHaveBeenCalledOnce();
  expect(fetchMock.mock.calls.every(call => !call[0].includes("cancel"))).toBe(true);
});

it("explicit cancellation uses a JSON body and bounded request", async () => {
  fetchMock.mockResolvedValue(Response.json({ job: { id: "j1", status: "CANCELLED" } }));
  await cancelCalculation("j1");
  expect(fetchMock.mock.calls[0]![0]).toContain("/cancel");
  expect(fetchMock.mock.calls[0]![1]).toMatchObject({ method: "POST", body: "{}", headers: { "Content-Type": "application/json" } });
  expect(fetchMock.mock.calls[0]![1].signal).toBeInstanceOf(AbortSignal);
});
