# Robotization ROI Platform

Web platform helping companies evaluate robotization investments: browse/compare
available robotic solutions for their facility type, calculate OPEX/CAPEX/payback/ROI,
and see a visualization of robots operating on their site.

## Tests & CI

The DB must be up and seeded first: `docker compose up -d` then `npm run db:seed`.

- `npm test` — unit/integration tests (Vitest), against the local Postgres.
- `npm run test:e2e` — end-to-end tests (Playwright, Chromium) over the full 4-step flow
  incl. signup → save → report. The Playwright config builds and starts the app automatically
  (`next build && next start`); run `npx playwright install chromium` once beforehand.
- `.github/workflows/ci.yml` runs unit + E2E (with a Postgres service) on every push/PR — it
  activates automatically **once this repo is pushed to a GitHub remote**; until then run the
  commands above locally.

## Docs

- [docs/00-idea-brief.md](./docs/00-idea-brief.md) — original task/idea (fixed)
- [docs/01-prd.md](./docs/01-prd.md) — product requirements
- [docs/02-execution-plan.md](./docs/02-execution-plan.md) — tech stack, architecture, build order
- [docs/DEPLOY-QUICKSTART.md](./docs/DEPLOY-QUICKSTART.md) — the ordered path to a public URL
  (GitHub → Neon → Vercel), with the Netlify caveat and what to smoke-test
- [docs/DEPLOY.md](./docs/DEPLOY.md) — full runbook: security posture, rate limiting, the
  assessed `npm audit` findings
- [CHANGELOG.md](./CHANGELOG.md) — running log of all changes made during development
