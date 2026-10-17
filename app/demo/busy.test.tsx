import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { CalculationBusy } from "../../lib/sim/server-execution";
vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("@/lib/db/client", () => ({ prisma: {} }));
vi.mock("@/lib/catalog/queries", () => ({ getNormRows: async () => [], getProcessesFor: async () => [] }));
vi.mock("@/lib/projects/recalc", () => ({ loadLiveInputs: async () => ({ paramDefs: [] }) }));
vi.mock("@/lib/projects/business-example-model", () => ({ buildBusinessExampleAsync: async () => { throw new CalculationBusy(); } }));
vi.mock("@/components/project/workspace", () => ({ Workspace: () => null }));
const { default: DemoPage } = await import("./page");
it("a saturated example presents retry instructions and original-input navigation instead of a failed page", async () => {
  const html = renderToStaticMarkup(await DemoPage({ searchParams: Promise.resolve({ example: "steady-flow" }) }));
  expect(html).toContain('role="status"');
  expect(html).toContain("два расчёта");
  expect(html).toContain('href="/demo?example=steady-flow"');
  expect(html).toContain('href="/demo"');
  expect(html).not.toContain("Расчёт выполнен");
});
