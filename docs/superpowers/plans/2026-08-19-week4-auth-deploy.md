# Week 4 Auth + Save/Revisit + Deploy-Ready Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add credentials auth (Auth.js v5), let a logged-in user save and revisit an analysis
(anonymous Steps 1-4 stay open), and make the app deploy-ready (config + runbook only).

**Architecture:** Auth.js v5 with a single Credentials provider + JWT sessions; bcryptjs for
password hashing; a `User` + `SavedAnalysis` Prisma model. Gating is done in server components
via the `auth()` helper — NO middleware, NO Prisma in edge code. Save/revisit stores the full
analysis inputs + a results snapshot and reopens the calculator seeded from it.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, Tailwind v4, shadcn/ui, Prisma 7
(pg driver adapter), Auth.js v5 (`next-auth@beta`), bcryptjs, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-19-week4-auth-deploy-design.md`

## Global Constraints

- Repo root `~/robotization-roi-platform`, branch `week4-auth-deploy`. DB up (Docker, port
  **5433**), `.env` has the correct `DATABASE_URL`. Prisma 7: driver adapter in
  `lib/db/client.ts`, URL in `prisma.config.ts` (schema has no inline url); run
  `npx prisma generate` after any schema change.
- **NO middleware; NO Prisma/auth-node code in edge runtime.** Gate protected routes by calling
  `auth()` inside server components / route handlers / server actions and redirecting. All
  Prisma + password + session logic runs in the Node runtime.
- **Anonymous use stays UNGATED:** `/onboarding`, `/compare/[type]`, `/calculate/[solutionId]`
  (without `?analysis=`) must work with no session. Only saving an analysis and `/analyses`
  require login.
- **Security:** passwords bcrypt-hashed (cost 10), never plaintext/logged; `AUTH_SECRET` never
  committed (`.env` gitignored; `.env.example` placeholder only); every `SavedAnalysis` read is
  filtered by the session `userId` (no cross-user access); login errors are generic.
- **UI language is Russian**; money via `formatCost`. Vitest config `vitest.config.mts` (has the
  `@/` alias + `dotenv/config` setup); run `npx --yes vitest run <path> < /dev/null` (never
  watch). Prefix npx with `--yes`; never spawn a Monitor or leave a dev server running.
- The `@/` alias maps to the repo root, so `auth.ts` at root is imported as `@/auth`.

---

### Task 1: Deps + `User`/`SavedAnalysis` schema + migration

**Files:**
- Modify: `package.json` (deps), `prisma/schema.prisma`
- Create (generated): `prisma/migrations/<ts>_auth/migration.sql`

**Interfaces:**
- Produces: `next-auth@beta`, `bcryptjs`, `@types/bcryptjs` installed; Prisma models `User`
  (id, email @unique, passwordHash, name?, createdAt, savedAnalyses) and `SavedAnalysis` (id,
  userId→User cascade, name, facilityTypeSlug, solutionId, params Json, assumptions Json,
  results Json, createdAt, @@index([userId])); generated client exposes `prisma.user` /
  `prisma.savedAnalysis`.

- [ ] **Step 1: Install deps**

```bash
npm install next-auth@beta bcryptjs
npm install -D @types/bcryptjs
```

- [ ] **Step 2: Add the models to `prisma/schema.prisma`**

Append:
```prisma
model User {
  id            String          @id @default(cuid())
  email         String          @unique
  passwordHash  String
  name          String?
  createdAt     DateTime        @default(now())
  savedAnalyses SavedAnalysis[]
}

model SavedAnalysis {
  id               String   @id @default(cuid())
  userId           String
  user             User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  name             String
  facilityTypeSlug String
  solutionId       String
  params           Json
  assumptions      Json
  results          Json
  createdAt        DateTime @default(now())

  @@index([userId])
}
```

- [ ] **Step 3: Migrate + generate**

```bash
docker compose up -d
until docker compose exec -T db pg_isready -U rrp > /dev/null 2>&1; do sleep 1; done
npx --yes prisma migrate dev --name auth < /dev/null
npx --yes prisma validate
npx --yes prisma generate
```
Expected: migration applies; "schema is valid"; client generated.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json prisma/schema.prisma prisma/migrations
git commit -m "Add auth deps + User/SavedAnalysis models"
```

