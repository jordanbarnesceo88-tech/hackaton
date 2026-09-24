// Проверка запуска на чистом экземпляре без Docker (ТЗ §4.2.3, §4.2.7, §8.2.2).
//
// Повторяет на машине разработчика путь `docker compose up`: пустая база → миграции → сев →
// собранный сервер → /api/health и страницы. Нужна потому, что Docker локально может быть
// недоступен. В CI тот же путь проходит задача docker (.github/workflows/ci.yml), уже в образах.
//
// Запускать ТОЛЬКО после `npm run build`: проверяется сборка .next/standalone/server.js.
//
//   npm run check:fresh                 полный прогон
//   npm run check:fresh -- --dry-run    только предпосылки: ничего не создаёт и не запускает
//
// Порядок:
//   1. На локальном Postgres (адрес из DATABASE_URL в .env, только localhost) создаётся пустая
//      база rrp_fresh_<unix-время>.
//   2. `prisma migrate deploy` и `tsx scripts/seed.ts` с DATABASE_URL, указывающим на неё.
//   3. `node .next/standalone/server.js` на 127.0.0.1:3100.
//   4. До 60 с ожидается GET /api/health с ok:true; затем GET / и GET /demo должны отдать 200.
//   5. В finally сервер останавливается, временная база удаляется, печатается отчёт.
// Код выхода 0 — проверка пройдена, 1 — нет. Последняя строка вывода — итог.
//
// Скрипт трогает только базу, которую создал сам: перед DROP имя сверяется с шаблоном.
// Рабочая база из .env не меняется — к ней скрипт подключается лишь затем, чтобы выполнить
// CREATE DATABASE и DROP DATABASE для временной.
//
// Про вывод в файл: в Windows PowerShell 5.1 оператор `>` пишет UTF-16, и кириллица в логе
// может испортиться. Для файла-доказательства запускайте из bash (Git Bash) или через
// `| Out-File -Encoding utf8`.
//
// RELATIVE import, как в остальных скриптах: исходники из lib/ подключаются относительным путём.
import "dotenv/config";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { connect } from "node:net";
import { dirname, join } from "node:path";
import type { Readable } from "node:stream";
import { Client } from "pg";
import { SIM_MODEL_VERSION, TZ_MODEL_VERSION } from "../lib/tz/version";

const ROOT = join(import.meta.dirname, "..");
const SERVER_JS = join(ROOT, ".next", "standalone", "server.js");
// CLI вызываются напрямую через node, а не через npx: в Windows запуск .cmd-обёрток без shell
// запрещён, а shell с аргументами Node помечает как небезопасный. Команды те же:
// `npx prisma migrate deploy` и `npx tsx scripts/seed.ts`.
const PRISMA_CLI = join(ROOT, "node_modules", "prisma", "build", "index.js");
const TSX_CLI = join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");

const HOST = "127.0.0.1";
const PORT = 3100;
const BASE = `http://${HOST}:${PORT}`;
const PAGES = ["/", "/demo"] as const;

/** Тот же адрес, что в .env.example; берётся, если DATABASE_URL не задан. */
const DEFAULT_DATABASE_URL = "postgresql://rrp:rrp_dev_password@localhost:5433/robotization_roi";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const FRESH_DB_RE = /^rrp_fresh_\d+$/;

/** Бюджет на подъём сервера до ok:true от /api/health (по заданию T1.7 — 60 с). */
const READY_BUDGET_MS = 60_000;
const HEALTH_REQUEST_TIMEOUT_MS = 5_000;
const PAGE_TIMEOUT_MS = 30_000;
const MIGRATE_TIMEOUT_MS = 180_000;
const SEED_TIMEOUT_MS = 600_000;

/** Демо-аккаунты, которые создаёт сев (scripts/seed.ts); их же README называет для жюри. */
const DEMO_EMAILS = ["demo@demo.local", "admin@demo.local"];
const DEMO_PROJECT_ID = "demo-warehouse";

