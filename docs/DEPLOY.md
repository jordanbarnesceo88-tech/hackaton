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

## 5. Security hardening before real production traffic  **[required before public launch]**
The auth code is correct for the current stage (bcrypt passwords, JWT sessions, strictly
user-scoped saved analyses — no cross-user access), but a few hardening steps are deliberately
deferred to deploy time because they need production infrastructure or config:
- **Rate-limit login & signup.** DONE — a DB-backed fixed-window limiter (`lib/auth/rate-limit.ts`,
  `RateLimit` table) throttles signup (5 / IP / 15 min, in `lib/auth/actions.ts`) and login
  (10 / email+IP / 15 min, in `auth.ts`'s `authorize`). Because it's Postgres-backed it works on
  both a single Docker instance and serverless/multi-instance — no Upstash/Redis needed. A per-IP
  login cap (50 / 15 min) backstops the per-account cap against password-spray. IP is read from
  `X-Forwarded-For`. **Your proxy MUST overwrite (not append) the inbound `X-Forwarded-For`** —
  else a client can spoof the leftmost hop and rotate it to bypass the limiter. Vercel handles
  this; nginx: use `proxy_set_header X-Forwarded-For $remote_addr;` (overwrite), NOT
  `$proxy_add_x_forwarded_for` (append); Cloudflare/most CDNs overwrite by default. The limiter
  fails open on a DB error (never locks users out on an infra hiccup). **Prune old rows** on a
  schedule (one row per key accumulates; login attempts with random emails/IPs can add many):
  `DELETE FROM "RateLimit" WHERE "windowStart" < now() - interval '1 day'` via a daily cron.
- **Security headers.** DONE — `next.config.ts` `headers()` sets CSP, HSTS, X-Frame-Options,
  X-Content-Type-Options, and Referrer-Policy on all routes (audit SEC1). The CSP still allows
  `'unsafe-inline'` scripts for Next's inline hydration bootstrap; tighten to nonce-based CSP
  when convenient.
- **(Optional) Email verification** on signup, if any future feature (password reset,
  notifications) will trust email ownership. Not needed for the current feature set.

## Notes
- The Prisma pg driver adapter (`lib/db/client.ts`) uses a connection pool — use a **pooled**
  `DATABASE_URL` in serverless environments.
- Local dev DB stays on host port 5433 (docker-compose); production uses the managed DB.