---

### Task 2: Password hashing util (`lib/auth/password.ts`) — TDD

**Files:**
- Create: `lib/auth/password.ts`, `lib/auth/password.test.ts`

**Interfaces:**
- Produces: `hashPassword(plain: string): Promise<string>`,
  `verifyPassword(plain: string, hash: string): Promise<boolean>` (bcryptjs, cost 10).

- [ ] **Step 1: Write the failing tests — `lib/auth/password.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "./password";

describe("password hashing", () => {
  it("hashes a password to a non-plaintext bcrypt string", async () => {
    const hash = await hashPassword("correct horse battery");
    expect(hash).not.toBe("correct horse battery");
    expect(hash).toMatch(/^\$2[aby]\$/); // bcrypt prefix
  });
  it("verifies the correct password", async () => {
    const hash = await hashPassword("s3cret-password");
    expect(await verifyPassword("s3cret-password", hash)).toBe(true);
  });
  it("rejects a wrong password", async () => {
    const hash = await hashPassword("s3cret-password");
    expect(await verifyPassword("wrong", hash)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx --yes vitest run lib/auth/password.test.ts < /dev/null`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/auth/password.ts`**

```ts
import bcrypt from "bcryptjs";

const COST = 10;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, COST);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx --yes vitest run lib/auth/password.test.ts < /dev/null`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/auth/password.ts lib/auth/password.test.ts
git commit -m "Add bcrypt password hash/verify util"
```

---

### Task 3: Auth.js v5 config + route handler + AUTH_SECRET

**Files:**
- Create: `auth.ts` (repo root), `app/api/auth/[...nextauth]/route.ts`, `types/next-auth.d.ts`
- Modify: `.env`, `.env.example`, `tsconfig.json` (ensure `types/` is included — usually
  covered by the default `**/*.ts`, so no change needed unless the build complains)

**Interfaces:**
- Consumes: `prisma` (`@/lib/db/client`), `verifyPassword` (`@/lib/auth/password`).
- Produces: `auth`, `signIn`, `signOut`, `handlers` exported from `@/auth`; the session's
  `user.id` is populated. Consumed by Tasks 4-6.

- [ ] **Step 1: Generate `AUTH_SECRET` into `.env`**

```bash
echo "AUTH_SECRET=$(openssl rand -base64 32)" >> .env
```

- [ ] **Step 2: Add the placeholder to `.env.example`**

Append to `.env.example`:
```
# Auth.js v5 — generate with: openssl rand -base64 32
AUTH_SECRET=
```

- [ ] **Step 3: Create `auth.ts` (repo root)**

```ts
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { prisma } from "@/lib/db/client";
import { verifyPassword } from "@/lib/auth/password";

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      authorize: async (creds) => {
        const email = String(creds?.email ?? "").toLowerCase().trim();
        const password = String(creds?.password ?? "");
        if (!email || !password) return null;
        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) return null;
        const ok = await verifyPassword(password, user.passwordHash);
        if (!ok) return null;
        return { id: user.id, email: user.email, name: user.name ?? undefined };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user?.id) token.id = user.id;
      return token;
    },
    session({ session, token }) {
      if (token.id && session.user) session.user.id = token.id as string;
      return session;
    },
  },
});
```

- [ ] **Step 4: Create the route handler `app/api/auth/[...nextauth]/route.ts`**

```ts
import { handlers } from "@/auth";

export const { GET, POST } = handlers;
```

- [ ] **Step 5: Create `types/next-auth.d.ts` (add `id` to the session user)**

```ts
import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: { id: string } & DefaultSession["user"];
  }
}
```

- [ ] **Step 6: Verify the build**

