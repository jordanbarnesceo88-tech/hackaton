# Logic & Design Audit — Robotization ROI Platform

> Phase A deliverable. **Read-only**: no code was changed to produce this. Reviewed at HIGH
> effort with a correctness + "defensible economic model" lens, per the audit brief.
> Reviewer: Opus 4.8, 2026-08-24. Branch reviewed: `master` @ `b0ce454`.
>
> The bar applied throughout is the one the idea brief sets for itself
> ([00-idea-brief.md](./00-idea-brief.md)): a **credible, independent ROI estimate a
> skeptical client would trust** — not merely "builds and tests pass". Both of those are
> true today; this document is about whether the *numbers* survive scrutiny.

---

## Executive summary

The engineering is clean and the known-defect backlog from execution-plan §8 has largely
been **closed** (C1, C2, I1, I7 fully; M2 mostly). Edge-case guarding at the UI layer is
genuinely good. The tests are meaningful, not decorative.

**But the product's headline promise — a defensible ROI number — is undermined by the
economic model itself, not by bugs.** In the codebase's *own* worked example
([calculate.test.ts:31](../lib/economics/calculate.test.ts)) one $57.5k robot yields
**$201k/yr savings, ~3.5-month payback, 1648% ROI**. Those numbers are arithmetically
correct and would be laughed out of the room by the exact skeptical buyer this tool exists
to win over. The root cause is structural (A1–A3 below): savings is a function of the
client's *entire* declared headcount and is completely decoupled from how much work the
robots actually do.

Second-order, the one screen that carries the brief's *other* headline value — independent
**comparison** — doesn't actually compare (P1), and a visible input field (`area`) changes
nothing in the result (U1). Both quietly erode the credibility pitch.

None of this blocks a demo. All of it is fixable, and most fixes are small. Priorities for
Phase B, in order: **A1 → A2 → P1 → U1 → A3**, then the Medium cluster.

### Severity tally

| Severity | Count | IDs |
|---|---|---|
| Critical | 1 | A1 |
| High | 4 | A2, A3, P1, U1 |
| Medium | 6 | E1, I6, S1, D1, SEC1, P2 |
| Low | 6 | E2, T1, V1, T2, U2, I8 |

---

## Zone 1 — Economics correctness & model soundness (`lib/economics`)

### 🔴 A1 (Critical) — Labor savings is decoupled from the robots' actual workload
**Where:** [`calculate.ts:16-23`](../lib/economics/calculate.ts)
```
baselineAnnualUsd = staffCount * laborCostPerHourUsd * hoursPerYear
annualSavingsUsd  = baselineAnnualUsd * laborReplacementPct - opexAnnualUsd
```
**Why it's wrong (as a *model*, not as code):** `annualSavings` depends only on
`staffCount` and `laborReplacementPct`. It has **no term for how much of the facility's work
the purchased fleet performs.** `quantity`, `capacityPerUnit`, `opsPerDay` influence CAPEX
and OPEX but never the labor benefit. Consequences a skeptical client will spot immediately:
- A facility that declares `staffCount = 100` but `opsPerDay = 1` still "saves" 70% of 100
  salaries by buying the minimum **one** robot that does 1 op/day.
- Two facilities with identical staff but 10× different operation volumes report **identical
  labor savings** while paying different CAPEX — i.e. buying *more* robots never buys *more*
  savings.
- The engine's own example: 1 robot → $201k/yr, 1648% ROI, ~3.5-month payback.

This is the single biggest threat to the product's purpose. §8's I2 fix *intended*
`min(1, deployedCapacity ÷ demand)` to couple the two, but that term was **not implemented**
(and would be inert anyway, because `quantity = ceil(demand/capacity)` always over-provisions
so the ratio is ≥ 1). The missing coupling is the *reverse*: savings should scale **down**
when the fleet only covers a slice of the work a human org actually does.