/** Таблицы, по которым печатается сводка сева: [имя таблицы, подпись в отчёте]. */
const SEED_TABLES: ReadonlyArray<readonly [string, string]> = [
  ["Industry", "отраслей"],
  ["FacilityType", "типов объектов"],
  ["Solution", "решений v1"],
  ["Process", "процессов"],
  ["SolutionType", "типов решений"],
  ["CatalogProduct", "продуктов каталога"],
  ["ProductCharacteristic", "характеристик продуктов"],
  ["ParamDefinition", "параметров объектов"],
  ["Norm", "нормативов"],
  ["DataRelease", "выпусков данных"],
  ["Project", "проектов"],
];

type Status = "ok" | "warn" | "fail" | "info";
type Step = { status: Status; title: string; detail?: string; ms?: number };
type Health = { ok: boolean; db: boolean; modelVersion?: unknown; simModelVersion?: unknown };

/** Ожидаемый провал проверки: сообщение уже по-русски и говорит, как исправить. */
class CheckFailed extends Error {}

const MARK: Record<Status, string> = { ok: "[ OK ]", warn: "[ !! ]", fail: "[СБОЙ]", info: "[ .. ]" };
const steps: Step[] = [];

const state: {
  adminUrl: URL | null;
  freshDb: string | null;
  dbCreated: boolean;
  server: ChildProcess | null;
  serverExit: string | null;
  children: Set<ChildProcess>;
} = { adminUrl: null, freshDb: null, dbCreated: false, server: null, serverExit: null, children: new Set() };

// ─── вывод ──────────────────────────────────────────────────────────────────────────────────

function out(line = ""): void {
  process.stdout.write(`${line}\n`);
}

/** Секунды с одной цифрой после десятичной запятой: «4,2 с». */
function sec(ms: number): string {
  return `${(ms / 1000).toFixed(1).replace(".", ",")} с`;
}

function formatStep(s: Step): string {
  const time = s.ms === undefined ? "" : ` (${sec(s.ms)})`;
  const detail = s.detail ? ` — ${s.detail}` : "";
  return `${MARK[s.status]} ${s.title}${detail}${time}`;
}

function record(step: Step): void {
  steps.push(step);
  out(formatStep(step));
}

function errorText(e: unknown): string {
  if (e instanceof Error) {
    const cause = (e as Error & { cause?: { code?: string; message?: string } }).cause;
    const causeText = cause?.code ?? cause?.message;
    return causeText ? `${e.message} (${causeText})` : e.message;
  }
  return String(e);
}

/** Адрес базы без пароля — для отчёта. */
function describeDb(url: URL): string {
  return `${url.hostname}:${url.port || "5432"}${url.pathname}`;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Та же пауза, но таймер не держит процесс живым после того, как всё остальное завершилось. */
const sleepUnref = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms).unref());

/** Построчно пересылает поток дочернего процесса в наш stdout с отступом-префиксом. */
function pipeLines(stream: Readable | null, prefix: string): void {
  if (!stream) return;
  let buf = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk: string) => {
    buf += chunk;
    const lines = buf.split(/\r?\n/);
    buf = lines.pop() ?? "";
    for (const line of lines) out(`${prefix}${line}`);
  });
  stream.on("end", () => {
    if (buf) out(`${prefix}${buf}`);
    buf = "";
  });
}

// ─── дочерние процессы ──────────────────────────────────────────────────────────────────────

/** Запускает `node <args>` в корне репозитория, пересылает вывод, ждёт выхода или таймаута. */
function runNode(
  args: string[],
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
): Promise<{ code: number | null; timedOut: boolean; ms: number }> {
  const startedAt = Date.now();
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
    state.children.add(child);
    pipeLines(child.stdout, "       │ ");
    pipeLines(child.stderr, "       │ ");
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    let finished = false;
    const finish = (code: number | null) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      state.children.delete(child);
      resolve({ code, timedOut, ms: Date.now() - startedAt });
    };
    child.once("error", (e) => {
      out(`       │ не удалось запустить: ${errorText(e)}`);
      finish(null);
    });
    // close, а не exit: close приходит после того, как дочитан весь вывод процесса, и строка
    // итога шага не вклинивается перед его последними строками.
    child.once("close", (code) => finish(code));
  });
}