Run: `npm run build`
Expected: exit 0. (If TS complains that `token.id` is unknown, it is expected to still build —
the assignment is guarded; if it errors, add `import type { JWT } from "next-auth/jwt"` module
augmentation `declare module "next-auth/jwt" { interface JWT { id?: string } }` to
`types/next-auth.d.ts`.)

- [ ] **Step 7: Commit**

```bash
git add auth.ts "app/api/auth" types/next-auth.d.ts .env.example
git commit -m "Add Auth.js v5 credentials config + route handler"
```

---

### Task 4: Signup/login UI + header auth state

**Files:**
- Create: `app/(auth)/signup/page.tsx`, `app/(auth)/login/page.tsx`,
  `lib/auth/actions.ts` (server actions), `components/site-header.tsx`
- Modify: `app/layout.tsx` (render the header)

**Interfaces:**
- Consumes: `signIn`/`signOut`/`auth` (`@/auth`), `prisma` (`@/lib/db/client`),
  `hashPassword` (`@/lib/auth/password`).
- Produces: `signUpAction(prevState, formData)` and `logoutAction()` server actions
  (`@/lib/auth/actions`); routes `/signup`, `/login`; `<SiteHeader />`.

- [ ] **Step 1: Create `lib/auth/actions.ts` (server actions)**

```ts
"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db/client";
import { hashPassword } from "@/lib/auth/password";
import { signIn, signOut } from "@/auth";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export type SignUpState = { error: string | null };

export async function signUpAction(
  _prev: SignUpState,
  formData: FormData
): Promise<SignUpState> {
  const email = String(formData.get("email") ?? "").toLowerCase().trim();
  const password = String(formData.get("password") ?? "");
  const name = String(formData.get("name") ?? "").trim() || null;

  if (!EMAIL_RE.test(email)) return { error: "Некорректный email" };
  if (password.length < 8) return { error: "Пароль должен быть не короче 8 символов" };

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return { error: "Пользователь с таким email уже существует" };

  const passwordHash = await hashPassword(password);
  await prisma.user.create({ data: { email, passwordHash, name } });
  // signIn throws a redirect on success.
  await signIn("credentials", { email, password, redirectTo: "/" });
  return { error: null };
}

export async function logoutAction(): Promise<void> {
  await signOut({ redirectTo: "/" });
}
```

- [ ] **Step 2: Create `app/(auth)/login/page.tsx`**

```tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { signIn } from "@/auth";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  async function login(formData: FormData) {
    "use server";
    try {
      await signIn("credentials", {
        email: String(formData.get("email") ?? "").toLowerCase().trim(),
        password: String(formData.get("password") ?? ""),
        redirectTo: "/",
      });
    } catch (e) {
      // next-auth throws a redirect on success; re-throw those.
      if (e && typeof e === "object" && "digest" in e && String((e as { digest: string }).digest).startsWith("NEXT_REDIRECT")) {
        throw e;
      }
      redirect("/login?error=1");
    }
  }
  return (
    <div className="mx-auto flex max-w-sm flex-col gap-4 py-16">
      <h1 className="text-2xl font-semibold">Вход</h1>
      {error && <p className="text-sm text-red-600">Неверный email или пароль</p>}
      <form action={login} className="flex flex-col gap-3">
        <input name="email" type="email" required placeholder="Email"
          className="rounded-md border px-3 py-2 text-sm" />
        <input name="password" type="password" required placeholder="Пароль"
          className="rounded-md border px-3 py-2 text-sm" />
        <button type="submit" className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground">
          Войти
        </button>
      </form>
      <p className="text-sm text-muted-foreground">
        Нет аккаунта? <Link href="/signup" className="underline">Регистрация</Link>
      </p>
    </div>
  );
}
```

- [ ] **Step 3: Create `app/(auth)/signup/page.tsx`**

