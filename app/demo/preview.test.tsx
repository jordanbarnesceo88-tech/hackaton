import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ workspace: vi.fn(), product: null as null | { slug: string; name: string } }));
vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("@/lib/db/client", () => ({ prisma: {} }));
vi.mock("@/lib/catalog/queries", () => ({ getNormRows: async () => [], getProcessesFor: async () => [], getCatalogProduct: async () => state.product }));
vi.mock("@/lib/projects/recalc", () => ({ loadLiveInputs: async () => ({ paramDefs: [], products: [] }) }));
vi.mock("@/lib/projects/business-example-model", () => ({ buildBusinessExamplePreview: () => ({
  example: { lesson: "Учебная задача" }, assumption: "Публичные исходные данные", params: {},
  model: { paramsUsed: {}, scenarios: [], normsUsed: {} }, ms: 1,
}) }));
vi.mock("@/components/project/workspace", () => ({ Workspace: (props: unknown) => { state.workspace(props); return null; } }));
const { default: DemoPage } = await import("./page");
beforeEach(() => { state.workspace.mockClear(); state.product = null; });

it("renders a form bootstrap that promises a real server calculation rather than an already verified example", async () => {
  const html = renderToStaticMarkup(await DemoPage({ searchParams: Promise.resolve({ example: "steady-flow" }) }));
  expect(html).toContain("Сервер рассчитывает текущие условия");
  expect(html).not.toContain("Имитация выполняется в вашем браузере");
  expect(html).not.toContain("Готовый учебный расчёт");
  expect(state.workspace.mock.calls[0]?.[0]).toMatchObject({ mode: "guest" });
  expect(state.workspace.mock.calls[0]?.[0]).not.toHaveProperty("stored");
});
it("does not hand stored proof to a new guest visit", async () => {
  const html = renderToStaticMarkup(await DemoPage({ searchParams: Promise.resolve({ example: "steady-flow" }) }));
  expect(html).toContain("запускайте серверную проверку");
  expect(state.workspace.mock.calls[0]?.[0]).toMatchObject({ mode: "guest", initialStep: 8, initialFocusKey: "purchase" });
  expect(state.workspace.mock.calls[0]?.[0]).not.toHaveProperty("stored");
});
it("rejects unknown product links rather than calculating a default robot", async () => {
  await expect(DemoPage({ searchParams: Promise.resolve({ facility: "warehouse", product: "unknown" }) })).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
  expect(state.workspace).not.toHaveBeenCalled();
});
it("explains a known product outside the live applicable catalogue without mounting a default workspace", async () => {
  state.product = { slug: "inapplicable", name: "Known product" };
  const html = renderToStaticMarkup(await DemoPage({ searchParams: Promise.resolve({ facility: "warehouse", product: "inapplicable" }) }));
  expect(html).toContain("Known product");
  expect(html).toContain("Другой робот не подставлен");
  expect(html).toContain("Общий демо-расчёт");
  expect(state.workspace).not.toHaveBeenCalled();
});
