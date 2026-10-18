import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ snapshot: null as unknown, workspace: vi.fn() }));
vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("@/lib/db/client", () => ({ prisma: {} }));
vi.mock("@/lib/catalog/queries", () => ({ getNormRows: async () => [], getProcessesFor: async () => [] }));
vi.mock("@/lib/projects/recalc", () => ({ loadLiveInputs: async () => ({ paramDefs: [], products: [] }) }));
vi.mock("@/lib/projects/business-example-model", () => ({ buildBusinessExamplePreview: () => ({
  example: { lesson: "Учебная задача" }, assumption: "Публичные исходные данные", params: {},
  model: { paramsUsed: {}, scenarios: [], normsUsed: {} }, ms: 1,
}) }));
vi.mock("@/lib/projects/business-example-snapshot", () => ({ readBusinessExampleSnapshot: async () => state.snapshot }));
vi.mock("@/components/project/workspace", () => ({ Workspace: (props: unknown) => { state.workspace(props); return null; } }));
const { default: DemoPage } = await import("./page");
beforeEach(() => { state.snapshot = null; state.workspace.mockClear(); });

it("renders browser preview without starting a server simulation when no compatible snapshot exists", async () => {
  const html = renderToStaticMarkup(await DemoPage({ searchParams: Promise.resolve({ example: "steady-flow" }) }));
  expect(html).toContain("Предварительная оценка");
  expect(html).toContain("Имитация выполняется в вашем браузере");
  expect(html).not.toContain("ожидает серверной проверки");
  expect(state.workspace.mock.calls[0]?.[0]).toMatchObject({ mode: "guest", stored: undefined });
});
it("shows prepared snapshot provenance and hands its saved simulation to the editable guest workspace", async () => {
  const results = { calculatedAt: "2026-10-18T06:00:00.000Z", modelVersion: "tz-test", dataVersion: "current", sim: { purchase: {} } };
  const model = { paramsUsed: { activeArea: 5000 }, scenarios: [], normsUsed: {} };
  state.snapshot = { results, model };
  const html = renderToStaticMarkup(await DemoPage({ searchParams: Promise.resolve({ example: "steady-flow" }) }));
  expect(html).toContain("Готовый учебный расчёт с проверкой потока");
  expect(html).toContain("18.10.2026");
  expect(html).toContain("tz-test");
  expect(state.workspace.mock.calls[0]?.[0]).toMatchObject({ mode: "guest", initialModel: model, stored: { results, liveDataVersion: "current" } });
});
