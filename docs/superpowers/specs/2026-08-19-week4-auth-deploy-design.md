# Week 4 Design — Auth + Save/Revisit + Deploy-Ready

> Status: approved via brainstorming 2026-08-19. Idea fixed. Builds on Weeks 1-3 (merged to
> master; full 4-step flow live but stateless). Related: [PRD](../../01-prd.md) (accounts are
> an MVP requirement), [execution plan §6 + §8 I8](../../02-execution-plan.md), installed
> skills `nextauth-authentication`, `deployment-patterns`, `docker-patterns`.

## Goal

Add user accounts and let a logged-in user save a completed analysis and revisit it later,
without gating the anonymous demo flow; and make the app deploy-ready (config only — the
actual provisioning/deploy is a guided handoff, see §8).

## Decisions locked in brainstorming

- **1a — Credentials auth** (email + password), Auth.js v5 + JWT sessions. Self-contained:
  no external OAuth provider, no third-party secrets beyond a generated `AUTH_SECRET`.
- **2a — Anonymous use stays open.** Steps 1-4 need no account. Login is required ONLY to
  save an analysis and view "Мои расчёты".
- **3a — Deploy-ready config only** (no live deploy this session). Actual DB provisioning +
  Vercel deploy is a guided handoff (needs the user's accounts).

## Autonomy boundary (explicit)

- **Built + reviewed + merged locally (this week):** schema + migration, Auth.js v5 config,
  signup/login UI, save/revisit, auth-gating, deploy config + runbook.
- **User-only (I prepare + guide, cannot do autonomously):** provisioning managed Postgres
  (Neon/Vercel Postgres), the Vercel deploy itself, real production secrets.

## 1. Schema (one migration)

```prisma
model User {
  id             String          @id @default(cuid())
  email          String          @unique
  passwordHash   String
  name           String?
  createdAt      DateTime        @default(now())
  savedAnalyses  SavedAnalysis[]
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

With credentials + JWT sessions we do NOT need Auth.js adapter tables (Account / Session /
VerificationToken) — the auth session lives in a signed cookie; we own the `User` table. The
`SavedAnalysis.results` is a snapshot of the computed `EconomicsResult` at save time (so a
revisited analysis shows what the user saw, even if assumptions defaults later change).

## 2. Auth (Auth.js v5, `next-auth@beta`)

- `npm install next-auth@beta bcryptjs` (+ `@types/bcryptjs` dev). bcryptjs is pure-JS (no
  native build), portable across local + serverless.
- `lib/auth/password.ts`: `hashPassword(plain): Promise<string>` and
  `verifyPassword(plain, hash): Promise<boolean>` (bcryptjs, cost 10). Unit-tested (roundtrip
  + wrong-password reject).
- `auth.ts` (repo root or `lib/auth/`): Auth.js v5 config exporting `{ handlers, auth,
  signIn, signOut }`. One `Credentials` provider whose `authorize({ email, password })` loads
  the user via Prisma and calls `verifyPassword`; returns `{ id, email, name }` or null.
  `session: { strategy: "jwt" }`. `pages: { signIn: "/login" }`.
- `app/api/auth/[...nextauth]/route.ts`: `export const { GET, POST } = handlers`.
- `AUTH_SECRET` in `.env` (generated `openssl rand -base64 32`); `.env.example` gets a
  placeholder + the generate hint. `.env` stays gitignored (Week 1 rule).
- **Prisma-7 note:** Auth.js `authorize` runs the Prisma driver-adapter client
  (`lib/db/client.ts`) — server-only. Do NOT import the Prisma client into edge middleware;
  keep session checks in server components / route handlers / server actions using `auth()`.

## 3. Signup / login UI (Russian)

- `/signup` (`app/(auth)/signup/page.tsx`): a form → a server action `signUp(formData)` that
  validates (email format, password length ≥ 8), checks email not taken, hashes, creates the
  `User`, then signs them in. Friendly Russian errors ("Пользователь уже существует", etc.).
- `/login` (`app/(auth)/login/page.tsx`): a form calling `signIn("credentials", …)`; on
  failure shows "Неверный email или пароль".
- A header/nav element showing the logged-in email + "Выйти" (calls `signOut`), or "Войти" /
  "Регистрация" links when anonymous. Rendered from the layout via `auth()` (server).

## 4. Save / revisit (login-gated only; anonymous flow untouched)

- **Save:** a "Сохранить расчёт" button in `components/economics-calculator.tsx` (client)
  calls a server action `saveAnalysis({ facilityTypeSlug, solutionId, params, assumptions,
  results, name })`. The action calls `auth()`; if no session → return an "нужно войти"
  outcome (the button links to `/login`). If authed → `createSavedAnalysis(userId, …)`. The
  button's `name` defaults to e.g. "{solution.name} — {date}"; editable.
- **List:** `/analyses` (`app/(app)/analyses/page.tsx`): server component; `auth()` →
  redirect to `/login` if anonymous; otherwise `getSavedAnalyses(userId)` (own only) and
  render a list with name/date/facility and a "Открыть" link.
- **Revisit:** each item links to `/calculate/[solutionId]?analysis=<id>`. The calculate page
  reads the `analysis` query param, loads that `SavedAnalysis` **checking it belongs to the
  session user**, and passes its `params`/`assumptions` as the calculator's initial state
  (the calculator gains optional `initialParams`/`initialAssumptions` props, defaulting to
  today's defaults when absent). No `analysis` param → behaves exactly as now.
- **Data-access (`lib/db/queries.ts`):** `createSavedAnalysis(userId, input)`,
  `getSavedAnalyses(userId)`, `getSavedAnalysis(id, userId)` — the last two ALWAYS filter by
  `userId` so one user can never read another's analysis.

## 5. Deploy-ready config (autonomous; no live deploy)

- `next.config.ts`: add `output: "standalone"` (for a slim Docker image).
- `Dockerfile`: multi-stage (deps → build → runner) per docker-patterns; runs
  `npx prisma generate` before `next build`; copies the standalone output; runs as a non-root
  user; `EXPOSE 3000`.
- `.dockerignore` (node_modules, .next, .git, .env).
- Confirm/keep the Prisma pg driver adapter using a pooled connection (`PrismaPg({
  connectionString })` over `pg` Pool) — already serverless-appropriate; DEPLOY.md notes the
  prod `DATABASE_URL` should be a pooled/connection-pooler URL.
- `docs/DEPLOY.md` runbook: (1) provision managed Postgres (Neon or Vercel Postgres); (2) set
  env `DATABASE_URL` (pooled) + `AUTH_SECRET` (+ `AUTH_URL` if needed); (3) `prisma migrate
  deploy` then `npm run db:seed`; (4) deploy (Vercel: connect repo + env vars; or `docker
  build`/run). Clearly marks the steps that need the user's accounts.
- `.env.example`: add `AUTH_SECRET=` (with the generate hint).

## 6. Security (auth — reviewed hard; security-review skill run before merge)

- Passwords hashed with bcryptjs (cost 10); never stored/logged in plaintext.
- `AUTH_SECRET` never committed; `.env` gitignored; `.env.example` holds only a placeholder.
- Every save/list/revisit path validates the session server-side (`auth()`), and every
  `SavedAnalysis` read is filtered by the session `userId` — no IDOR / cross-user access.
- Signup validates input (email format, password length) and normalizes email
  (lowercase/trim) before uniqueness check + storage.
- Generic auth errors (don't reveal whether an email exists on login failure).
- The `security-review` skill runs on the final diff before merge.

## 7. Build order (≈8 tasks)

1. Auth deps + `User`/`SavedAnalysis` schema + migration + generate.
2. `lib/auth/password.ts` (hash/verify) + unit tests.
3. Auth.js v5 config (`auth.ts` + Credentials `authorize` + route handler) + `AUTH_SECRET`.
4. Signup (server action + create user) + `/signup` + `/login` UI + header auth state.
5. Save-analysis: `createSavedAnalysis`/`getSavedAnalyses`/`getSavedAnalysis` queries (+ tests)
   + `saveAnalysis` server action + "Сохранить" button in the calculator.
6. `/analyses` list page + revisit wiring (calculator `initialParams`/`initialAssumptions`;
   calculate page reads `?analysis=` ownership-checked).
7. Deploy-ready config (Dockerfile, `.dockerignore`, `output: standalone`, `prisma generate`
   in build, `.env.example`) + `docs/DEPLOY.md`.
8. `security-review` pass on the whole branch + CHANGELOG Week 4 entry.

(Tasks 1-2 foundational; 3-4 auth; 5-6 save/revisit; 7 deploy config; 8 security + changelog.)

## Success criteria

- Anonymous users can still complete Steps 1-4 with no account (nothing gated except save/analyses).
- A user can sign up, log in, see their email + "Выйти" in the header, and log out.
- A logged-in user can save the current analysis and see it under "Мои расчёты"; opening it
  reloads `/calculate/[id]` with the saved params/assumptions applied; the numbers match.
- A user cannot read another user's saved analysis (server-side `userId` filtering; verified).
- Passwords are bcrypt-hashed; `AUTH_SECRET` is not committed; `security-review` finds no
  Critical/High issue (or they're fixed).
- `npm run build` succeeds with `output: standalone`; the Dockerfile builds; `DEPLOY.md`
  documents the provisioning/deploy steps that need the user.

## Risks

- Auth.js v5 + Next 16 + Prisma-7 driver-adapter interactions (edge vs node) → keep all
  Prisma/session logic server-side (node runtime), no Prisma in middleware; validated in the
  auth task.
- Credentials + JWT has no server-side session revocation → acceptable for a demo; noted.
- Deploy config can't be fully validated without a real deploy → Dockerfile build is verified
  locally; the live deploy is the user's guided step.