**Recommendation (model change — needs sign-off, alters output numbers):** make displaced
labor a function of automatable workload, not raw headcount. Concretely, introduce an
explicit *automatable-labor* basis so the benefit is tied to throughput the robots take over,
e.g.:
`laborSaved = min(staffCount, ceil(demandCovered / opsPerWorkerPerYear)) * laborReplacementPct * annualLaborCost`,
or at minimum require the user to enter **"staff displaced by this solution"** rather than
total headcount, and label it unambiguously. Add tests pinning the new coupling. Update
execution-plan §8 / the Week-2 spec when the model changes.

### 🟠 A2 (High) — Default assumptions are optimistic-by-construction and compound A1
**Where:** [`assumptions.ts:3-12`](../lib/economics/assumptions.ts), [`calculate.ts:19-23`](../lib/economics/calculate.ts)
- `laborReplacementPct: 0.7` as a **default** asserts robots eliminate 70% of *all* declared
  labor cost out of the box. That is an aggressive claim to ship as the neutral baseline.
- **No baseline OPEX is retained.** The model assumes the pre-robot state has *zero* running
  cost other than the labor it removes, and the post-robot state adds no human supervision,
  no facilities/space, no integration-team overhead. Real automation keeps a residual
  supervision/exception-handling crew. §8 I2 called for "optionally subtract a baseline-OPEX
  assumption" — not done.
- Net effect stacks on A1: high replacement % × full headcount × no residual cost = the
  1600%+ ROI figures.

**Recommendation:** lower the shipped default (e.g. 0.4–0.5) and frame it as conservative;
add an editable `residualSupervisionPct` or `baselineOpexUsdYear` that the savings formula
subtracts. Surface both in the assumptions panel so the optimism is visible and defensible,
which is exactly the "show our assumptions openly" credibility lever the plan (§4) promised.

### 🟠 A3 (High) — ROI/payback are undiscounted and ignore the asset lifecycle
**Where:** [`calculate.ts:37-39`](../lib/economics/calculate.ts)
```
paybackYears = capexUsd / annualSavingsUsd
roiPct = ((annualSavingsUsd * roiHorizonYears - capexUsd) / capexUsd) * 100
```
**Why it's weak:** the multi-year ROI is a simple undiscounted sum — no discount rate / NPV,
no cost of capital. §8 M2 flagged the `discount rate` assumption as declared-but-unused; the
resolution was to **drop it entirely** rather than implement discounting, so the horizon
return is systematically overstated for any realistic cost of capital. Separately, the model
assumes robots run the full `roiHorizonYears` (default 5) on maintenance alone — **no
depreciation, no mid-horizon replacement CAPEX, no residual value.** A 5-year ROI on hardware
with a <5-year service life is not defensible.

**Recommendation:** either (a) re-introduce a `discountRate` assumption and report
**discounted payback + NPV/IRR** alongside the simple figures, or (b) if you deliberately
keep it simple for the demo, **label the outputs "simple/undiscounted"** so you're not
implicitly claiming a discounted return. Add an asset-life assumption and amortize/replace
CAPEX across the horizon if life < horizon.

### Notes on what §8 got *right* (verified closed)
- **C1 (capacity normalization): CLOSED.** `capacityBasis` enum exists
  ([types.ts:1](../lib/economics/types.ts), [schema.prisma:48](../prisma/schema.prisma));
  [`normalize.ts`](../lib/economics/normalize.ts) annualizes both sides to a common basis and
  uses a distinct peak/concurrency rule for `CONCURRENT_STOCK`. Units are consistent
  end-to-end (per-hour → ×operatingHoursPerDay×workingDays; per-day → ×workingDays). Good.
- **C2 (savings ≤ 0 guard): CLOSED.** Typed `{ economical: false, reason: "no_savings" }`
  ([calculate.ts:33](../lib/economics/calculate.ts)), rendered as "не окупается" in both the
  calculator and the visualization. Tested (savings = 0 / < 0).