```tsx
"use client";

import Link from "next/link";
import { useActionState } from "react";
import { signUpAction, type SignUpState } from "@/lib/auth/actions";

const initial: SignUpState = { error: null };

export default function SignupPage() {
  const [state, action, pending] = useActionState(signUpAction, initial);
  return (
    <div className="mx-auto flex max-w-sm flex-col gap-4 py-16">
      <h1 className="text-2xl font-semibold">Регистрация</h1>
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      <form action={action} className="flex flex-col gap-3">
        <input name="name" type="text" placeholder="Имя (необязательно)"
          className="rounded-md border px-3 py-2 text-sm" />
        <input name="email" type="email" required placeholder="Email"
          className="rounded-md border px-3 py-2 text-sm" />
        <input name="password" type="password" required placeholder="Пароль (мин. 8 символов)"
          className="rounded-md border px-3 py-2 text-sm" />
        <button type="submit" disabled={pending}
          className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50">
          Зарегистрироваться
        </button>
      </form>
      <p className="text-sm text-muted-foreground">
        Уже есть аккаунт? <Link href="/login" className="underline">Войти</Link>
      </p>
    </div>
  );
}
```

- [ ] **Step 4: Create `components/site-header.tsx` (server component)**

```tsx
import Link from "next/link";
import { auth } from "@/auth";
import { logoutAction } from "@/lib/auth/actions";

export async function SiteHeader() {
  const session = await auth();
  return (
    <header className="flex items-center justify-between border-b px-6 py-3 text-sm">
      <Link href="/onboarding" className="font-semibold">Платформа оценки роботизации</Link>
      <nav className="flex items-center gap-4">
        {session?.user ? (
          <>
            <Link href="/analyses" className="underline">Мои расчёты</Link>
            <span className="text-muted-foreground">{session.user.email}</span>
            <form action={logoutAction}>
              <button type="submit" className="underline">Выйти</button>
            </form>
          </>
        ) : (
          <>
            <Link href="/login" className="underline">Войти</Link>
            <Link href="/signup" className="underline">Регистрация</Link>
          </>
        )}
      </nav>
    </header>
  );
}
```

- [ ] **Step 5: Render the header in `app/layout.tsx`**

Add the import at the top: `import { SiteHeader } from "@/components/site-header";`
Change the `<body>` to render the header above `children`:
```tsx
      <body className="min-h-full flex flex-col">
        <SiteHeader />
        <main className="flex-1">{children}</main>
      </body>
```

- [ ] **Step 6: Verify build + anonymous access**

```bash
npm run build
(npm run dev > /tmp/rrp-w4-t4.log 2>&1 &) ; sleep 8
curl -s -o /dev/null -w "login: %{http_code}\n" http://localhost:3000/login
curl -s -o /dev/null -w "signup: %{http_code}\n" http://localhost:3000/signup
curl -s -o /dev/null -w "onboarding(anon): %{http_code}\n" http://localhost:3000/onboarding
curl -s http://localhost:3000/onboarding | grep -o "Войти" | head -1   # header shows login when anon
pkill -f "next dev" 2>/dev/null; pkill -f "next-server" 2>/dev/null; true
```
Expected: build exit 0; /login and /signup return 200; /onboarding returns 200 anonymously (UNGATED) and its header shows "Войти".

- [ ] **Step 7: Commit**

```bash
git add "app/(auth)" lib/auth/actions.ts components/site-header.tsx app/layout.tsx
git commit -m "Add signup/login UI + header auth state"
```

---

### Task 5: Saved-analysis queries + save action + save button — TDD (queries)

**Files:**
- Modify: `lib/db/queries.ts`, `lib/db/queries.test.ts`
- Create: `lib/analyses/actions.ts`
- Modify: `components/economics-calculator.tsx`, `app/(app)/calculate/[solutionId]/page.tsx`

**Interfaces:**
- Consumes: `prisma`, `auth`.
- Produces: `createSavedAnalysis(userId, input)`, `getSavedAnalyses(userId)`,
  `getSavedAnalysis(id, userId)` (all `userId`-scoped) in `lib/db/queries.ts`;
  `saveAnalysisAction(input)` server action (`@/lib/analyses/actions`) returning
  `{ ok: true } | { ok: false; reason: "unauthenticated" | "error" }`; the calculator renders a
  "Сохранить расчёт" control. The page passes `solutionId` to the calculator.

