import { isFacilitySlug, type FacilitySlug } from "@/lib/tz/processes";
import type { ParamValues, ScenarioSpec } from "@/lib/tz/types";
import { PROJECT_INPUT_MAX_BYTES, projectInputSizeIssue } from "./payload-limit";
import type { JobReceipt } from "@/lib/calculation-jobs/types";

// This is a local input transfer, never a saved result or a server receipt.
export const GUEST_DRAFT_TTL_MS = 30 * 60 * 1000;
export const GUEST_DRAFT_MAX_BYTES = PROJECT_INPUT_MAX_BYTES + 4096;
const PREFIX = "alfa:guest-draft:";
const TAB_PREFIX = "alfa-guest-tab:";
const NONCE = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export type GuestDraftInput = { facility: FacilitySlug; params: ParamValues; scenarios: ScenarioSpec[] };
export type GuestDraftCreate = { name: string; objectName: string; jobId?: string };
type DraftRecord = GuestDraftInput & { version: 1; tab: string; createdAt: number; create?: GuestDraftCreate };
type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;

export function guestDraftNonce(value: unknown): string | null {
  return typeof value === "string" && NONCE.test(value) ? value : null;
}

/** Only a fixed local destination is allowed; no callback URL is accepted. */
export function guestDraftRoute(path: "/login" | "/signup" | "/projects/new", nonce: unknown): string {
  const valid = guestDraftNonce(nonce);
  return valid ? `${path}?guestDraft=${encodeURIComponent(valid)}` : path;
}

export function guestDraftAuthDestination(nonce: unknown): string {
  return guestDraftNonce(nonce) ? guestDraftRoute("/projects/new", nonce) : "/projects";
}

/** Header login/signup navigation preserves only the active auth handoff, not arbitrary URLs. */
export function guestDraftAuthLink(currentUrl: string, destination: "/login" | "/signup"): string {
  try {
    const current = new URL(currentUrl, "https://local.invalid");
    return current.pathname === "/login" || current.pathname === "/signup"
      ? guestDraftRoute(destination, current.searchParams.get("guestDraft")) : destination;
  } catch { return destination; }
}

function inputOnly(raw: GuestDraftInput): GuestDraftInput {
  if (!raw || !isFacilitySlug(raw.facility) || !raw.params || typeof raw.params !== "object" || Array.isArray(raw.params)
    || Object.values(raw.params).some(value => value !== null && typeof value !== "string" && !(typeof value === "number" && Number.isFinite(value)))
    || !Array.isArray(raw.scenarios) || raw.scenarios.length < 1 || raw.scenarios.length > 10
    || raw.scenarios.some(s => !s || typeof s !== "object" || typeof s.key !== "string" || !/^[a-z0-9-]{1,40}$/.test(s.key)
      || typeof s.name !== "string" || !["asis", "purchase", "raas"].includes(s.kind) || !Array.isArray(s.items)
      || s.items.some(item => !item || typeof item !== "object" || typeof item.process !== "string" || typeof item.productSlug !== "string"))) {
    throw new Error("Черновик повреждён. Вернитесь к гостевому расчёту и повторите перенос.");
  }
  return { facility: raw.facility, params: raw.params,
    scenarios: raw.scenarios.map(s => { const copy = { ...s }; delete copy.spatialEvidence; return copy; }) };
}

export function writeGuestDraft(storage: StorageLike, tab: string, nonce: string, input: GuestDraftInput, now = Date.now()): void {
  if (!guestDraftNonce(nonce) || !tab.startsWith(TAB_PREFIX)) throw new Error("Не удалось подготовить перенос черновика.");
  const record: DraftRecord = { ...inputOnly(input), version: 1, tab, createdAt: now };
  const issue = projectInputSizeIssue({ operation: "CREATE", name: "x".repeat(120), objectName: "x".repeat(200),
    ...inputOnly(input), paramsSource: { kind: "manual" } });
  if (issue) throw new Error(issue);
  const json = JSON.stringify(record);
  if (new TextEncoder().encode(json).byteLength > GUEST_DRAFT_MAX_BYTES) throw new Error("Черновик слишком большой для переноса. Сохраните исходные данные отдельно.");
  // Write first: storage quota failure must not destroy a previous valid transfer.
  try { storage.setItem(PREFIX + nonce, json); }
  catch { throw new Error("Хранилище вкладки недоступно или переполнено. Черновик остался в расчёте: освободите место или разрешите хранилище и повторите вход отсюда."); }
  // One pending transfer in this tab: a previous nonce can never select another draft.
  const keys = Array.from({ length: storage.length }, (_, n) => storage.key(n));
  for (const key of keys) if (key?.startsWith(PREFIX) && key !== PREFIX + nonce) storage.removeItem(key);
}