- **I1 (OPEX × quantity): CLOSED** ([calculate.ts:19-21](../lib/economics/calculate.ts)),
  tested.
- **M2 (ceil / hoursPerYear): CLOSED** — `Math.ceil` in `computeQuantity`, `hoursPerYear`
  present in assumptions + seed. (discount-rate half → see A3.)

---

## Zone 2 — Assumptions & defaults (seed)

Covered by A2 above for the economics-critical defaults. Additional observations:

- **Which assumptions drive the result most:** in order — `laborReplacementPct`,
  `laborCostPerHourUsd`, `hoursPerYear`, `staffCount` (all four feed the labor term that
  dominates). `installPctOfCapex`, `turnoverPerDay`, `roiHorizonYears` are second-order. A
  client sensitivity view would make this honest; today nothing signals that ~4 numbers
  swing the whole result.
- **Missing assumptions a real model needs:** regional labor cost (the single `15 USD/hr`
  global constant is not credible across РФ regions/sectors), energy price (energy cost is
  baked into each solution as a flat `energyUsdYear` rather than kWh × tariff), residual
  supervision labor, discount rate, asset life. See A2/A3.
- **Dual time-base coherence (T1, Low):** baseline labor uses `hoursPerYear = 2000`
  (one FTE-year), while facility uptime is `operatingHoursPerDay × workingDaysPerYear =
  16 × 250 = 4000` h/yr (two shifts). The math is internally consistent *if* `staffCount` is
  total headcount across shifts — but the UI label "Численность персонала" doesn't say that,
  so a user entering per-shift staff will halve the (already inflated) baseline. Clarify the
  label.

---

## Zone 3 — Edge cases & numeric safety

### 🟡 E1 (Medium) — Engine returns `Infinity`/`NaN` for zero-valued divisors; only the UI masks it
**Where:** [`normalize.ts:26`](../lib/economics/normalize.ts) (`opsPerDay / turnoverPerDay`),
[`calculate.ts:38-39`](../lib/economics/calculate.ts) (`/ capexUsd`).
- `turnoverPerDay = 0` (editable assumption) on a `CONCURRENT_STOCK` solution →
  `ceil(opsPerDay/0) = Infinity` → `quantity = Infinity` → `capex = Infinity`.
- `priceUsd = 0` (plausible with bad/real import data) → `capexUsd = 0` → `roiPct =
  (…)/0 = Infinity`, `paybackYears = 0`.

