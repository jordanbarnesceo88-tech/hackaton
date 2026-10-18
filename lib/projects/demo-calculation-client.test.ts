import { afterEach, expect, it, vi } from "vitest";
import { calculateDemo } from "./demo-calculation-client";
import { fixtureResults } from "../report/tz/test-fixtures";
import { warehouseBaseInput } from "../sim/fixtures";

afterEach(() => vi.unstubAllGlobals());

it("sends only the unsaved input and keeps a real partial result partial", async () => {
  const results = fixtureResults();
  results.scenarios[1]!.spatialEvidence = {
    input: warehouseBaseInput(5), sourceInputKey: "fixture", executionInputKey: "fixture-execution", simModelVersion: "fixture-model",
    assessment: { status: "PARTIAL", headline: "Поток не выполнен", terminal: true },
    summary: { fleet: 5, achievedPerH: 51, requiredPerH: 51.8, queueEnd: 5, waitP95Min: 2 },
  };
  const input = { facility: results.facility, params: results.paramsUsed, scenarios: results.scenarios };
  const fetcher = vi.fn().mockResolvedValue(Response.json({ results, ms: 123 }));
  vi.stubGlobal("fetch", fetcher);
  const response = await calculateDemo(input, new AbortController().signal);
  expect(response.results).toEqual(JSON.parse(JSON.stringify(results)));
  expect(response.results.scenarios[1]!.spatialEvidence!.assessment.status).toBe("PARTIAL");
  expect(fetcher).toHaveBeenCalledOnce();
  expect(fetcher.mock.calls[0]![0]).toBe("/api/v1/demo-calculation");
  expect(JSON.parse(fetcher.mock.calls[0]![1].body)).toEqual(input);
  expect(fetcher.mock.calls[0]![1]).toMatchObject({ method: "POST", cache: "no-store", credentials: "same-origin" });
});

it("reports a server error without converting its financial bootstrap to success", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "Достигнут лимит вычислений" }, { status: 503 })));
  await expect(calculateDemo({ facility: "warehouse", params: {}, scenarios: [] }, new AbortController().signal)).rejects.toThrow("Достигнут лимит вычислений");
});

it("passes cancellation to the network and rejects incomplete success payloads", async () => {
  const controller = new AbortController(); controller.abort();
  const fetcher = vi.fn().mockImplementation(async (_url, options) => {
    expect(options.signal.aborted).toBe(true);
    throw new DOMException("Cancelled", "AbortError");
  });
  vi.stubGlobal("fetch", fetcher);
  await expect(calculateDemo({ facility: "warehouse", params: {}, scenarios: [] }, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  fetcher.mockResolvedValue(Response.json({ results: {}, ms: 1 }));
  await expect(calculateDemo({ facility: "warehouse", params: {}, scenarios: [] }, new AbortController().signal)).rejects.toThrow("неполный результат");
});
