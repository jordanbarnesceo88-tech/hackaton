import { describe, expect, it } from "vitest";
import { GUEST_DRAFT_TTL_MS, consumePublishedGuestDraft, guestDraftAuthDestination, guestDraftAuthLink, guestDraftNonce, guestDraftRoute, readGuestDraft, readGuestDraftCreate, setGuestDraftCreate, writeGuestDraft, type GuestDraftInput } from "./guest-draft";
import { fixtureResults } from "@/lib/report/tz/test-fixtures";

class MemoryStorage {
  values = new Map<string, string>();
  get length() { return this.values.size; }
  key(n: number) { return [...this.values.keys()][n] ?? null; }
  getItem(k: string) { return this.values.get(k) ?? null; }
  setItem(k: string, v: string) { this.values.set(k, v); }
  removeItem(k: string) { this.values.delete(k); }
}
const nonce = "88888888-4444-4444-8444-123456789012";
const second = "88888888-4444-4444-8444-123456789013";
const tab = "alfa-guest-tab:original";
function input(): GuestDraftInput {
  const fixture = fixtureResults();
  return { facility: "warehouse", params: { ...fixture.paramsUsed, forkliftSalaryRubMonth: 123456 }, scenarios: fixture.scenarios };
}

describe("guest input handoff", () => {
  it("retains exact input and submission metadata through queue, reload, running, failure and cancellation", () => {
    const storage = new MemoryStorage();
    const draft = input();
    writeGuestDraft(storage, tab, nonce, draft, 100);
    setGuestDraftCreate(storage, tab, nonce, { name: "Гостевой123456", objectName: "РЦ", jobId: "owned-create-job" }, 101);
    // A refreshed form reconstructs the previous CREATE, not a default or a new operation.
    expect(readGuestDraftCreate(storage, tab, nonce, 102)).toEqual({ name: "Гостевой123456", objectName: "РЦ", jobId: "owned-create-job" });
    for (const status of ["QUEUED", "RUNNING", "FAILED", "CANCELLED"] as const) {
      expect(consumePublishedGuestDraft(storage, tab, nonce, { id: "owned-create-job", operation: "CREATE", status, publicationState: "NONE", projectId: null }, 103)).toBe(false);
      expect(readGuestDraft(storage, tab, nonce, 104)).toEqual(draft);
    }
    const published = { id: "owned-create-job", operation: "CREATE", status: "SUCCEEDED" as const, publicationState: "PUBLISHED" as const, projectId: "owned-project" };
    for (const invalid of [{ ...published, id: "other-job" }, { ...published, operation: "SAVE" }, { ...published, publicationState: "STALE" as const }, { ...published, projectId: null }]) {
      expect(consumePublishedGuestDraft(storage, tab, nonce, invalid, 105)).toBe(false);
      expect(readGuestDraft(storage, tab, nonce, 106).params.forkliftSalaryRubMonth).toBe(123456);
    }
    expect(consumePublishedGuestDraft(storage, tab, nonce, published, 107)).toBe(true);
    expect(() => readGuestDraft(storage, tab, nonce, 108)).toThrow(/недоступен/);
  });
  it("stores CREATE form values before submission and binds subsequent attempts without losing inputs", () => {
    const storage = new MemoryStorage();
    writeGuestDraft(storage, tab, nonce, input(), 100);
    setGuestDraftCreate(storage, tab, nonce, { name: "Отправка", objectName: "" }, 101);
    expect(readGuestDraftCreate(storage, tab, nonce, 102)).toEqual({ name: "Отправка", objectName: "" });
    setGuestDraftCreate(storage, tab, nonce, { name: "Отправка", objectName: "", jobId: "first-failed" }, 103);
    setGuestDraftCreate(storage, tab, nonce, { name: "Повтор", objectName: "", jobId: "second-job" }, 104);
    expect(readGuestDraftCreate(storage, tab, nonce, 105)?.jobId).toBe("second-job");
    expect(readGuestDraft(storage, tab, nonce, 106).params.forkliftSalaryRubMonth).toBe(123456);
  });
  it("carries all editable input, including pilot/layout/overrides, and removes old spatial receipts", () => {
    const storage = new MemoryStorage();
    const draft = input();
    const scenario = draft.scenarios[1]!;
    scenario.spatialEvidence = { untrusted: true } as never;
    scenario.pilotPlan = { notes: "Обследование E2E123456", fleet: 2 } as never;
    scenario.normOverrides = { tcoMinYears: 7 } as never;
    scenario.siteLayout = { explicit: "retained" } as never;
    writeGuestDraft(storage, tab, nonce, draft, 100);
    const result = readGuestDraft(storage, tab, nonce, 101);
    expect(result.params.forkliftSalaryRubMonth).toBe(123456);
    expect(result.scenarios[1]).toEqual({ ...scenario, spatialEvidence: undefined });
    expect(JSON.stringify(result)).not.toContain("untrusted");
    expect(scenario.spatialEvidence).toBeDefined();
  });
  it("rejects expired, future, wrong-tab, absent and malformed records instead of substituting defaults", () => {
    const storage = new MemoryStorage();
    writeGuestDraft(storage, tab, nonce, input(), 100);
    expect(() => readGuestDraft(storage, "alfa-guest-tab:other", nonce, 101)).toThrow(/другой вкладке/);
    expect(() => readGuestDraft(new MemoryStorage(), tab, nonce, 101)).toThrow(/недоступен/);
    expect(() => readGuestDraft(storage, tab, "//evil.example", 101)).toThrow(/недоступен/);
    expect(() => readGuestDraft(storage, tab, nonce, 99)).toThrow(/истёк/);
    writeGuestDraft(storage, tab, nonce, input(), 100);
    expect(() => readGuestDraft(storage, tab, nonce, 101 + GUEST_DRAFT_TTL_MS)).toThrow(/истёк/);
    storage.setItem("alfa:guest-draft:" + nonce, "{");
    expect(() => readGuestDraft(storage, tab, nonce)).toThrow(/повреждён/);
  });
  it("keeps one exact draft and does not confuse an earlier nonce with newer edits", () => {
    const storage = new MemoryStorage();
    writeGuestDraft(storage, tab, nonce, input(), 100);
    writeGuestDraft(storage, tab, second, { ...input(), params: { forkliftSalaryRubMonth: 123457 } }, 101);
    expect(() => readGuestDraft(storage, tab, nonce, 102)).toThrow(/недоступен/);
    expect(readGuestDraft(storage, tab, second, 102).params.forkliftSalaryRubMonth).toBe(123457);
  });
  it("rejects tampered display fields and nonprimitive parameters without rendering an object as React content", () => {
    for (const corrupt of [
      (draft: GuestDraftInput) => { draft.scenarios[1]!.name = {} as never; },
      (draft: GuestDraftInput) => { draft.scenarios[1]!.kind = "foreign" as never; },
      (draft: GuestDraftInput) => { draft.scenarios[1]!.items = [{}] as never; },
      (draft: GuestDraftInput) => { draft.params.forkliftSalaryRubMonth = {} as never; },
    ]) {
      const storage = new MemoryStorage();
      writeGuestDraft(storage, tab, nonce, input(), 100);
      const record = JSON.parse(storage.getItem("alfa:guest-draft:" + nonce)!);
      corrupt(record);
      storage.setItem("alfa:guest-draft:" + nonce, JSON.stringify(record));
      expect(() => readGuestDraft(storage, tab, nonce, 101)).toThrow(/повреждён/);
    }
  });
  it("allows a large input below the shared 4MiB boundary and rejects over-boundary JSON/nonfinite numbers", () => {
    const storage = new MemoryStorage();
    const draft = input();
    draft.scenarios[1]!.siteLayout = { largePhysicalPlan: "x".repeat(2 * 1024 * 1024) } as never;
    writeGuestDraft(storage, tab, nonce, draft, 100);
    expect(readGuestDraft(storage, tab, nonce, 101).scenarios[1]!.siteLayout).toEqual(draft.scenarios[1]!.siteLayout);
    draft.scenarios[1]!.siteLayout = { largePhysicalPlan: "x".repeat(4 * 1024 * 1024) } as never;
    expect(() => writeGuestDraft(storage, tab, nonce, draft)).toThrow(/4 МиБ/);
    draft.scenarios[1]!.siteLayout = undefined;
    draft.params.forkliftSalaryRubMonth = NaN;
    expect(() => writeGuestDraft(storage, tab, nonce, draft)).toThrow(/повреждён|конечность/);
  });
  it("leaves the previous draft intact when quota/storage fails", () => {
    const storage = new MemoryStorage();
    writeGuestDraft(storage, tab, nonce, input(), 100);
    storage.setItem = () => { throw new Error("QuotaExceededError"); };
    expect(() => writeGuestDraft(storage, tab, second, input(), 101)).toThrow(/Хранилище/);
    expect(readGuestDraft(storage, tab, nonce, 102).params.forkliftSalaryRubMonth).toBe(123456);
  });
  it("auth destinations accept only a nonce, never a redirect URL or path/query injection", () => {
    for (const value of [undefined, [nonce], "https://evil.example", "/projects/foreign", "//evil.example", nonce + "&next=https://evil.example", "../" + nonce]) {
      expect(guestDraftNonce(value)).toBeNull();
      expect(guestDraftAuthDestination(value)).toBe("/projects");
      expect(guestDraftRoute("/login", value)).toBe("/login");
    }
    expect(guestDraftAuthDestination(nonce)).toBe(`/projects/new?guestDraft=${nonce}`);
    expect(guestDraftRoute("/signup", nonce)).toBe(`/signup?guestDraft=${nonce}`);
  });
  it("preserves a validated auth handoff in both header links and leaves normal/invalid routes alone", () => {
    for (const source of ["/login", "/signup"]) {
      for (const destination of ["/login", "/signup"] as const) {
        expect(guestDraftAuthLink(`http://localhost:3085${source}?guestDraft=${nonce}&error=1#form`, destination)).toBe(`${destination}?guestDraft=${nonce}`);
        expect(guestDraftAuthLink(`${source}?guestDraft=//evil.example`, destination)).toBe(destination);
        expect(guestDraftAuthLink(source, destination)).toBe(destination);
      }
    }
    for (const source of ["/", "/demo", "/catalog", "/projects/new", "/login/foreign"]) expect(guestDraftAuthLink(`${source}?guestDraft=${nonce}`, "/signup")).toBe("/signup");
  });
});