- [ ] **Step 1: Add failing query tests to `lib/db/queries.test.ts`**

Append (the file already imports describe/it/expect and `prisma` is available via the queries):
```ts
import { createSavedAnalysis, getSavedAnalyses, getSavedAnalysis } from "./queries";
import { prisma } from "./client";

describe("saved analyses (user-scoped)", () => {
  it("creates and lists a user's analyses, and forbids cross-user reads", async () => {
    const a = await prisma.user.create({
      data: { email: `a-${Date.now()}@test.local`, passwordHash: "x" },
    });
    const b = await prisma.user.create({
      data: { email: `b-${Date.now()}@test.local`, passwordHash: "x" },
    });
    const saved = await createSavedAnalysis(a.id, {
      name: "test", facilityTypeSlug: "warehouse", solutionId: "sol1",
      params: { opsPerDay: 100 }, assumptions: { laborCostPerHourUsd: 15 }, results: { quantity: 2 },
    });
    const listA = await getSavedAnalyses(a.id);
    expect(listA.some((s) => s.id === saved.id)).toBe(true);
    // owner can read
    expect(await getSavedAnalysis(saved.id, a.id)).not.toBeNull();
    // other user cannot
    expect(await getSavedAnalysis(saved.id, b.id)).toBeNull();
    expect(await getSavedAnalyses(b.id)).toHaveLength(0);

    await prisma.user.deleteMany({ where: { id: { in: [a.id, b.id] } } }); // cascade cleans analyses
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx --yes vitest run lib/db/queries.test.ts < /dev/null`
Expected: FAIL — the three functions are not exported.

- [ ] **Step 3: Implement the queries in `lib/db/queries.ts`**

```ts
export type SavedAnalysisInput = {
  name: string;
  facilityTypeSlug: string;
  solutionId: string;
  params: unknown;
  assumptions: unknown;
  results: unknown;
};

export async function createSavedAnalysis(userId: string, input: SavedAnalysisInput) {
  return prisma.savedAnalysis.create({
    data: {
      userId,
      name: input.name,
      facilityTypeSlug: input.facilityTypeSlug,
      solutionId: input.solutionId,
      params: input.params as object,
      assumptions: input.assumptions as object,
      results: input.results as object,
    },
  });
}

export async function getSavedAnalyses(userId: string) {
  return prisma.savedAnalysis.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
}

export async function getSavedAnalysis(id: string, userId: string) {
  return prisma.savedAnalysis.findFirst({ where: { id, userId } });
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx --yes vitest run lib/db/queries.test.ts < /dev/null`
Expected: PASS (existing + the new user-scoped test).

- [ ] **Step 5: Create `lib/analyses/actions.ts`**

```ts
"use server";

import { auth } from "@/auth";
import { createSavedAnalysis, type SavedAnalysisInput } from "@/lib/db/queries";

export type SaveResult =
  | { ok: true; id: string }
  | { ok: false; reason: "unauthenticated" | "error" };

export async function saveAnalysisAction(input: SavedAnalysisInput): Promise<SaveResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, reason: "unauthenticated" };
  try {
    const saved = await createSavedAnalysis(session.user.id, input);
    return { ok: true, id: saved.id };
  } catch {
    return { ok: false, reason: "error" };
  }
}
```

- [ ] **Step 6: Pass `solutionId` to the calculator from the page**

In `app/(app)/calculate/[solutionId]/page.tsx`, add `solutionId={solution.id}` to the
`<EconomicsCalculator … />` props (alongside `facilitySlug`).

- [ ] **Step 7: Add the "Сохранить расчёт" control to `components/economics-calculator.tsx`**

Add to the props type: `solutionId: string;` and destructure it. This component already
imports `useState` from `react` (Week 2) — do NOT re-import it. Add only these two imports:
```tsx
import Link from "next/link";
import { saveAnalysisAction } from "@/lib/analyses/actions";
```

