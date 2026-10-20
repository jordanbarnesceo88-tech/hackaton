import { describe, expect, it } from "vitest";
import { parseCatalogQuery } from "./catalog";

describe("catalogue assignment API opt-in", () => {
  it("keeps unassigned cards excluded by default and exposes the same explicit opt-in as the UI", () => {
    expect(parseCatalogQuery(new URLSearchParams())).toEqual({ ok: true, filters: {} });
    expect(parseCatalogQuery(new URLSearchParams("unassigned=1&page=2"))).toEqual({ ok: true, filters: { includeUnassigned: true, page: 2 } });
    expect(parseCatalogQuery(new URLSearchParams("unassigned=0"))).toEqual({ ok: true, filters: {} });
    expect(parseCatalogQuery(new URLSearchParams("unassigned=maybe")).ok).toBe(false);
    expect(parseCatalogQuery(new URLSearchParams("unassigned=1&unassigned=0")).ok).toBe(false);
  });
});