/** Окружение дочерних процессов: DATABASE_URL на временную базу, без цветного вывода. */
function childEnv(databaseUrl: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  // Только NO_COLOR: вместе с FORCE_COLOR Node печатает предупреждение о конфликте переменных.
  const env: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: databaseUrl, NO_COLOR: "1", ...extra };
  delete env.FORCE_COLOR;
  return env;
}

function portInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: HOST, port });
    const done = (inUse: boolean) => {
      socket.destroy();
      resolve(inUse);
    };
    // Молчание на loopback — не «свободен»: осторожнее считать порт занятым.
    socket.setTimeout(2000, () => done(true));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

async function withClient<T>(url: URL, fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: url.toString(), connectionTimeoutMillis: 10_000 });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end().catch(() => undefined);
  }
}

// ─── шаги проверки ──────────────────────────────────────────────────────────────────────────

function resolveAdminUrl(): URL {
  const raw = process.env.DATABASE_URL?.trim() || DEFAULT_DATABASE_URL;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new CheckFailed("DATABASE_URL не разбирается как адрес postgresql://… — сверьте с .env.example");
  }
  if (!LOCAL_HOSTS.has(url.hostname)) {
    throw new CheckFailed(
      `DATABASE_URL указывает на ${url.hostname}, а проверка создаёт и удаляет базы, поэтому ` +
        `работает только с локальным Postgres. Укажите localhost, как в .env.example.`,
    );
  }
  return url;
}

function requireFile(path: string, howToFix: string): void {
  if (!existsSync(path)) throw new CheckFailed(howToFix);
}

async function checkPrerequisites(): Promise<URL> {
  const adminUrl = resolveAdminUrl();
  requireFile(SERVER_JS, "нет сборки .next/standalone/server.js — сначала выполните npm run build");
  requireFile(PRISMA_CLI, "не найден Prisma CLI (node_modules/prisma) — выполните npm ci");
  requireFile(TSX_CLI, "не найден tsx (node_modules/tsx) — выполните npm ci");
  if (await portInUse(PORT)) {
    throw new CheckFailed(
      `порт ${PORT} уже занят — остановите процесс на нём, иначе проверка опросила бы чужой сервер`,
    );
  }
  let canCreate: boolean;
  try {
    canCreate = await withClient(adminUrl, async (c) => {
      const r = await c.query<{ can: boolean }>(
        "SELECT (rolsuper OR rolcreatedb) AS can FROM pg_roles WHERE rolname = current_user",
      );
      return r.rows[0]?.can === true;
    });
  } catch (e) {
    throw new CheckFailed(
      `Postgres ${describeDb(adminUrl)} недоступен: ${errorText(e)}. Запустите базу ` +
        `(порт 5433, см. .env.example) и повторите.`,
    );
  }
  if (!canCreate) {
    throw new CheckFailed(
      `у пользователя ${decodeURIComponent(adminUrl.username)} нет права CREATEDB — ` +
        `выдайте его: ALTER ROLE ${decodeURIComponent(adminUrl.username)} CREATEDB;`,
    );
  }
  return adminUrl;
}

async function createFreshDb(adminUrl: URL): Promise<URL> {
  const name = `rrp_fresh_${Math.floor(Date.now() / 1000)}`;
  if (!FRESH_DB_RE.test(name)) throw new CheckFailed(`недопустимое имя временной базы: ${name}`);
  const startedAt = Date.now();
  await withClient(adminUrl, (c) => c.query(`CREATE DATABASE "${name}"`));
  state.freshDb = name;
  state.dbCreated = true;
  const freshUrl = new URL(adminUrl.toString());
  freshUrl.pathname = `/${name}`;
  record({ status: "ok", title: "Создана пустая база", detail: describeDb(freshUrl), ms: Date.now() - startedAt });
  return freshUrl;
}

