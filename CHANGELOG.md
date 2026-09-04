# Changelog

All notable changes to this project are documented here.
Format loosely follows [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Fixed
- **Fourth review round — five findings (one medium, four low).** Choosing «— свои значения —»
  silently rewound the labour rate: detaching the preset dropped the derivation without
  committing it, so the rate reverted to whatever it had been when the region was picked and
  every figure moved with it (NPV −28 259 → −20 479). The region-derived rate was also the one
  write path never clamped — at `usdToRub = 1` «Москва» derives 1076.55 against a max of 1000,
  which rendered fine and then made every save fail with an unexplained «Ошибка сохранения». The
  FK migration had no orphan cleanup, so it would abort a deploy on any database still carrying
  a dangling row — the exact state it exists to prevent. Blank-credential logins were padded to
  the rejection floor despite sitting ahead of the rate limiter and carrying no enumeration
  signal. And the canvas label said «2 роботов» where Russian needs «2 робота» — `pluralRu` was
  already in the repo for precisely this.
- **Third review round — eight findings.** «— свои значения —» could not release a region: the
  select became controlled when the parent took ownership, so the `if (r)` guard swallowed the
  empty value and React re-rendered the previous region straight back. `resultsDiverged` reported
  a false "model changed" banner for any analysis saved before `discountedPaybackYears` existed,
  because my own null fix compared `null !== undefined`. `assumptionsToValues` was the last
  entry point not clamped, so a DB row edited out of range rendered fine and then made every save
  fail with an unexplained «Ошибка сохранения». The rejection floor is now derived from a
  measured verify rather than a constant only ~120 ms above one — on slower hardware the oracle
  would have reopened with no code change. Throttled requests no longer occupy 400 ms of
  concurrency during a stuffing burst. An explicit pause now freezes the accrued figure in place
  instead of jumping it to the full year. The print reset now covers every token and the `.dark`
  class arm, not just surfaces. And `setRegionId` moved out of a state updater, which must be pure.
- **Saved reports could contain different numbers than the screen they were saved from.**
  Introduced by the region fix one commit earlier: `effectiveAssumptions` re-derives the labour
  rate from its ruble citation when `usdToRub` changes, but five surfaces — including
  `SaveControl` — still read the raw state. Picking «Москва», adjusting the rate, then saving
  produced a client-facing report reporting **4 425 300 ₽ against the 2 267 100 ₽ on screen**,
  and a «Стоимость труда» of US$12/час where the calculator showed US$9.79. Every read now goes
  through the derived object; the raw state exists only for the setter. The e2e parity spec now
  walks the region path before snapshotting, since it had been green throughout — it never
  touched those two controls.
- **Second review round — five findings, four of them regressions from this branch.** The
  account-enumeration oracle was **still open**: the upgrade-on-verify rehash only runs on a
  *successful* login, while the probe uses a wrong password and returns before it — measured
  **115 ms** for a legacy cost-10 account against **322 ms** for an unknown address, a 2.8x gap
  that would have persisted for the entire pre-existing user base. Replaced with a constant-time
  floor on every rejection, which is indifferent to hash cost: now **1.9% spread** across legacy,
  current and unknown. Reduced-motion users saw «Накопленная экономия (за год): 0 ₽» permanently
  beside a panel reporting 6 075 000 ₽ — the pause gate also froze `setElapsed`, and that figure
  appears nowhere else, so the canvas label's promise that the numbers are given as text was
  false for them. The region drift fixed one commit earlier was still reachable in the other
  order (pick «Москва», *then* change the rate → 22% overstatement); the selection is now tracked
  by id and the wage re-derived. «Ошибка сохранения» expired when the user nudged a field to
  retry, leaving nothing on screen to say the save had failed. And the `dark:` variant lacked the
  `.light` escape hatch its own token block has.
- **The ROI report printed near-black for dark-mode users.** Making the dark tokens reachable
  (B3, previous commit) applied them to `print` media too, and `.report-block` sets
  `print-color-adjust: exact` — so the browser would faithfully lay down the dark background
  instead of dropping it as it normally does. The report is the artefact a client is handed. The
  dark tokens are now scoped to `screen`, and an explicit `.dark` (a future #5d toggle) is reset
  for print, so the PDF is white however the app is being read. Also swept the five pages not
  previously checked in dark — `/analyses`, `/report`, `/login`, `/signup`, `/onboarding` — with
  no AA failures on any of them.
- **The brand pass's four unfinished pieces (#5c/#5d backlog).**
  **B1** — `--chart-1..5` were a single-hue blue→cyan *sequential* ramp sitting in shadcn's
  *categorical* slots: chart-5 measured 1.80:1 on white (3:1 is the minimum for graphical
  objects) and adjacent steps were ΔE 7.4 apart against a 15 floor, i.e. indistinguishable to
  full-colour vision. Replaced with a validated categorical palette — blue stays first so a
  single-series chart still reads as the brand — selected separately for each surface and checked
  with the dataviz validator: lightness band, chroma floor, CVD separation, normal-vision
  separation and contrast all pass in **both** modes, no warnings.
  **B2** — `--destructive` darkened. It is only ever ink or a light tint here, never a fill
  behind light text, so a darker step is a pure gain: the hero's «не окупается» panel measured
  **4.36:1** on its own 5% tint, under AA, for the one message whose job is delivering bad news
  legibly. Now **6.08:1**.
  **B3** — the `.dark` block was unreachable. `@custom-variant dark` keyed on a `.dark` class
  nothing sets, so every dark value was dead code while the CHANGELOG claimed "light + dark". It
  now also answers `prefers-color-scheme`, with the class arm kept for the #5d toggle.
  **B4** — added the `--positive` / `--caution` semantics that commit message named but never
  created, and replaced the 20 hardcoded `emerald`/`amber` utilities that no theme could reach.
  Provenance badges keep their distinct data-source hues by design, and gained dark steps.
  Verified by rendering both schemes: every text/background pair measured passes AA.
- **Years rendered with a Latin decimal point in a Russian UI.** `formatYearsRu` used
  `toFixed(1)`, which emits `.` in every locale, so «4.9 года» appeared beside the money
  formatter's «4 500 000 ₽» and the assumption inputs' «0,15» — three conventions on one screen,
  in the client-facing report. It now uses a pinned `ru-RU` formatter, matching how money is
  handled (server and client must agree byte-for-byte or hydration breaks). Rounding happens
  before the noun is chosen, so 4.95 reads «5,0 лет» rather than taking the fractional form.
- **Code-review follow-ups — nine defects, four of them introduced by earlier commits on this
  branch.** Raising the bcrypt cost re-opened the enumeration oracle *inverted*: the decoy hash
  is built at cost 12 (~274 ms) while every pre-existing account still verified its own cost-10
  hash (~69 ms), a measured **3.9x** gap. Login now rehashes on successful verify, so accounts
  migrate as people sign in. `withAssumptionDefaults` clamped nothing, so an analysis saved
  before the bounds existed still rendered `laborReplacementPct: 5` as an NPV of 3 803 215 in the
  client report. The hero's non-viable caption claimed the solution never pays back inside the
  horizon, but `isViable` is false on negative NPV alone — with `assetLifeYears < roiHorizonYears`
  a negative NPV can coexist with a real discounted payback, so the hero contradicted the panel
  again, in the opposite direction. `NumField` showed `5` while the page computed from the
  clamped `1`. Plus: a hydration mismatch on the pause button, accrued savings resetting to zero
  on resume, the canvas not repainting when the fleet size changed while paused, the login prompt
  vanishing when a logged-out user edited anything, `turnoverPerDay` permitting the zero it is
  divided by, and `check:sources` — the one script whose job is to refuse — passing an
  unparseable date as `ok NaNd` with exit 0.
- **Saved facility params are now backfilled like assumptions were.** A saved analysis had its
  `assumptions` defensively repaired on every read (`withAssumptionDefaults`) while `params` was
  cast straight out of jsonb — an asymmetry, given both come from the same blob. The engine's
  finiteness guard does catch the damage, so this is defence in depth rather than a live bug:
  it turns "a field went missing, so the whole analysis renders as «проверьте параметры»" into
  "that field falls back to its default". `withParamDefaults` deliberately leaves
  `peakConcurrent` absent when it is absent, because absent means "derive it from turnover" —
  a different instruction from any particular number.
- **Two controls kept asserting things the model had stopped agreeing with.** The region select
  was uncontrolled, so after picking «Москва» and then editing the labour rate it still claimed
  Москва while the numbers were no longer that region's — it now derives its selection from the
  current assumptions and falls back to «свои значения» once they diverge. And «Сохранено»
  persisted after any edit, inviting a second save in the belief the first had covered the new
  figures; the message is now tied to the inputs it was produced for. The report link stays
  either way, since that analysis genuinely was saved.
- **Number fields could not be cleared to retype.** `NumField` bound its value straight to the
  number and committed `Number(e.target.value)` on every keystroke — and `Number("")` is `0`, so
  emptying a box to enter a new figure instantly rewrote it to `0` and recomputed the whole
  model against it. The input now holds the raw string while it is being edited, commits only
  parseable values (so `""`, `"-"` and `"1e"` leave the last good number in place instead of
  pushing `0` or `NaN`), and re-syncs to the model on blur. The M3 clamping still applies.
- **Login was an account-enumeration oracle, and long Cyrillic passwords were silently
  truncated.** `authorize` returned before bcrypt when the account did not exist, so a real
  address answered in **71 ms** against **2.9 ms** for an unknown one — a 25x gap that reveals
  which addresses are registered. Both paths now run a bcrypt comparison, the miss against a
  process-lifetime decoy hash of the same cost; measured over HTTP the ratio is **0.90x**,
  indistinguishable. Alongside it: the work factor goes from 10 to 12 (~76 ms → ~279 ms per
  hash; existing hashes carry their own cost, so nobody is locked out and no migration is
  needed), and signup now rejects passwords over 72 **bytes** rather than letting bcrypt drop
  the tail — Cyrillic is two bytes per character, so an ordinary 40-character Russian
  passphrase was being quietly cut to 36.
- **The robot animation could not be stopped (WCAG 2.2 SC 2.2.2, Level A) and the canvas had no
  text alternative (SC 1.1.1, Level A).** The scene started on its own, ran indefinitely
  alongside other content, and offered no control — the visualization card contained zero
  interactive elements. It also ignored `prefers-reduced-motion` entirely, which a CSS media
  query cannot fix for a `requestAnimationFrame` loop. Adds a pause/resume button
  (`aria-pressed`) that starts **paused** when the OS asks for reduced motion, and gives the
  canvas `role="img"` with a label naming the robot count and stating that the motion is
  decorative — the figures it depicts are all present as text in the KPI column beside it.
  Paused still paints one frame, so the layout stays visible; only the motion stops.
- **Card section titles were not headings, and /onboarding had none at all (WCAG 2.2 SC 1.3.1
  Level A / SC 2.4.6 AA).** shadcn's `CardTitle` renders a `<div>` by design, leaving the
  consumer to choose the level — and nothing ever did. The calculator's whole outline was a
  single `h1` with six unstructured section titles beneath it, and the onboarding page, the
  entry point of the app, had no heading of any kind for a screen-reader user to orient by.
  `CardTitle` now takes an `as` prop; every card that is a real page section passes `as="h2"`,
  and onboarding gains an `h1`. Outlines verified: 1/2, 1/3 and 1/7 headings across the three
  pages, exactly one `h1` each, no level skips.
- **Status messages were never announced (WCAG 2.2 SC 4.1.3, Level AA).** The app had zero live
  regions. «Сохранено» / «Ошибка сохранения» and the signup error all appear without a
  navigation or focus change, so a screen-reader user got no indication that a save had
  succeeded or that signup had failed. The save outcome is now a `role="status"`
  (`aria-live="polite"`) wrapper that is always present in the tree — a region injected together
  with its text is unreliably announced — and the signup error is a `role="alert"` since the
  submission failed and the user is about to retry. The login error needs neither: it arrives
  via a redirect, so the page load announces it.
- **Login, signup and the save field had no labels at all (WCAG 2.2 SC 3.3.2 / 1.3.1, Level A).**
  All six inputs relied on a placeholder, which vanishes as soon as the field has content and is
  not a reliable accessible name. Each now has a real `<label for>` — visible on the auth forms,
  visually hidden on the save field where the inline layout has no room. Also adds the
  `autoComplete` hints browsers and password managers expect (`email`, `current-password`,
  `new-password`, `name`) and moves signup's "мин. 8 символов" into an `aria-describedby` hint
  rather than a placeholder that disappears while you type the password.
- **The peak-load field could show a number the engine wasn't using.** `ParamsForm` rendered
  `params.peakConcurrent ?? 0`, but when that field is unset the engine derives the peak from
  throughput and turnover instead — so the form would display `0` while the fleet was sized from
  something else. Reachable by switching in place into a `CONCURRENT_STOCK` solution, since the
  default is set in a `useState` initializer that runs once. Latent with current data (no seeded
  category mixes capacity bases — verified), live the moment one does. The derivation is now a
  single exported `resolvePeakConcurrent()` used by both the engine and the form, so they cannot
  disagree. 6 tests, including one asserting it matches `computeQuantity`'s own sizing.
- **Robots jumped back to their start positions on every unrelated keystroke.** The
  visualization memoized its layout on the whole `params` object, but `generateLayout` reads
  only `params.areaM2` — and `params` is a fresh object on each edit, so typing in «Объём
  операций» or «Персонал» minted a new layout, retriggering the respawn effect. `generateLayout`
  now takes `areaM2: number` rather than `FacilityParams`, which makes the memo key correct by
  construction instead of by an eslint-disable. Verified by sampling the canvas: editing
  `opsPerDay` or `staffCount` leaves the scene untouched, `areaM2` still rebuilds the grid.
- **Signed-in users got sideways scroll on every page on a phone.** `SiteHeader` rendered the
  full account email in a flex nav with no truncation and no wrapping, so a long address pushed
  the header past the viewport — 146px of horizontal scroll at 390px, reproduced on Chromium,
  Firefox and WebKit, and scaling with email length. Because the header forced the body wider,
  every card below was laid out off-screen too. Anonymous browsing was unaffected, which is why
  it went unnoticed. It also broke **WCAG 2.2 SC 1.4.10 (Reflow)**, which requires no horizontal
  scrolling at 320 CSS px. The email now truncates and is hidden below `sm`, and the header wraps
  instead of overflowing. Verified at 320 / 390 / 834 / 1280 px on all three engines: 0px
  everywhere; the desktop header is unchanged at a single 45px row with the email shown.
- **Rate limiter let a parallel burst walk straight past the limit.** Counting was a
  read-then-write, whose own comment described the risk as over-counting "by up to N". Measured,
  it was worse: every request in a burst read no row, all took the fresh-window branch, and each
  wrote `count = 1` — clobbering instead of accumulating. **100 parallel attempts against a limit
  of 10 were all allowed**, and repeated bursts of 20 let 40 through before it clamped, so the
  effective limit was roughly twice the attacker's chosen concurrency — weakest against exactly
  the parallel shape credential stuffing takes. Replaced with a single atomic
  `INSERT … ON CONFLICT DO UPDATE … RETURNING`, so Postgres's row lock serialises concurrent
  callers. Re-running the original probe: parallel bursts of 20 / 50 / 100 now allow exactly 10
  each, and repeated bursts total 10 instead of 40.
- **The brand font never reached the Russian UI.** `app/layout.tsx` loaded Geist and Geist Mono
  with `subsets: ["latin"]`, but the entire interface is Cyrillic — so every Russian glyph fell
  back to a system font and the typography established by the #5a brand pass applied to almost
  nothing on screen (digits, `US$`, `CAPEX`/`NPV`, Latin product names). Both faces ship a
  `cyrillic` subset; adding it emits the `U+400-45F` faces, and
  `document.fonts.check('16px Geist', 'Расчёт экономики')` now returns true where it returned
  false. One word in two places.
- **Two tornado bars were measured on a different ruler than their ±25% label.**
  `projectFinance` floors `roiHorizonYears` and `assetLifeYears` to whole years, so a
  percentage perturbation lands somewhere other than it claims: ±25% on a 5-year horizon gives
  3.75 / 6.25, which floor to 3 / 6 — an actual **−40% / +20%**. That bar was then ranked
  against seven others measured at a true ±25%, inflating its swing to 169 248. `assetLifeYears`
  had the opposite problem: 5.25 and 8.75 floor to 5 and 8, neither of which triggers re-CAPEX
  at a 5-year horizon, so it always drew an empty bar. Both now move by **±1 whole year** — what
  the model actually consumes — and the horizon's swing corrects to 106 332. Each bar carries a
  `kind` so the chart can label it (`±1 год`), and the caption no longer claims ±25% for
  everything. 5 new tests.
- **The hero band celebrated solutions the results panel called unprofitable.** `economical` is
  set by `annualSavingsUsd > 0` alone, so it stays true when discounted cash flows never recover
  the CAPEX — and three UI surfaces read it as "good investment". MediCarry M1 rendered the
  celebratory «ОКУПАЕТСЯ ЗА 4.9 года» with «NPV −7 908 985 ₽» beneath it, while the panel below
  said «не окупается в пределах горизонта» and the recommendation starred it ★ as best. 2 of the
  13 seeded solutions. Adds `isViable()` — NPV ≥ 0 **and** a discounted payback inside the
  horizon — gating the hero's celebratory treatment and the ★. Non-viable results now show a
  neutral panel headed «Простой срок окупаемости» with the caveat spelled out. Presentational
  only: the engine's discriminant and every number are unchanged.
- **Assumptions are now bounded — a mistyped digit could produce an authoritative nonsense
  figure and save it into a client report.** Nothing constrained the «Допущения» inputs: no
  `max`, no clamp, no check in `validateAssumptions`. Typing `5` into «Замещение труда (доля)»
  — a fraction — returned an NPV of 3 803 215 against a true 299 373, and a discount rate of
  −0.99 (which the engine permits, since it only guards `> -1`) returned
  61 363 636 327 691 730 ₽. Every value stayed finite, so `invalid_inputs` never fired and the
  number rendered with full confidence. Adds `ASSUMPTION_BOUNDS` with a documented range per
  assumption — physical limits where they exist (24 h/day, 366 days/year, fractions 0..1) and
  generous sanity caps elsewhere — applied at the two boundaries that matter: the panel clamps
  on input, and `validateAssumptions` rejects out-of-range payloads before persistence. **The
  engine is deliberately untouched** and keeps its own `invalid_inputs` guards, so the
  sensitivity tornado can still evaluate degenerate scenarios. 15 new tests.
- **Stale-analysis banner stayed silent when a solution stopped paying back.**
  `resultsDiverged` skipped every field whose recomputed value was not a number, so when
  `discountedPaybackYears` flipped from a number to `null` — "не окупается в пределах
  горизонта", the single most important change a saved analysis can undergo — it compared
  nothing and reported no divergence. The mirror case (null → number) was caught, which is what
  made the asymmetry easy to miss. Null is now compared as a conclusion in its own right,
  before the numeric branch. Four tests cover both directions, null → null, and a stored blob
  missing the key.
- **`prisma generate` now runs at install time — CI and the Vercel path were both broken.**
  Prisma 7 dropped `@prisma/client`'s own postinstall hook, `npm run build` is bare `next build`,
  and the generated client is gitignored — so nothing regenerated it outside the Dockerfile.
  Proven on a clean clone running the exact CI sequence: `npm ci` ✓ → `migrate deploy` ✓ →
  `db:seed` **exit 1** (`MODULE_NOT_FOUND: @prisma/client/default.js`) → `build` **exit 1**.
  The workflow's "runs green the moment a remote exists" comment and `DEPLOY.md §4a`'s claim
  that the build generates the client automatically were both false. Adds
  `"postinstall": "prisma generate"`, and two changes it turns out to require: the Dockerfile's
  `deps` stage now copies the schema before `npm ci` (generate exits 1 without it), and
  `prisma.config.ts` no longer uses `env()`, which threw at config-load time and would have made
  `npm ci` fail for anyone without a `.env`.

### Changed
- **Region presets hold the cited ruble wage and convert at the live rate.** ⚠ **Changes output
  numbers for anyone who picks a region preset.** Each preset stored a USD figure derived once at
  a hardcoded 90 ₽/$ — but `usdToRub` is an editable assumption, so the preset stopped matching
  its own citation as soon as anyone touched the rate: at 110 ₽/$ «Москва» implied 1 320 ₽/h
  against a cited 1 077, a 23% overstatement of a figure `data-provenance.md` presents as sourced.
  The wage is now held in rubles (the unit the source publishes) and divided by the live rate.
  **Delta at the default 90 ₽/$: −0.4% to +1.1%** on NPV, pure rounding — except «СКФО», where a
  −$1 154 absolute change reads as −12.2% because its NPV sits near zero. At 110 ₽/$ the changes
  are 26–37%, which *is* the correction. Users who never open the region selector are unaffected.
- **`SavedAnalysis.solutionId` is now a real foreign key** (`onDelete: Restrict`, plus an index).
  It was a bare `String`, so nothing stopped a saved analysis from pointing at a solution that no
  longer exists — and `seed.ts`'s prune deletes any warehouse row missing from the curated set,
  so renaming a product was one step away from silently orphaning users' analyses and 404-ing
  their reports with no explanation. `Restrict` rather than `Cascade`: a saved analysis is the
  user's data and must not vanish with a catalogue change. The seed's prune now checks for
  referencing analyses first, keeps those rows and logs which and why, instead of aborting the
  whole seed on the constraint. Applied cleanly — no orphans existed. Migration
  `20260903172455_saved_analysis_solution_fk`.
- **`noUncheckedIndexedAccess` enabled**, which surfaced two genuine unguarded assumptions
  behind 39 type errors. `spawnRobots`/`stepRobots` indexed `path[segment]` with no floor on
  path length — an empty path makes `segment % 0` NaN, `path[NaN]` undefined, and `lerp` would
  have thrown from inside the animation loop rather than anywhere diagnosable. And the
  calculator's `find(...) ?? categorySolutions[0]` assumed the category is never empty; it now
  renders a message instead of dereferencing undefined. The rest were places the compiler simply
  could not see an existing guard (`ranked[0]` behind a length check, `cashflows[t]` inside its
  own loop bound, `split(",")[0]`), rewritten so it can.
- **Shared economics row builder (refactor).** The print report re-rendered the same ten
  figures as the calculator's results panel, each spelling out its own money formatting, RU
  year pluralisation and null-payback wording — so a new engine figure had to be added twice.
  Extracted `components/calculator/economics-rows.ts` (`economicsRows()` + `PANEL_LABELS` /
  `REPORT_LABELS`); each surface still lays the rows out in its own markup (2-column print
  grid vs. stacked card) and keeps its own wording for the non-economical and invalid-input
  notices, which genuinely differ. Five tests pin row order, the no-savings truncation, the
  label variants and the never-pays-back wording. **One visual change:** the panel's «Базовые
  затраты на труд/год» value is now bold like its other nine rows and like the report — it was
  the only unbolded value on the card. No output number changes.
- **One `SolutionCapacity` projection (refactor).** The six-field literal mapping a solution
  record down to what the engine consumes was rebuilt by hand in four places — both server
  pages, the calculator shell, and `rankSolutions` — so adding a cost field to the model meant
  editing all four. Extracted `toSolutionCapacity()` into `lib/economics/normalize.ts` and
  routed every call site through it. Structural typing does the narrowing, so the emitted
  object is identical; three tests pin the projection (all fields copied, extras dropped,
  non-default basis preserved). No output number changes.
- **Shared test fixtures for the economics/scene suites (refactor).** Six test files each
  hand-built a full 14-field `AssumptionValues` literal (plus repeated baseline
  `SolutionCapacity` / `FacilityParams` literals — the facility params alone appeared 13
  times). Extracted `lib/economics/fixtures.ts` with `makeAssumptions()` / `makeCapacity()` /
  `makeParams()`, each spreading `DEFAULT_ASSUMPTIONS` (or a documented baseline) then caller
  overrides, so a test now states only the field it exercises. Every fixture value is
  byte-identical to before — the two suites that deliberately pin pre-A2 numbers keep their
  `laborReplacementPct: 0.7` / `residualSupervisionPct: 0` as explicit overrides. Test-only;
  no source file imports it. −60 net lines; all 127 tests green with unchanged assertions.
- **Brand identity & design tokens (#5a).** Replaced shadcn's default pure-grayscale theme with a
  **deep-blue + cyan** brand (`globals.css` oklch tokens, light + dark, brand-blue focus ring, a
  blue→cyan chart ramp for the sensitivity tornado, heading polish). Normalized 12 component/page
  files from ad-hoc `sky/emerald/amber/red` to one token per semantic: **primary** (actions/links/
  hero/★/tornado), **positive** green (savings/margin), **caution** amber (estimates), and
  `destructive` (не окупается/errors). Provenance badges keep their data-source hues; the canvas
  scene is unchanged (its cyan robots now intentionally echo the accent). Visual-only — no layout/
  behavior/copy change; all tests green.

### Added
- **Tests for the two server actions, which were at 0% coverage.** `saveAnalysisAction` is the
  app's write boundary — it decides what a client may persist and derives `facilityTypeSlug`
  from the database rather than trusting the payload — and `signUpAction` owns the rate limit,
  the email/password rules and the duplicate-account race. Neither had a single test. 14 new
  ones, running against the real database with only `auth()`, `next/headers` and `signIn`
  faked, so they assert behaviour rather than mocks: the slug really is overwritten when a
  client supplies its own, the analysis really is stored against the session user, an
  out-of-range assumption really is refused, and the per-IP signup cap really does engage on
  the sixth attempt.
- **`npm run check:sources` — a real gate on the "verify before a live demo" promise.**
  `docs/data-provenance.md` commits to every cited figure being re-checked before it is shown,
  but nothing enforced it: `lastVerified` was only validated for its date *format*, so a
  citation could rot for a year and still pass. The script reports each citation's age and exits
  non-zero past 180 days (`MAX_SOURCE_AGE_DAYS` to override), and `DEPLOY.md` now calls for it
  before a demo. Deliberately not in CI — a check that fails when a date rolls over would turn
  the build red for something no commit caused. A unit test covers what *is* safe to assert
  there: that the dates parse and are not in the future.
- **E2E teardown.** Each run signed up throwaway accounts and never removed them; the dev
  database had reached 63 users, 39 of them e2e leftovers, plus a `RateLimit` row per run. The
  suite now cleans up after itself (41 users and 71 rate-limit rows on first run), matching only
  its own prefixes and never failing a green run on a cleanup error.
- **E2E assertion that the report's figures equal the calculator's.** Both surfaces render the
  same ten numbers, and the report recomputes them from the *saved* params/assumptions rather
  than live state — so a fault in the save round-trip (`validateAssumptions`,
  `withAssumptionDefaults`) would silently put different numbers in the client-facing PDF than
  the client saw on screen. Nothing asserted they agreed. The new spec walks the values across
  the save boundary and compares every shared row, plus the two whose wording deliberately
  differs. Confirmed non-vacuous: injecting a report-only drift fails it with
  `report vs panel: CAPEX — Expected 31 050 000 ₽, Received 32 400 000 ₽`.
- **DB-backed rate limiting on login & signup (audit SEC1 / deploy #6).** A fixed-window limiter
  (`lib/auth/rate-limit.ts` + `RateLimit` table) throttles signup (5 / IP / 15 min) and login
  (10 / email+IP / 15 min). Postgres-backed so it works on both single-instance Docker and
  serverless; fails open on DB error. Closes the top pre-launch security item.
- **Regional labor/energy presets (opt-in convenience).** The calculator now offers a "Регион
  (труд/энергия)" dropdown on the Step 3 parameters panel. Selecting a region (Москва,
  Санкт-Петербург, РФ — среднее, or Низкозатратный регион/СКФО) automatically sets both
  `laborCostPerHourUsd` and `energyCostFactor` based on 2025 Rosstat average wages and regional
  industrial-tariff indices. Both values remain fully editable after selection; the presets are
  cited in `docs/data-provenance.md` with a "verify before a live demo" caveat. New assumption
  field `energyCostFactor` (default 1.0, applied as a multiplier on annual energy cost).
- **Hero results band on the calculate page (backlog #4).** A prominent one-glance headline above
  the calculator — «Окупается за N лет» with NPV and ROI, and an estimated-price caveat for
  cited/estimate solutions. Non-economical shows a plain «Не окупается»; invalid inputs hide the
  band (the results panel already notes it). Presentational — reuses the existing computed result.
- **Shareable one-page report (`/report/[id]`):** Saved analyses can now be exported to a
  print-to-PDF view — a clean one-pager showing the facility parameters, calculated results,
  NPV sensitivity tornado, solution provenance (source badge + link), and a disclaimer footer.
  Entry points: a "Отчёт" link on the analyses list (`/analyses`) and an "Открыть отчёт" link
  displayed after save succeeds on the calculator.
- **Real, sourced warehouse products (data credibility).** The fake `RoboPick/StackMax/…`
  warehouse rows are replaced with **3 real robotics products** — Hai Robotics HaiPick A42T
  (`amr`), Exotec Skypod and AutoStore (`asrs`) — seeded as `source: PARSED`. Specs are cited to
  live public pages (`sourceUrl`/`lastVerified`); **prices are shown as clearly-labelled estimate
  ranges** with an "оценка" marker + citation in the comparison table and calculate header, since
  industrial-robot list prices are not published (the ROI engine computes at the range midpoint,
  unchanged). New schema fields `priceEstimated`/`priceLowUsd`/`priceHighUsd`/`priceBasis`; curated
  data in `scripts/parse-sources/warehouse-real.ts` guarded by a data-integrity test; per-figure
  citations + a "verify before a live demo" gate in `docs/data-provenance.md`. Airport/medical/
  other remain badged demo (`SEED`) pending organizer data. CAPEX-only (RaaS deferred).
- **ROI-ranked recommendation + NPV sensitivity on the calculate page (decision engine).** For
  the user's facility, Step 3 now ranks the chosen solution's category siblings by NPV/payback
  ("Рекомендация для вашего объекта", ★ on the best) and lets you switch the primary solution
  **in place** — results, visualization, and save all follow instantly, no reload. Below it, an
  **NPV sensitivity tornado** ("Чувствительность NPV к допущениям") shows how much each
  assumption swings the result at ±25%, exposing the levers behind the number. New pure engine
  modules `lib/economics/recommend.ts` + `sensitivity.ts` (with a behavior-preserving extraction
  of `baseEconomics`/`projectFinance` from `calculate.ts` so the tornado computes honest negative
  NPVs). Spec: `docs/superpowers/specs/2026-08-29-recommendation-sensitivity-design.md`.
- **Break-even labor rate on the calculator.** A note card on the calculate page shows the
  minimum hourly labor cost ($/hr) at which the solution achieves NPV=0 over the projection
  horizon, plus a safety margin indicator (ratio of current cost to break-even rate). Read-only;
  no changes to existing numbers.

### Changed (economics model — output numbers change; signed off 2026-08-25)

> Audit findings A1–A3, spec: `docs/superpowers/specs/2026-08-25-economics-model-revision.md`.
> Each is a separate commit; together they replace the over-optimistic Week-2 savings/ROI.

- **A1 — labor savings now track workload, not raw headcount.** New editable
  `opsPerWorkerPerYear` assumption (default 12500) caps displaced staff:
  `displacedFte = min(staffCount, demandPerYear ÷ opsPerWorkerPerYear)`, and `baseline` +
  savings derive from `displacedFte`. A facility that overstates headcount relative to its
  operation volume can no longer inflate savings (e.g. 1 robot doing 40 ops/day now displaces
  0.8 FTE, not 70% of a 100-person payroll). The Step-3 input is relabelled "Персонал,
  замещаемый решением" and the results show "Замещается персонала (ЭПЗ)". `opsPerWorkerPerYear
  ≤ 0` → `invalid_inputs`. Example (default per-day solution, 400 ops/day, 10 staff): annual
  savings 201k → **159k**, ROI 1648% → **1283%**.
- **A2 — conservative defaults + residual supervision cost.** Default `laborReplacementPct`
  lowered 0.7 → **0.5**, and a new editable `residualSupervisionPct` (default 0.1) retains
  ongoing human oversight: `savings = baseline × replacement × (1 − residual) − opex`. Removes
  the "robots eliminate 70% of all labor at zero running cost" optimism the audit flagged.
- **A3 — discounting, NPV & asset lifecycle.** New editable `discountRate` (0.12) and
  `assetLifeYears` (7). The engine now models yearly cash flows over the ROI horizon, re-buying
  the fleet when assets expire mid-horizon, and reports **NPV** and **discounted payback**
  alongside the (now explicitly labelled) **simple** payback/ROI. `paybackYears`→
  `simplePaybackYears`, `roiPct`→`simpleRoiPct`; adds `npvUsd` and `discountedPaybackYears`
  (null = no payback within the horizon, shown as "более N лет"). Non-positive horizon / asset
  life / discount rate ≤ −1 → `invalid_inputs`. New `lib/economics/finance.ts` (`npv`,
  `discountedPaybackYears`) is unit-tested. Example (default DB assumptions, 500 ops/day, 10
  staff): annual savings **$111k**, simple payback **1.2 г**, discounted **1.4 г**, simple ROI
  **302%**, NPV **+$262k** — versus the old model's 1648% ROI.

### Added
- **Free-text object name on the "Other" path (audit M4 / §8 M4).** The generic facility path now
  offers an optional object name in onboarding, carried via `?obj=` and echoed in the Step-2
  comparison and Step-3 calculation headings, so the flow reads as tailored to the user's object.
- **Data-provenance badges in the comparison table (audit D1, partial).** Each solution shows a
  source badge — демо-данные / данные организатора / открытый источник (linking `sourceUrl`) —
  so the placeholder catalogue is honestly labelled. The import-side validator stays deferred
  until real organizer data exists.
- **Saved analyses can be named (audit U2).** The save control now has an optional name field
  (capped at 120 chars); a blank name falls back to the previous dated default. Two saves on
  the same day are no longer indistinguishable in "Мои расчёты".
- **Security headers (audit SEC1 / DEPLOY §5).** `next.config.ts` now sets Content-Security-
  Policy, X-Frame-Options (DENY), X-Content-Type-Options (nosniff), Referrer-Policy, and HSTS
  on all routes. CSP keeps `'unsafe-inline'` for Next's inline hydration (and `'unsafe-eval'`
  in dev only for HMR) — to be tightened with nonces later. Login/signup **rate-limiting**
  remains deferred (needs a deploy-time shared store), per DEPLOY §5.
- **Editable USD→RUB exchange rate (audit I6 / §8 I6).** The rate moved from a hardcoded
  `USD_TO_RUB` constant into a seeded, editable `usdToRub` assumption. `formatCost(usd, rate)`
  now takes the rate; it's threaded through the calculator results, the visualization, and the
  comparison table (all sourced from the DB assumptions). Default remains 90; editing it in the
  assumptions panel reprices every RUB figure live. Non-positive/non-finite rate falls back to
  the default.
- **Real Step-2 comparison table (audit P1 / §8 I5).** `/compare/[type]` now renders a
  per-category side-by-side table — price, capacity + basis, the **full** OPEX breakdown
  (maintenance + energy + licensing, previously only maintenance was shown), the annual OPEX
  total, and a normalized "цена за ед. годовой производительности" (price ÷ annualized
  throughput, via the engine's `capacityPerYear`; shown only for flow bases, "—" for
  concurrent-stock) — replacing the old catalog cards. Delivers the brief's headline
  "independent comparison" value.

- **Only basis-relevant calculator fields are shown (audit U1 / REFACTORING #6).** `area` is
  relabelled "Площадь, м² (только визуализация)" since it drives only the Step-4 scene, and
  basis-specific assumptions are hidden when they don't apply (`operatingHoursPerDay` only for
  PER_HOUR_FLOW, `turnoverPerDay` only for CONCURRENT_STOCK) — so editing any visible field
  visibly changes the result. No economics-model change.

### Fixed
- **Second code-review pass on the audit-left batch (2026-08-29).**
  - The comparison table's normalized metric is now **"Цена за 1000 ед./год"** (was "за ед.").
    Per-unit annual price is sub-dollar for high-throughput solutions and rounded to "US$0"
    under the whole-unit money formatter, making the headline comparison column useless; per
    1000 units it reads meaningfully (e.g. US$56 / US$960).
  - `resultsDiverged` (P2 revisit banner) now compares the economical/reason discriminant and
    **every** numeric output field, so a model change that shifts only derived figures (NPV,
    ROI, payback, OPEX, displaced FTE) is caught — not just quantity/capex/savings.
  - The save button is **disabled while a save is in flight** ("Сохранение…"), preventing
    duplicate saved rows from a double-click.
  - Removed a stray `scripts/_q.mts` temp file accidentally committed with M4.
- **Revisit fidelity: flag stale saved analyses (audit P2).** Opening a saved analysis restores
  its inputs but the calculator recomputes from the *current* solution row, so a solution-data
  or model change makes the shown numbers differ from what was saved. The calculate page now
  recomputes with the saved inputs against today's data, compares to the stored results, and
  shows an amber "данные/модель изменились — показан пересчёт" banner when they diverge instead
  of silently showing different numbers.
- **Code-review fixes on the audit branch (2026-08-25).**
  - A3 re-CAPEX no longer charges a spurious final-year fleet purchase: the fleet is re-bought
    only when assets expire with productive years left (`t % lifeYears === 0 && t < horizon`),
    and asset life is floored to whole years to match the annual cash-flow model (life must be
    ≥ 1, else `invalid_inputs`). Fixes the case where `assetLifeYears` divides the horizon —
    notably `assetLifeYears === roiHorizonYears`, which previously ~halved ROI and understated
    NPV. **Changes output numbers only for those (now-corrected) configurations.**
  - `displacedFte` is clamped at 0 so a negative param (e.g. a pasted negative `opsPerDay`/
    `staffCount`) can't surface a negative displaced-FTE or negative baseline labour cost.
  - The visualization now shows the neutral "Проверьте параметры" notice for `invalid_inputs`
    instead of the red "не окупается" (which wrongly implied the solution was unprofitable),
    matching the results panel.
  - The discounted-payback "no payback" case now reads "не окупается в пределах горизонта"
    instead of the ungrammatical/rounding-mismatched "более N лет".
  - `validate.ts` derives its assumption-key list from `DEFAULT_ASSUMPTIONS` so a newly added
    assumption is validated automatically instead of being silently stripped from saved payloads.
- **Validate the saved-analysis payload server-side (audit S1).** The save action persisted
  fully client-controlled input as jsonb with no checks. Added tested `lib/analyses/validate.ts`
  (bounded/trimmed `name`, strict finite-number shape for `params` + `assumptions`,
  plain-object `results`); the action now also verifies the solution exists and derives
  `facilityTypeSlug` from it rather than trusting the client's slug. Server-action errors are
  now logged before returning the generic client result (REFACTORING #5).
- **Correct Russian pluralization for the payback period (audit T2).** Payback rendered a
  fixed "X лет" ("1 лет"/"2 лет" are ungrammatical). New tested `lib/format/plural.ts`
  (`pluralRu` + `formatYearsRu`) applies proper noun agreement — "1.0 год", "2.0 года",
  "5.0 лет", and the genitive singular "1.5 года" for fractional durations.
- **Signup no longer 500s on a duplicate-email race (audit E2).** Concurrent signups could
  both pass the pre-insert `findUnique` check and then race on the `User.email` unique
  constraint; the loser threw an unhandled `P2002`. The `create` is now wrapped and P2002 is
  mapped to the same "email уже существует" message. Also removed the dead `redirect` import
  in `lib/auth/actions.ts` (REFACTORING #3).
- **Economics engine no longer leaks `Infinity`/`NaN` for degenerate inputs (audit E1).**
  `computeQuantity` now returns `null` (instead of throwing or dividing by zero) for
  non-positive per-unit capacity, a zero turnover rate with no explicit peak, or a
  zero-valued annualization divisor; `computeEconomics` maps that — plus any non-finite money
  output or non-positive CAPEX — to a typed `{ economical: false, reason: "invalid_inputs" }`
  result. UI (calculator + visualization) narrows on this variant and shows the existing
  "проверьте параметры" notice, replacing the duplicated ad-hoc finiteness checks. No change
  to results for valid inputs; only previously-`Infinity`/`NaN` (masked) cases are affected.
  Added engine tests for each degenerate path.

### Added
- Project scaffolding: `docs/00-idea-brief.md` (fixed source idea, verbatim),
  this changelog. Git repo initialized.
- `docs/01-prd.md` v1: MVP scope, user flow, data model, functional/non-functional
  requirements, success criteria — finalized via brainstorming session.
- `docs/02-execution-plan.md` v1: tech stack (Next.js + TS + Postgres/Prisma +
  Tailwind/shadcn + NextAuth, Vercel deploy), architecture, data strategy (seed data now,
  organizer data + open-source parsing later), economics engine formulas, visualization
  approach (2D parametric scene, real numbers/illustrative motion), 4-week build order,
  risks.
- `docs/superpowers/plans/2026-08-17-week1-foundation.md`: detailed 7-task Week 1
  implementation plan (scaffold → shadcn/ui → Postgres+Prisma → seed → data layer+tests →
  Step 1 picker → Step 2 catalog).
- Next.js app scaffolded (Next 16.3.1 / React 19.2.8 / Tailwind v4) + shadcn/ui base
  components (button, card, label, radio-group). [Week 1 Tasks 1-2]
- Local Postgres via Docker Compose + Prisma 7 schema: 5 models (`Industry`,
  `FacilityType`, `SolutionCategory`, `Solution`, `FacilityExample`) + `SolutionSource`
  enum, initial migration. Prisma 7 driver-adapter setup (`prisma.config.ts`,
  `@prisma/adapter-pg`), since Prisma 7 requires an explicit adapter to connect. [Week 1
  Task 3]
- Seed data: 4 industries / 4 facility types / 8 solution categories / 14 solutions, all
  tagged `source: SEED` for provenance. [Week 1 Task 4]
- Data-access layer (`lib/db/`) with Vitest integration tests run against the seeded
  database. [Week 1 Task 5]
- Step 1 `/onboarding` industry + facility type picker. [Week 1 Task 6]
- Step 2 `/compare/[type]` solution catalog, plus the RUB-primary + USD currency
  formatter (`lib/format/currency.ts`) it uses to display solution prices. [Week 1 Task 7]
- `capacityBasis` enum + `Assumption` Prisma model (migration). [Week 2]
- Pure economics engine in `lib/economics/` — capacity-unit normalization (C1: per-hour/per-day
  flow + concurrent-stock sizing) and `computeEconomics` (OPEX×qty, labor-replacement %, savings≤0
  guard, undiscounted payback/ROI), fully unit-tested; plus the assumptions row→values mapper. [Week 2]
- Seeded `capacityBasis` on all 14 solutions + 8 editable economic assumptions. [Week 2]
- Query helpers `getSolutionForCalc` / `getAssumptions`; "Рассчитать экономику" links on Step 2. [Week 2]
- Step 3 `/calculate/[solutionId]`: server page + live client calculator (editable assumptions,
  recompute-on-change, RUB+USD via formatCost, NaN/Infinity finiteness guard, peak-load input for
  concurrent-stock solutions). [Week 2]
- Step 4 visualization: a 2D Canvas panel on the `/calculate` page showing robots operating on a
  per-vertical facility layout (warehouse racks / airport belt+gates / medical rooms / generic zones),
  driven live by the Step 3 params + economics result.
- Pure, unit-tested scene engine in `lib/scene/` — deterministic layout generator with a 6×6 grid
  clamp for extreme inputs, a waypoint robot simulator, and KPI derivations (deployed capacity,
  utilization %, ROI accrual) reusing the economics annualization helpers.
- Live KPI panel: robots-in-work (capped at 24 with a "показано 24 из N" badge), utilization %, and
  an animated "накопленная экономия" bar filling to one year's savings in RUB+USD; a
  not-economical result shows the "не окупается" state. [Week 3]
- Accounts (Auth.js v5 credentials, bcrypt-hashed passwords, JWT sessions): signup/login,
  header auth state, logout. Anonymous users can still use Steps 1-4; login is required only
  to save. [Week 4]
- Save & revisit: a logged-in user can save a completed analysis and reopen it from "Мои
  расчёты" (`/analyses`); saved analyses are strictly user-scoped. [Week 4]
- Deploy-ready config: `output: "standalone"`, multi-stage `Dockerfile`, `.dockerignore`, and
  a `docs/DEPLOY.md` runbook (managed Postgres + env vars + migrate/seed + Vercel/Docker). [Week 4]

### Changed
- Applied an Opus 4.8 review of all planning docs (2 Critical / 8 Important / 6 Minor;
  full text in `.superpowers/sdd/2026-08-17-week1-foundation/opus-doc-review.md`):
  - **Currency decision:** display RUB primary + USD in parens via an editable exchange
    rate (Week 1: constant in `lib/format/currency.ts`; Week 2: `Assumption` table).
  - Week 1 plan corrected: `.env.example` un-ignored (M1); `SolutionCategory` slug now
    unique per-facility-type not globally (M5); seed script + Vitest load `DATABASE_URL`
    via dotenv (I4); centralized pinned-locale currency formatter fixes a hydration risk
    (I6); package renamed from `rrp-scaffold` (M6); stack references corrected to the real
    Next 16 / Tailwind v4 (I3); PRD "share" contradiction fixed (M3).
  - `docs/02-execution-plan.md` §8 records deferred findings to resolve before their week:
    economics normalization/guards (C1, C2, I1, I2, M2) before Week 2; viz input bounds
    (I7) before Week 3; Week-4 rebalance + real deploy-DB tasks (I8); comparison spec (I5)
    and "Other" free-text (M4) as doc follow-ups.
