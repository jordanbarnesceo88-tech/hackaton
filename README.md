# Robotization ROI Platform

Web platform helping companies evaluate robotization investments: browse/compare
available robotic solutions for their facility type, calculate OPEX/CAPEX/payback/ROI,
and see a visualization of robots operating on their site.

## Tests & CI

The DB must be up and seeded first: `docker compose up -d` then `npm run db:seed`.

- `npm test` — unit/integration tests (Vitest), against the local Postgres.
- `npm run test:e2e` — end-to-end tests (Playwright, Chromium) over the full 6-step flow
  (facility type → params → staffing → solutions → compare → calculator) incl.
  signup → save → report. The Playwright config builds and starts the app automatically
  (`next build && next start`); run `npx playwright install chromium` once beforehand.
- `.github/workflows/ci.yml` runs unit + E2E (with a Postgres service) on every push/PR — it
  activates automatically **once this repo is pushed to a GitHub remote**; until then run the
  commands above locally.

## Docs

Start here if you're auditing the product rather than the code:

- [docs/audit/2026-09-14-audit.html](./docs/audit/2026-09-14-audit.html) — the current
  logic/design audit, dated 2026-09-14 — the most recent independent look at the app.
- [docs/BACKLOG.md](./docs/BACKLOG.md) — the real status document: what's fixed, what's
  open, and what still needs an owner's sign-off. Rewritten 2026-09-13 after a prior
  edition went stale; every "done" item is annotated with how it was verified.
- [docs/data-provenance.md](./docs/data-provenance.md) — the source behind every external
  number in the model (labor rates, regional presets, equipment prices, throughput
  benchmarks) — what's cited, what's estimated, and why.
- [docs/AUDIT.md](./docs/AUDIT.md) — the original audit, 2026-08-24. **Closed** — it now
  carries a banner stating that 17 of 19 findings are resolved and pointing at the
  2026-09-14 audit above; read as history, not as a list of current defects.
- [docs/CAPABILITY-ANALYSIS.md](./docs/CAPABILITY-ANALYSIS.md) — what the economics model
  deliberately does not attempt, and why.
- [docs/design/PROTOTYPE-DESIGN-SYSTEM.md](./docs/design/PROTOTYPE-DESIGN-SYSTEM.md) — a
  design system extracted from the current prototype UI. Documented, **not yet applied**
  to the app.
- In-product prose, not files: [`/methodology`](./app/methodology) explains "where the
  numbers come from," including a live citation-freshness audit computed on request, not
  frozen at deploy time; [`/glossary`](./app/glossary) defines the 22 domain/finance terms
  the app uses (AS/RS, AMR, NPV, discounted payback, coverage, labor displacement, …).
- [CHANGELOG.md](./CHANGELOG.md) — running log of all changes made during development,
  including every commit that changed an output number.

Deploy & ops — current, actively maintained:

- [docs/DEPLOY-QUICKSTART.md](./docs/DEPLOY-QUICKSTART.md) — the ordered path to a public
  URL (GitHub → Neon → Vercel), with the Netlify caveat and what to smoke-test.
- [docs/DEPLOY.md](./docs/DEPLOY.md) — full runbook: security posture, rate limiting, the
  assessed `npm audit` findings, and the slug-keyed seed/prune/preflight procedure.
- [docs/00-idea-brief.md](./docs/00-idea-brief.md) — original task/idea; fixed at the
  outset per its own note, and still an accurate statement of the brief.

Historical — describe an earlier shape of the product; kept for the record rather than
deleted, in the same spirit as the closed-audit banner above:

- [docs/01-prd.md](./docs/01-prd.md) — original product requirements. Documents a
  `Session` entity that was never built (state lives in the URL instead) and a 4-step
  flow; the app now has 6 steps (facility type → params → **staffing** → solutions →
  compare → calculator).
- [docs/02-execution-plan.md](./docs/02-execution-plan.md) — original tech/architecture
  plan. §4's economics formulas have since been superseded twice (task-based staffing
  replaced a global labor-output divisor; three financial contradictions in
  payback/ROI/NPV were fixed) — read `docs/BACKLOG.md` and `CHANGELOG.md` for what the
  engine actually computes today.