The **calculator** and **visualization** guard these at the presentation layer
([economics-calculator.tsx:113-119](../components/economics-calculator.tsx) requires
`capexUsd > 0` and finiteness; [facility-visualization.tsx:46](../components/facility-visualization.tsx)
falls back to 1). So the live demo won't show `∞`. **But the engine itself is unsound** — any
other consumer (the persisted `results` jsonb, a future API/export, the comparison screen)
receives `Infinity`/`NaN`. This is on the REFACTORING fast-follow list ("engine-side guard for
zero-valued assumption divisors").

**Recommendation:** guard inside the pure engine — treat non-positive `turnoverPerDay` and
non-positive `capexUsd` as a typed non-result (reuse the `economical: false` channel or add a
`reason: "invalid_inputs"`). Move the truth from the UI into `lib/economics` and unit-test it.

- **Negatives:** number inputs set `min={0}` but don't hard-clamp; a pasted negative
  `staffCount` yields negative baseline → negative savings → correctly falls into
  `no_savings`. Acceptable, but consider clamping at the engine boundary for defensiveness.
- **Divide-by-zero on capacity:** correctly thrown ([normalize.ts:20](../lib/economics/normalize.ts)),
  tested. Good.

---

## Zone 4 — Visualization fidelity (`lib/scene` + facility-visualization)

Overall **honest**: numbers come straight from the engine, motion is illustrative, and the
"ROI accrued" bar was correctly relabeled to **"Накопленная экономия (за год)"** (savings, not
ROI) — the §5 honesty line holds. I7 bounds are enforced (`MAX_RENDERED = 24`, overflow badge,
6×6 grid clamp, ≥1 robot). `utilizationPct` clamps to (0,100] and, because `quantity`
over-provisions, always reads ≤100% — consistent with the sizing rule.

Findings:
- **V1 (Low) — comment/code mismatch:** [facility-visualization.tsx:71](../components/facility-visualization.tsx)
  comments "speed scales mildly with utilization/throughput but stays bounded," but `speed`
  is the hardcoded constant `0.15`. Not misleading to a viewer (motion is decorative), but the
  comment lies about the code. Fix the comment or actually scale speed by utilization.
- **"Производительность" display** (`deployed = quantity × capacityPerUnit`,
  [kpi.ts:13](../lib/scene/kpi.ts)) is shown in the solution's **native basis unit**
  (e.g. per-hour for a PER_HOUR_FLOW solution) with that unit's label — internally honest,
  but note the two KPIs live in different time bases (per-hour "производительность" vs annual
  "загрузка"). Low risk; consider a unit hint.

---

## Zone 5 — Data & seed

### 🟡 D1 (Medium) — Placeholder data will silently mislead when real organizer data lands
**Where:** [`scripts/seed.ts`](../scripts/seed.ts)
- Every vendor is literally "Demo Robotics Co." / "Placeholder Automation LLC" — fine as a
  placeholder, **must not** be in front of a client. All rows are `source: SEED` with **no
  `sourceUrl` / `lastVerified`** — the provenance columns the plan (§3) built for credibility
  are unused, so the tool can't yet *show* where a number came from (its whole reason to
  exist).
- **`capacityBasis` is the load-bearing field on import.** The schema defaults it to
  `PER_DAY_FLOW` ([schema.prisma:63](../prisma/schema.prisma)). If organizer/parsed data omits
  it, a per-*hour* solution silently sizes 16× too small (or a stock solution is treated as
  flow) — a large, **invisible** error with no runtime failure. The import mapping must set
  `capacityBasis` explicitly and reject rows lacking it.
- The "Other / произвольный объект" path resolves to **two fixed generic presets**
  (`generic-mobile`, `generic-fixed`) with **no free-text object description** — §8 M4 asked
  for an optional free-text name so Step 3/4 can echo it back ("tailored to what I entered").
  Still open.

**Recommendation:** add an import validator that requires `capacityBasis`, `sourceUrl`,
`lastVerified` for non-SEED rows; surface provenance in the UI; gate the demo on replacing
`Demo/Placeholder` vendors.

---

## Zone 6 — Auth & security

**IDOR boundary: intact and verified.** Every saved-analysis read is user-scoped —
`getSavedAnalyses(userId)` ([queries.ts:67](../lib/db/queries.ts)) and
`getSavedAnalysis(id, userId)` via `findFirst({ where: { id, userId } })`
([queries.ts:74](../lib/db/queries.ts)); the calculate page additionally checks
`saved.solutionId === solutionId` ([page.tsx:29](<../app/(app)/calculate/[solutionId]/page.tsx>)).
Session integrity is sound (JWT strategy, `id` propagated through jwt→session callbacks,
[auth.ts:24-33](../auth.ts)). Passwords bcrypt-hashed (cost 10), email normalized/validated on
signup, 8-char minimum. No cross-user access path found.

### 🟡 S1 (Medium) — Save action persists unvalidated client input
**Where:** [`analyses/actions.ts:10-18`](../lib/analyses/actions.ts) →
[`queries.ts:53-65`](../lib/db/queries.ts)
`saveAnalysisAction(input)` takes a fully client-controlled `SavedAnalysisInput` and writes it
straight to the DB. `name` is unbounded (stored-blob / DoS vector), `params`/`assumptions`/
`results` are `unknown` → arbitrary jsonb, and `solutionId`/`facilityTypeSlug` are **not
verified to exist**. Authn is enforced but there is **no input validation**. The REFACTORING
doc already lists "zod-validate the saved-analysis payload" as a fast-follow.