async function runStep(title: string, args: string[], env: NodeJS.ProcessEnv, timeoutMs: number): Promise<void> {
  out(`${MARK.info} ${title}…`);
  const r = await runNode(args, env, timeoutMs);
  if (r.timedOut) throw new CheckFailed(`${title}: не завершилось за ${sec(timeoutMs)}`);
  if (r.code !== 0) throw new CheckFailed(`${title}: код выхода ${r.code ?? "нет"} — причина в выводе выше`);
  record({ status: "ok", title, ms: r.ms });
}

/**
 * Сводка того, что сев положил в чистую базу. Справочная: код выхода от неё не зависит,
 * недостающие демо-аккаунты и демо-проект отмечаются предупреждением.
 */
async function reportSeededData(freshUrl: URL): Promise<void> {
  await withClient(freshUrl, async (c) => {
    const existing = await c.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema()",
    );
    const have = new Set(existing.rows.map((r) => r.table_name));
    const parts: string[] = [];
    for (const [table, label] of SEED_TABLES) {
      if (!have.has(table)) continue;
      // Имя таблицы — из константного списка выше, не из ввода.
      const r = await c.query<{ n: string }>(`SELECT count(*)::text AS n FROM "${table}"`);
      parts.push(`${label} ${r.rows[0]?.n ?? "?"}`);
    }
    record({ status: "info", title: "Данные после сева", detail: parts.join(", ") });

    const users = await c.query<{ email: string; role: string }>(
      `SELECT email, role::text AS role FROM "User" WHERE email = ANY($1) ORDER BY email`,
      [DEMO_EMAILS],
    );
    if (users.rows.length === DEMO_EMAILS.length) {
      record({
        status: "ok",
        title: "Демо-аккаунты созданы",
        detail: users.rows.map((u) => `${u.email} (${u.role})`).join(", "),
      });
    } else {
      const found = new Set(users.rows.map((u) => u.email));
      record({
        status: "warn",
        title: "Не хватает демо-аккаунтов",
        detail: `нет: ${DEMO_EMAILS.filter((e) => !found.has(e)).join(", ")} — жюри не сможет войти`,
      });
    }

    if (have.has("Project")) {
      const demo = await c.query(`SELECT 1 FROM "Project" WHERE id = $1`, [DEMO_PROJECT_ID]);
      record(
        demo.rowCount
          ? { status: "ok", title: "Демо-проект на месте", detail: DEMO_PROJECT_ID }
          : { status: "warn", title: "Демо-проект не засеян", detail: `нет проекта ${DEMO_PROJECT_ID}` },
      );
    }
  });
}

function startServer(freshUrl: URL): void {
  const server = spawn(process.execPath, [SERVER_JS], {
    cwd: dirname(SERVER_JS),
    env: childEnv(freshUrl.toString(), {
      NODE_ENV: "production",
      PORT: String(PORT),
      HOSTNAME: HOST,
      AUTH_SECRET: "fresh-check",
      // Явно: иначе standalone-сервер подхватит AUTH_URL из скопированного в сборку .env.
      AUTH_URL: BASE,
    }),
    stdio: ["ignore", "pipe", "pipe"],
  });
  state.server = server;
  pipeLines(server.stdout, "  сервер │ ");
  pipeLines(server.stderr, "  сервер │ ");
  server.once("error", (e) => {
    state.serverExit = `не запустился: ${errorText(e)}`;
  });
  server.once("exit", (code, signal) => {
    state.serverExit = `завершился (код ${code ?? "нет"}${signal ? `, сигнал ${signal}` : ""})`;
  });
  out(`${MARK.info} Запуск собранного сервера: node .next/standalone/server.js на ${BASE}…`);
}

