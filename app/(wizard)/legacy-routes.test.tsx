import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  user: null as null | { userId: string }, saved: null as null | { id: string; solutionId: string },
  getSaved: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  redirect: (target: string) => { throw Object.assign(new Error("redirect"), { target }); },
  notFound: () => { throw Object.assign(new Error("not found"), { status: 404 }); },
}));
vi.mock("@/lib/auth/guards", () => ({
  getSessionUser: async () => state.user,
  requireUser: async () => { if (!state.user) throw Object.assign(new Error("redirect"), { target: "/login" }); return state.user; },
}));
vi.mock("@/lib/db/queries", () => ({ getSavedAnalysis: (id: string, user: string) => { state.getSaved(id, user); return Promise.resolve(state.saved); } }));

import Onboarding from "./onboarding/page";
import Facility from "./onboarding/facility/page";
import Params from "./onboarding/params/page";
import Staffing from "./onboarding/staffing/page";
import Compare from "./compare/[type]/page";
import Calculate from "./calculate/[solutionId]/page";
import { currentWorkflowHref } from "@/lib/wizard/current-route";

beforeEach(() => { state.user = null; state.saved = null; state.getSaved.mockClear(); });

it("redirects every old onboarding entry to the guest workflow without translating incompatible numbers", async () => {
  for (const page of [Onboarding, Facility, Params, Staffing]) {
    await expect(page({ searchParams: Promise.resolve({ facility: "airport", ops: "9999", staff: "999" }) }))
      .rejects.toMatchObject({ target: "/demo?legacy=1&facility=airport" });
  }
});
it("maps only supported identical facility slugs, with an explicit legacy transition", () => {
  expect(currentWorkflowHref("medical", false)).toBe("/demo?legacy=1&facility=medical");
  expect(currentWorkflowHref("warehouse", true)).toBe("/projects/new?legacy=1&facility=warehouse");
  expect(currentWorkflowHref("fulfillment", false)).toBe("/demo?legacy=1");
  expect(currentWorkflowHref(["airport", "medical"], false)).toBe("/demo?legacy=1");
});
it("uses the compare route's facility and sends an authenticated user to a current project", async () => {
  state.user = { userId: "owner" };
  await expect(Compare({ params: Promise.resolve({ type: "medical" }), searchParams: Promise.resolve({ facility: "airport" }) }))
    .rejects.toMatchObject({ target: "/projects/new?legacy=1&facility=medical" });
});
it("retires a new legacy calculation without looking up private records", async () => {
  await expect(Calculate({ params: Promise.resolve({ solutionId: "s" }), searchParams: Promise.resolve({ facility: "warehouse" }) }))
    .rejects.toMatchObject({ target: "/demo?legacy=1&facility=warehouse" });
  expect(state.getSaved).not.toHaveBeenCalled();
});
it("requires authentication before reading an archived analysis", async () => {
  await expect(Calculate({ params: Promise.resolve({ solutionId: "s" }), searchParams: Promise.resolve({ analysis: "private" }) }))
    .rejects.toMatchObject({ target: "/login" });
  expect(state.getSaved).not.toHaveBeenCalled();
});
it("preserves owned historical links as read-only reports", async () => {
  state.user = { userId: "owner" }; state.saved = { id: "a", solutionId: "s" };
  await expect(Calculate({ params: Promise.resolve({ solutionId: "s" }), searchParams: Promise.resolve({ analysis: "a" }) }))
    .rejects.toMatchObject({ target: "/report/a" });
  expect(state.getSaved).toHaveBeenCalledWith("a", "owner");
});
it("does not redirect a missing, foreign, or mismatched analysis into a report", async () => {
  state.user = { userId: "owner" };
  for (const saved of [null, { id: "a", solutionId: "different" }]) {
    state.saved = saved;
    await expect(Calculate({ params: Promise.resolve({ solutionId: "s" }), searchParams: Promise.resolve({ analysis: "a" }) }))
      .rejects.toMatchObject({ status: 404 });
  }
  expect(state.getSaved).toHaveBeenCalledWith("a", "owner");
});