**Recommendation:** zod-validate on the server action — cap `name` length, validate the shape
of params/assumptions/results, and verify `solutionId` resolves to a real solution before
persisting.

### 🟡 SEC1 (Medium, known) — Rate-limiting, security headers, email verification deferred
Per [DEPLOY.md §5](./DEPLOY.md): **no throttling** on the credentials callback or signup
(brute-force / credential-stuffing open), **no security headers** (`next.config.ts`
[next.config.ts](../next.config.ts) sets only `output: standalone` — no CSP/HSTS/
X-Frame-Options/Referrer-Policy), no email verification. All consciously deferred to deploy;
re-confirmed still open. Top pre-launch item stands.

### E2 (Low) — Signup email-uniqueness TOCTOU
[`auth/actions.ts:23-27`](../lib/auth/actions.ts) does `findUnique` then `create`. The DB
`@unique` on `User.email` ([schema.prisma:97](../prisma/schema.prisma)) makes this safe from
duplicates, but a race throws a raw Prisma `P2002` → unhandled 500 instead of the friendly
"email уже существует". Wrap the `create` and map `P2002` to the same typed error.

---

## Zone 7 — Product / UX correctness

### 🟠 P1 (High) — The "comparison" step doesn't compare (brief's headline value)
**Where:** [`compare/[type]/page.tsx`](<../app/(app)/compare/[type]/page.tsx>)
The brief's core complaint is "no independent **comparison** tool"; the route is even named
`/compare`. But it renders a **card catalog**, not a side-by-side comparison: no aligned rows,
no normalized "cost per unit throughput/yr", and it shows **only `maintenanceUsdYear`** —
hiding `energyUsdYear` and `licensingUsdYear`, so the OPEX a user sees on this screen is
**incomplete and lower** than what the calculator actually uses. This is §8 **I5, still open**,
and it directly undercuts the product's stated reason to exist.

**Recommendation:** implement the per-category side-by-side table §8 I5 specified — aligned
rows for price, capacity (normalized to a common basis via the now-existing `capacityBasis`),
full OPEX (maint + energy + licensing), and a derived "cost per unit throughput/yr".

### 🟠 U1 (High) — The `area` input is inert; editing it changes no number
**Where:** [`economics-calculator.tsx:128`](../components/economics-calculator.tsx) collects
`areaM2`, but grep confirms the engine never consumes it — its only reader is
[`layout.ts:16`](../lib/scene/layout.ts) (the picture). A skeptical client's very first
instinct is to change an input and watch the result move; changing "Площадь (м²)" moves
nothing in CAPEX/OPEX/ROI. That reads as "the form is theater." REFACTORING #6 flags this as
behavior-visible.