function readRecord(storage: StorageLike, tab: string, nonce: unknown, now = Date.now()): DraftRecord {
  const valid = guestDraftNonce(nonce);
  const text = valid && storage.getItem(PREFIX + valid);
  if (!text || new TextEncoder().encode(text).byteLength > GUEST_DRAFT_MAX_BYTES) throw new Error("Черновик недоступен в этой вкладке. Вернитесь к гостевому расчёту и выполните вход из него.");
  let record: DraftRecord;
  try { record = JSON.parse(text) as DraftRecord; } catch { throw new Error("Черновик повреждён. Повторите перенос из гостевого расчёта."); }
  if (!record || typeof record !== "object" || Array.isArray(record)) throw new Error("Черновик повреждён. Повторите перенос из гостевого расчёта.");
  if (record.version !== 1 || !tab.startsWith(TAB_PREFIX) || record.tab !== tab) throw new Error("Этот черновик относится к другой вкладке. Продолжите в исходной вкладке.");
  if (!Number.isFinite(record.createdAt) || record.createdAt > now || now - record.createdAt > GUEST_DRAFT_TTL_MS) {
    storage.removeItem(PREFIX + valid);
    throw new Error("Срок переноса черновика истёк (30 минут). Повторите перенос из гостевого расчёта.");
  }
  inputOnly(record);
  if (record.create && (typeof record.create.name !== "string" || typeof record.create.objectName !== "string"
    || record.create.name.length > 120 || record.create.objectName.length > 200
    || record.create.jobId !== undefined && (typeof record.create.jobId !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(record.create.jobId)))) throw new Error("Контекст отправки черновика повреждён. Откройте список операций и проверьте принятый расчёт.");
  return record;
}

export function readGuestDraft(storage: StorageLike, tab: string, nonce: unknown, now = Date.now()): GuestDraftInput {
  return inputOnly(readRecord(storage, tab, nonce, now));
}

export function readGuestDraftCreate(storage: StorageLike, tab: string, nonce: unknown, now = Date.now()): GuestDraftCreate | null {
  return readRecord(storage, tab, nonce, now).create ?? null;
}

/** Persist the exact submission before POST, then bind its acknowledged job. Neither deletes inputs. */
export function setGuestDraftCreate(storage: StorageLike, tab: string, nonce: string, create: GuestDraftCreate, now = Date.now()): void {
  const record = readRecord(storage, tab, nonce, now);
  if (typeof create.name !== "string" || create.name.length > 120 || typeof create.objectName !== "string" || create.objectName.length > 200
    || create.jobId !== undefined && !/^[a-zA-Z0-9_-]{1,100}$/.test(create.jobId)) throw new Error("Некорректный контекст отправки черновика.");
  try { storage.setItem(PREFIX + nonce, JSON.stringify({ ...record, create })); }
  catch { throw new Error("Не удалось сохранить контекст отправки во вкладке. Входы черновика остаются доступны; проверьте принятую операцию перед повторной отправкой."); }
}

export function guestDraftJobRoute(jobId: string, nonce: string): string {
  return `/calculation-jobs/${encodeURIComponent(jobId)}?open=1&guestDraft=${encodeURIComponent(nonce)}`;
}

/** Call only with a fresh owned-job API receipt, never local/query publication claims. */
export function consumePublishedGuestDraft(storage: StorageLike, tab: string, nonce: string, job: Pick<JobReceipt, "id" | "operation" | "status" | "publicationState" | "projectId">, now = Date.now()): boolean {
  const create = readGuestDraftCreate(storage, tab, nonce, now);
  if (create?.jobId !== job.id || job.operation !== "CREATE" || job.status !== "SUCCEEDED" || job.publicationState !== "PUBLISHED" || !job.projectId) return false;
  removeGuestDraft(storage, nonce);
  return true;
}

export function removeGuestDraft(storage: StorageLike, nonce: string): void { storage.removeItem(PREFIX + nonce); }

/** window.name survives same-tab auth navigation; a nonce copied into another tab is insufficient. */
export function storeGuestDraft(input: GuestDraftInput): string {
  try {
    if (!window.name.startsWith(TAB_PREFIX)) window.name = TAB_PREFIX + crypto.randomUUID();
    const nonce = crypto.randomUUID();
    writeGuestDraft(window.sessionStorage, window.name, nonce, input);
    return nonce;
  } catch (error) {
    if (error instanceof DOMException && error.name === "SecurityError") throw new Error("Хранилище вкладки заблокировано. Разрешите его и повторите вход из этого расчёта; исходные данные остаются на экране.");
    throw error;
  }
}

export function loadGuestDraft(nonce: unknown): GuestDraftInput {
  try { return readGuestDraft(window.sessionStorage, window.name, nonce); }
  catch (error) {
    if (error instanceof DOMException && error.name === "SecurityError") throw new Error("Хранилище вкладки заблокировано. Разрешите его и повторите перенос из гостевого расчёта.");
    throw error;
  }
}
