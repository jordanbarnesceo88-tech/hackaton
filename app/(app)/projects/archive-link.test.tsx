import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ count: 0, countQuery: vi.fn() }));
vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("@/lib/auth/guards", () => ({ requireUser: async () => ({ userId: "owner" }) }));
vi.mock("@/lib/db/client", () => ({ prisma: { savedAnalysis: { count: (query: unknown) => { state.countQuery(query); return Promise.resolve(state.count); } } } }));
vi.mock("@/lib/projects/queries", () => ({ listProjects: async () => [] }));
vi.mock("@/components/project/projects-list", () => ({ ProjectsList: () => null }));
import ProjectsPage from "./page";
beforeEach(() => { state.count = 0; state.countQuery.mockClear(); });
it("does not offer an empty v1 archive as a second calculation flow", async () => {
  const html = renderToStaticMarkup(await ProjectsPage());
  expect(html).not.toContain('href="/analyses"');
  expect(html).toContain('href="/projects/new"');
  expect(state.countQuery).toHaveBeenCalledWith({ where: { userId: "owner" } });
});
it("labels an existing private archive explicitly", async () => {
  state.count = 2;
  const html = renderToStaticMarkup(await ProjectsPage());
  expect(html).toContain('href="/analyses"');
  expect(html).toContain("Архив расчётов v1 · 2");
});