**Recommendation:** either **use** area in the model (e.g. a coverage/route-length or
space-cost term — ties in with A1's workload coupling) or **remove/relabel** it as
"visualization only" so no field silently does nothing. Same reasoning applies to
`turnoverPerDay` (only matters for `CONCURRENT_STOCK`) and `operatingHoursPerDay` (only
`PER_HOUR_FLOW`) — show only the fields the selected basis consumes.

### 🟡 P2 (Medium) — Revisit shows *recomputed* numbers, not the *saved* ones
**Where:** [`calculate/[solutionId]/page.tsx:28-32`](<../app/(app)/calculate/[solutionId]/page.tsx>)
On revisit, `params`/`assumptions` are restored but the stored `results` jsonb is **ignored**;
the calculator recomputes live from the **current** solution row. If a solution's `priceUsd`/
`capacityPerUnit` changed since saving (or real data replaced the seed), the user's "saved
analysis" silently displays **different numbers than when they saved it** — with no indication
it changed. For a tool selling trustworthy, revisitable estimates, that's a fidelity gap.

**Recommendation:** show the stored `results` as the source of truth for a saved analysis (or
detect divergence and flag "solution data has changed since you saved this").

### Low UX items
- **U2 (Low) — saved-analysis name isn't editable:** auto-generated `Расчёт — <date>`
  ([economics-calculator.tsx:97](../components/economics-calculator.tsx)); two saves on the
  same day are indistinguishable in the list. Allow a user-supplied name.
- **T2 (Low) — RU pluralization:** payback renders "X лет" unconditionally
  ([economics-calculator.tsx:166](../components/economics-calculator.tsx)) — "1 лет"/"2 лет"
  are ungrammatical; should be "год/года/лет". On the REFACTORING fast-follow list.

---

## Cross-reference: execution-plan §8 status

| §8 item | Intent | Status | Evidence / gap |
|---|---|---|---|
| **C1** | Normalize heterogeneous capacity units | ✅ Closed | `capacityBasis` enum + `normalize.ts` common-basis conversion |
| **C2** | Guard savings ≤ 0 | ✅ Closed | Typed `no_savings`, UI + viz render "не окупается", tested |
| **I1** | Scale OPEX by quantity | ✅ Closed | `calculate.ts:19-21`, tested |
| **I2** | Not 100% labor / add baseline OPEX / coverage tie | ⚠️ **Partial → A1/A2** | `laborReplacementPct` added, but coverage tie **not** implemented and baseline OPEX **not** subtracted |
| **M2** | ceil / hoursPerYear / discount rate | ⚠️ **Partial → A3** | ceil ✅, hoursPerYear ✅; discount rate **dropped, not implemented** (ROI still undiscounted) |
| **I6** | Move USD→RUB rate into Assumption table | ❌ **Open (Medium)** | still a hardcoded `USD_TO_RUB = 90` in [currency.ts:4](../lib/format/currency.ts); not editable, likely stale |
| **I7** | Bound visualization for extreme inputs | ✅ Closed | `MAX_RENDERED`, overflow badge, grid clamp, ≥1 robot |
| **I8** | Rebalance Week 4 / Session persistence | ⚠️ Partial (I8, Low) | Auth + deploy done; per-step `Session` record from plan §2 **not** built — selections flow via URL params, only final analysis persisted. Acceptable simplification; note the divergence |
| **I5** | Spec + build Step 2 comparison | ❌ **Open → P1 (High)** | `/compare` renders a catalog, not a comparison; hides energy+licensing OPEX |
| **M4** | Free-text "Other" object description | ❌ Open (folded into D1) | two fixed generic presets, no free-text echo |
| **M3 / M5** | PRD sharing contradiction / category slug uniqueness | ✅ Closed | revisit-only; `@@unique([facilityTypeId, slug])` |

---

## Recommended Phase-B order (for your sign-off)

**Model-changing (alter output numbers — each needs explicit sign-off + spec/§8 update + tests):**
1. **A1** — couple labor savings to robot workload (the credibility fix).
2. **A2** — conservative default `laborReplacementPct` + residual/baseline-OPEX term.
3. **A3** — discounting/NPV *or* explicit "undiscounted" labeling + asset-life handling.

**Behavior-changing but not model math:**
4. **P1** — real comparison table (I5).
5. **U1** — make `area` matter or mark it viz-only; show only basis-relevant fields.
6. **E1** — move zero-divisor guards into the engine.
7. **P2 / S1 / I6 / U2 / D1** — revisit fidelity, zod validation, rate in Assumption table,
   editable names, import/provenance guards.

**Pure refactor (behavior-preserving, per [REFACTORING.md](./REFACTORING.md)):** decompose
`economics-calculator.tsx`, extract `NumField`, remove dead `redirect` import, DRY the
finiteness check, log swallowed server-action errors. Safe to do independently of the above.

**Deferred to deploy (SEC1):** rate-limiting, security headers, email verification — per
DEPLOY §5, unchanged.

> Phase A ends here. No code changed. Awaiting your decision on which findings to act on
> before starting Phase B on branch `audit-and-refactor`.