Inside the component, add save state + handler:
```tsx
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  async function handleSave() {
    setSaveMsg(null);
    const res = await saveAnalysisAction({
      name: `Расчёт — ${new Date().toLocaleDateString("ru-RU")}`,
      facilityTypeSlug: facilitySlug,
      solutionId,
      params,
      assumptions,
      results: result,
    });
    if (res.ok) setSaveMsg("Сохранено");
    else if (res.reason === "unauthenticated") setSaveMsg("unauth");
    else setSaveMsg("Ошибка сохранения");
  }
```
Render a save button near the results (e.g. after the results Card, inside the grid or below
it):
```tsx
      <div className="md:col-span-2 flex items-center gap-3">
        <button onClick={handleSave}
          className="rounded-md border px-3 py-2 text-sm font-medium">
          Сохранить расчёт
        </button>
        {saveMsg === "unauth" ? (
          <span className="text-sm">
            <Link href="/login" className="underline">Войдите</Link>, чтобы сохранить расчёт
          </span>
        ) : saveMsg ? (
          <span className="text-sm text-muted-foreground">{saveMsg}</span>
        ) : null}
      </div>
```

- [ ] **Step 8: Verify build**

Run: `npm run build`
Expected: exit 0.

- [ ] **Step 9: Commit**

```bash
git add lib/db/queries.ts lib/db/queries.test.ts lib/analyses/actions.ts \
  components/economics-calculator.tsx "app/(app)/calculate"
git commit -m "Add user-scoped saved-analysis queries + save action + save button"
```

---

### Task 6: `/analyses` list + revisit wiring

**Files:**
- Create: `app/(app)/analyses/page.tsx`
- Modify: `app/(app)/calculate/[solutionId]/page.tsx`, `components/economics-calculator.tsx`

**Interfaces:**
- Consumes: `auth`, `getSavedAnalyses`, `getSavedAnalysis`, `assumptionsToValues` (not needed —
  saved assumptions are already full values).
- Produces: route `/analyses`; the calculator accepts optional
  `initialParams?: FacilityParams`; the calculate page seeds params/assumptions from a saved
  analysis when `?analysis=<id>` is present and owned by the session user.

- [ ] **Step 1: Create `app/(app)/analyses/page.tsx` (auth-gated)**

```tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getSavedAnalyses } from "@/lib/db/queries";

export default async function AnalysesPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const analyses = await getSavedAnalyses(session.user.id);
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 py-12">
      <h1 className="text-2xl font-semibold">Мои расчёты</h1>
      {analyses.length === 0 ? (
        <p className="text-sm text-muted-foreground">Пока нет сохранённых расчётов.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {analyses.map((a) => (
            <li key={a.id} className="flex items-center justify-between rounded-md border px-4 py-3 text-sm">
              <span>
                <b>{a.name}</b> · {a.facilityTypeSlug} ·{" "}
                {new Date(a.createdAt).toLocaleDateString("ru-RU")}
              </span>
              <Link href={`/calculate/${a.solutionId}?analysis=${a.id}`} className="underline">
                Открыть
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add optional `initialParams` to `components/economics-calculator.tsx`**

Add `initialParams?: FacilityParams;` to the props type + destructure it. Change the params
`useState` initializer to prefer it:
```tsx
  const [params, setParams] = useState<FacilityParams>(
    initialParams ?? {
      areaM2: 1000,
      opsPerDay: 500,
      staffCount: 10,
      ...(isStock ? { peakConcurrent: 20 } : {}),
    }
  );
```
(Leave `initialAssumptions` as-is; the page passes saved assumptions through it on revisit.)

- [ ] **Step 3: Seed from a saved analysis in the calculate page**

In `app/(app)/calculate/[solutionId]/page.tsx`, accept `searchParams`, load the analysis when
`?analysis=` is present and owned by the user, and override the initial params/assumptions:

```tsx
import { auth } from "@/auth";
import { getSavedAnalysis } from "@/lib/db/queries";
import type { FacilityParams, AssumptionValues } from "@/lib/economics/types";