function isHealth(body: unknown): body is Health {
  if (typeof body !== "object" || body === null) return false;
  const b = body as Record<string, unknown>;
  return typeof b.ok === "boolean" && typeof b.db === "boolean";
}

async function waitForHealth(): Promise<void> {
  const startedAt = Date.now();
  let last = "ещё не отвечал";
  while (Date.now() - startedAt < READY_BUDGET_MS) {
    if (state.serverExit) throw new CheckFailed(`сервер ${state.serverExit} — причина в выводе выше`);
    try {
      const res = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(HEALTH_REQUEST_TIMEOUT_MS) });
      const text = await res.text();
      let body: unknown = null;
      try {
        body = JSON.parse(text);
      } catch {
        body = null;
      }
      if (res.status === 200 && isHealth(body) && body.ok && body.db) {
        if (body.modelVersion !== TZ_MODEL_VERSION || body.simModelVersion !== SIM_MODEL_VERSION) {
          throw new CheckFailed(
            `сборка устарела: сервер отвечает ${String(body.modelVersion)} / ${String(body.simModelVersion)}, ` +
              `в коде ${TZ_MODEL_VERSION} / ${SIM_MODEL_VERSION} — пересоберите: npm run build`,
          );
        }
        record({ status: "ok", title: "GET /api/health → 200", detail: text.trim(), ms: Date.now() - startedAt });
        return;
      }
      last = `HTTP ${res.status} ${text.trim().slice(0, 200)}`;
    } catch (e) {
      if (e instanceof CheckFailed) throw e;
      last = errorText(e);
    }
    await sleep(1000);
  }
  throw new CheckFailed(`/api/health не ответил ok:true за ${sec(READY_BUDGET_MS)}; последний ответ: ${last}`);
}

async function checkPage(path: string): Promise<void> {
  const startedAt = Date.now();
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, { redirect: "manual", signal: AbortSignal.timeout(PAGE_TIMEOUT_MS) });
    await res.text();
  } catch (e) {
    throw new CheckFailed(`GET ${path}: ${errorText(e)}`);
  }
  if (res.status !== 200) {
    const location = res.headers.get("location");
    throw new CheckFailed(
      `GET ${path} → ${res.status}${location ? ` (перенаправление на ${location})` : ""}, ожидался 200`,
    );
  }
  record({ status: "ok", title: `GET ${path} → 200`, ms: Date.now() - startedAt });
}

// ─── уборка ─────────────────────────────────────────────────────────────────────────────────

function waitExit(child: ChildProcess, ms: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return Promise.race([
    new Promise<boolean>((resolve) => child.once("exit", () => resolve(true))),
    sleepUnref(ms).then(() => false),
  ]);
}

async function stopProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill();
  if (!(await waitExit(child, 5000))) {
    child.kill("SIGKILL");
    await waitExit(child, 2000);
  }
}

async function dropFreshDb(): Promise<void> {
  const { adminUrl, freshDb } = state;
  if (!state.dbCreated || !adminUrl || !freshDb) return;
  if (!FRESH_DB_RE.test(freshDb)) {
    record({ status: "warn", title: "Временная база не удалена", detail: `имя ${freshDb} не похоже на временное` });
    return;
  }
  try {
    await withClient(adminUrl, async (c) => {
      try {
        // WITH (FORCE) обрывает оставшиеся соединения (Postgres 13+), иначе DROP ждал бы их.
        await c.query(`DROP DATABASE IF EXISTS "${freshDb}" WITH (FORCE)`);
      } catch (e) {
        if ((e as { code?: string }).code !== "42601") throw e;
        await c.query(`DROP DATABASE IF EXISTS "${freshDb}"`);
      }
    });
    state.dbCreated = false;
    record({ status: "ok", title: "Временная база удалена", detail: freshDb });
  } catch (e) {
    record({
      status: "warn",
      title: "Временная база не удалена",
      detail: `${errorText(e)}; удалите вручную: DROP DATABASE "${freshDb}";`,
    });
  }
}

let cleanupPromise: Promise<void> | null = null;

function cleanup(): Promise<void> {
  cleanupPromise ??= (async () => {
    for (const child of state.children) await stopProcess(child);
    if (state.server) {
      await stopProcess(state.server);
      out(`${MARK.info} Сервер остановлен`);
    }
    await dropFreshDb();
  })();
  return cleanupPromise;
}

// ─── основной сценарий ──────────────────────────────────────────────────────────────────────

async function run(dryRun: boolean): Promise<void> {
  const adminUrl = await checkPrerequisites();
  state.adminUrl = adminUrl;
  record({
    status: "ok",
    title: "Предпосылки",
    detail:
      `сборка, Prisma CLI и tsx на месте; порт ${PORT} свободен; Postgres ` +
      `${describeDb(adminUrl)} доступен, право CREATEDB есть`,
  });
  if (dryRun) return;

  const freshUrl = await createFreshDb(adminUrl);
  const env = childEnv(freshUrl.toString());
  await runStep("Миграции (prisma migrate deploy)", [PRISMA_CLI, "migrate", "deploy"], env, MIGRATE_TIMEOUT_MS);
  await runStep("Сев (tsx scripts/seed.ts)", [TSX_CLI, "scripts/seed.ts"], env, SEED_TIMEOUT_MS);
  try {
    await reportSeededData(freshUrl);
  } catch (e) {
    // Сводка справочная: сбой её запроса — не повод объявлять запуск неудачным.
    record({ status: "warn", title: "Сводку сева прочитать не удалось", detail: errorText(e) });
  }

  startServer(freshUrl);
  await waitForHealth();
  for (const path of PAGES) await checkPage(path);
}

function gitCommit(): Promise<string> {
  return new Promise((resolve) => {
    let text = "";
    const git = spawn("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] });
    git.stdout.setEncoding("utf8");
    git.stdout.on("data", (chunk: string) => (text += chunk));
    git.once("error", () => resolve("неизвестен"));
    git.once("exit", (code) => resolve(code === 0 && text.trim() ? text.trim() : "неизвестен"));
  });
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  process.once("SIGINT", () => {
    out("\nПрервано — останавливаю сервер и удаляю временную базу…");
    void cleanup().finally(() => process.exit(130));
  });

  out(`Проверка на чистом экземпляре${dryRun ? " — только предпосылки (--dry-run)" : ""}`);
  out(
    `Время: ${new Date().toISOString()} · коммит ${await gitCommit()} · Node ${process.version} · ` +
      `модель ${TZ_MODEL_VERSION}, имитация ${SIM_MODEL_VERSION}`,
  );
  out();

  let failure: string | null = null;
  try {
    await run(dryRun);
  } catch (e) {
    failure = e instanceof CheckFailed ? e.message : `непредвиденная ошибка: ${errorText(e)}`;
    if (!(e instanceof CheckFailed) && e instanceof Error && e.stack) out(e.stack);
    record({ status: "fail", title: "Проверка остановлена", detail: failure });
  } finally {
    await cleanup();
  }

  out();
  out("──────── Итог ────────");
  for (const s of steps) out(formatStep(s));
  const warnings = steps.filter((s) => s.status === "warn").length;
  out();
  if (failure) {
    process.exitCode = 1;
    out(`ИТОГ: проверка на чистом экземпляре НЕ пройдена — ${failure}`);
  } else if (dryRun) {
    out("ИТОГ: предпосылки в порядке, полный прогон: npm run check:fresh");
  } else {
    const tail = warnings ? ` Предупреждений: ${warnings}, см. строки [ !! ] выше.` : "";
    out(
      "ИТОГ: проверка на чистом экземпляре пройдена — пустая база, миграции, сев, сервер " +
        `сборки, /api/health и страницы ${PAGES.join(", ")} отвечают.${tail}`,
    );
  }
}

void main();