export default async function CalculatePage({
  params,
  searchParams,
}: {
  params: Promise<{ solutionId: string }>;
  searchParams: Promise<{ analysis?: string }>;
}) {
  const { solutionId } = await params;
  const { analysis: analysisId } = await searchParams;
  const [solution, assumptionRows] = await Promise.all([
    getSolutionForCalc(solutionId),
    getAssumptions(),
  ]);
  if (!solution) notFound();

  let initialAssumptions = assumptionsToValues(assumptionRows);
  let initialParams: FacilityParams | undefined;
  if (analysisId) {
    const session = await auth();
    if (session?.user?.id) {
      const saved = await getSavedAnalysis(analysisId, session.user.id);
      if (saved && saved.solutionId === solutionId) {
        initialParams = saved.params as FacilityParams;
        initialAssumptions = saved.assumptions as AssumptionValues;
      }
    }
  }
  // …pass initialParams={initialParams} to <EconomicsCalculator/> alongside the existing props.
```
Add `initialParams={initialParams}` to the `<EconomicsCalculator … />` element. Keep the
existing `capacity`/`capacityUnit`/`initialAssumptions`/`facilitySlug`/`solutionId` props.
(An unauthenticated visitor, or one who doesn't own the analysis, silently gets the default
calculator — no error, no data leak.)

- [ ] **Step 4: Verify build + e2e**

```bash
npm run build
(npm run dev > /tmp/rrp-w4-t6.log 2>&1 &) ; sleep 8
curl -s -o /dev/null -w "analyses(anon)->redirect: %{http_code}\n" http://localhost:3000/analyses
# a calculate page with a bogus analysis id still renders (silently ignores it) for anon:
SID=$(curl -s http://localhost:3000/compare/warehouse | grep -oE '/calculate/[a-z0-9]+' | head -1 | cut -d/ -f3)
curl -s -o /dev/null -w "calculate?analysis=bogus (anon): %{http_code}\n" "http://localhost:3000/calculate/$SID?analysis=bogus"
pkill -f "next dev" 2>/dev/null; pkill -f "next-server" 2>/dev/null; true
```
Expected: `/analyses` anonymously returns a redirect (307) to `/login`; the calculate page with
a bogus/unowned `?analysis=` still returns 200 (falls back to defaults, no leak/crash).

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/analyses" "app/(app)/calculate" components/economics-calculator.tsx
git commit -m "Add /analyses list + revisit-from-saved-analysis wiring"
```

---

### Task 7: Deploy-ready config + runbook

**Files:**
- Modify: `next.config.ts`, `.env.example`
- Create: `Dockerfile`, `.dockerignore`, `docs/DEPLOY.md`

**Interfaces:**
- Produces: standalone build output; a Dockerfile that builds the app; a deploy runbook.

- [ ] **Step 1: Enable standalone output in `next.config.ts`**

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
};

export default nextConfig;
```

- [ ] **Step 2: Create `.dockerignore`**

```
node_modules
.next
.git
.env
npm-debug.log
Dockerfile
.dockerignore
```

- [ ] **Step 3: Create `Dockerfile` (multi-stage, non-root, prisma generate before build)**

```dockerfile
# syntax=docker/dockerfile:1
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S app && adduser -S app -G app
COPY --from=build /app/public ./public
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
USER app
EXPOSE 3000
CMD ["node", "server.js"]
```

- [ ] **Step 4: Create `docs/DEPLOY.md`**

````markdown
# Deployment Runbook

The app is deploy-ready. Steps marked **[needs your account]** require your own
Postgres/hosting credentials and are not automatable.

## 1. Provision a managed Postgres  **[needs your account]**
Use Neon or Vercel Postgres. Copy the **pooled** connection string.

## 2. Environment variables
Set on the host (Vercel project settings, or the Docker runtime):
- `DATABASE_URL` — the pooled Postgres URL from step 1.
- `AUTH_SECRET` — generate once: `openssl rand -base64 32`.
- `AUTH_URL` — your production URL (e.g. `https://example.com`) if not auto-detected.

## 3. Migrate + seed (once, against the managed DB)
```bash
DATABASE_URL="<pooled url>" npx prisma migrate deploy
DATABASE_URL="<pooled url>" npm run db:seed
```

## 4a. Deploy on Vercel  **[needs your account]**
Connect the GitHub repo, set the env vars from step 2, deploy. The build runs
`prisma generate` (via the build) automatically.

## 4b. Or deploy with Docker
```bash
docker build -t rrp .
docker run -p 3000:3000 -e DATABASE_URL="<pooled url>" -e AUTH_SECRET="<secret>" rrp
```

## Notes
- The Prisma pg driver adapter (`lib/db/client.ts`) uses a connection pool — use a **pooled**
  `DATABASE_URL` in serverless environments.
- Local dev DB stays on host port 5433 (docker-compose); production uses the managed DB.
````

- [ ] **Step 5: Verify the standalone build**

Run: `npm run build`
Expected: exit 0; output notes a `.next/standalone` folder was produced.

- [ ] **Step 6: Commit**

```bash
git add next.config.ts .dockerignore Dockerfile docs/DEPLOY.md
git commit -m "Add deploy-ready config (standalone, Dockerfile) + DEPLOY runbook"
```

---

### Task 8: Security review + CHANGELOG

**Files:**
- Modify: `CHANGELOG.md`
- (No code unless the security review surfaces a fix.)

**Interfaces:**
- Produces: a documented security pass + the Week 4 changelog entry.

- [ ] **Step 1: Run the security-review skill on the branch diff**

Invoke the `security-review` skill against the Week 4 changes (auth, password handling, saved
analyses, env). Focus areas: password hashing (never plaintext/logged), `AUTH_SECRET` not
committed, `SavedAnalysis` reads always `userId`-filtered (no IDOR), signup input validation +
email normalization, generic login errors, no Prisma/secret in edge/middleware.

- [ ] **Step 2: Address any Critical/High finding**

If the review finds a Critical or High issue, fix it (and re-run the covering check). Record
Medium/Low findings in the report; fix only what's warranted before merge.

- [ ] **Step 3: Update `CHANGELOG.md`**

Under `## [Unreleased]` → `### Added`, append (match the existing style):
```
- Accounts (Auth.js v5 credentials, bcrypt-hashed passwords, JWT sessions): signup/login,
  header auth state, logout. Anonymous users can still use Steps 1-4; login is required only
  to save. [Week 4]
- Save & revisit: a logged-in user can save a completed analysis and reopen it from "Мои
  расчёты" (`/analyses`); saved analyses are strictly user-scoped. [Week 4]
- Deploy-ready config: `output: "standalone"`, multi-stage `Dockerfile`, `.dockerignore`, and
  a `docs/DEPLOY.md` runbook (managed Postgres + env vars + migrate/seed + Vercel/Docker). [Week 4]
```

- [ ] **Step 4: Commit**

```bash
git add CHANGELOG.md
git commit -m "Security review pass + Week 4 changelog"
```

---

## Definition of done

- [ ] `npm run build` succeeds with `output: "standalone"`.
- [ ] With DB up + seeded, `npx --yes vitest run < /dev/null` passes all tests (prior 38 + 3
  password + 1 saved-analysis user-scoping = 42; exact count may vary with grouping).
- [ ] Anonymous: `/onboarding`, `/compare/[type]`, `/calculate/[id]` all work with no login;
  the header shows "Войти"/"Регистрация".
- [ ] Auth: sign up → logged in (header shows email + "Выйти"); log out; log back in.
- [ ] Save/revisit: logged-in user saves an analysis, sees it under "Мои расчёты", and
  reopening it reloads the calculator with the saved params/assumptions; the numbers match.
- [ ] A user cannot read another user's saved analysis (verified by the Task 5 test + the
  security review); `/analyses` redirects anonymous users to `/login`.
- [ ] `AUTH_SECRET` is NOT committed; `.env.example` has only the placeholder.
- [ ] `security-review` found no unaddressed Critical/High issue.
- [ ] Each task committed individually; `docs/DEPLOY.md` documents the user-only steps.
