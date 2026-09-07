# Refactoring Backlog

> Captured 2026-08-24 after the 4-week build completed. This is OPTIONAL,
> behavior-preserving cleanup of a working, fully-reviewed, demo-ready codebase — nothing here
> is required. Do it on a branch (`refactor-pass`), keep `npm run build` + `npx vitest run`
> green after each item, and review before merge.
>
> **Status as of 2026-09-02: ALL SIX items are DONE and merged.** Do not redo any of them.
> Items 1–5 shipped during the build weeks; item 6 shipped as commit `fc7c167`
> ("U1: show only basis-relevant calculator fields (audit / REFACTORING #6)"). Work done in the
> 2026-09-02 refactor pass is listed under "Done in the 2026-09-02 pass" below.

## Prioritized items

### High value — structural

1. **Decompose `components/economics-calculator.tsx`** — **DONE.** It owned the params form,
   results panel, assumptions panel, save control and the visualization composition in ~221
   lines. `components/calculator/` now holds `params-form`, `results-panel`,
   `assumptions-panel`, `save-control` and six more; the shell is 150 lines of state plus
   composition.

2. **Extract `NumField` to a shared component** — **DONE.** Lives at
   `components/ui/num-field.tsx`, consumed by `params-form.tsx` and `assumptions-panel.tsx`.

### Small cleanups

3. **Remove the dead `redirect` import in `lib/auth/actions.ts`** — **DONE.** The file no
   longer imports it.

4. **DRY the finiteness check** — **DONE**, and better than the item specified. Rather than a
   plain `isFiniteResult()` predicate, `isCalculable()` in `lib/economics/types.ts` both guards
   *and narrows* the result union, so the numeric fields are type-safe at every call site. Used
   by the calculator, the visualization, the results panel, the break-even note, the hero
   results and the report page.

5. **Log server-action errors** — **DONE.** `lib/analyses/actions.ts:51` logs before returning
   the generic client result; the response stays generic, so no details leak to the client.

### Behavior-visible (a small UX change, not pure refactor)

6. **Show only calculator fields the current basis/engine uses** — **DONE** in `fc7c167`,
   and solved slightly differently from the original proposal. `AssumptionsPanel`'s
   `BASIS_ONLY` map hides `operatingHoursPerDay` unless the basis is `PER_HOUR_FLOW` and
   `turnoverPerDay` unless it is `CONCURRENT_STOCK`. `areaM2` is *not* hidden — it does drive
   the Step-4 scene, so instead of disappearing it is relabelled «Площадь, м² (только
   визуализация)», which keeps the item's real goal: every visible field visibly changes
   something. See the CHANGELOG entry "Only basis-relevant calculator fields are shown
   (audit U1 / REFACTORING #6)".

## Done in the 2026-09-02 pass

Surfaced by re-grepping the tree rather than working from this list — all three are
behavior-preserving and none changes an economics output number.

7. **Shared test fixtures.** Six test files each hand-built a complete 14-field
   `AssumptionValues` literal, and the baseline `SolutionCapacity` / `FacilityParams` literals
   were repeated alongside (the facility params appeared 13 times). Now
   `lib/economics/fixtures.ts` — `makeAssumptions()` / `makeCapacity()` / `makeParams()`, each
   spreading the shipped defaults then caller overrides. −60 lines.

8. **One `SolutionCapacity` projection.** The six-field narrowing was rebuilt by hand at four
   entry points; `toSolutionCapacity()` in `lib/economics/normalize.ts` now does it once.

9. **Shared economics row builder.** The print report duplicated the results panel's ten
   figures and their formatting rules; `components/calculator/economics-rows.ts` now emits the
   rows and each surface keeps its own layout and its own empty-state wording.

Re-verified and NOT acted on:

- **Assumption-list drift.** All 14 keys agree across `DEFAULT_ASSUMPTIONS`,
  `ASSUMPTION_LABELS`, the seed rows and `validate`. Two of those are already structurally
  safe: `ASSUMPTION_LABELS` is typed `Record<keyof AssumptionValues, string>` so the compiler
  catches a miss, and `validate` derives its key list from `DEFAULT_ASSUMPTIONS`. The one
  unguarded site is `scripts/seed.ts`, whose rows are plain strings with no type link to the
  model — a new assumption added there and nowhere else, or vice versa, would not fail the
  build. Worth a parity test if the assumption set changes again.
- **`app/(app)/compare/[type]/page.tsx`.** The inline `Th`/`Td` helpers read fine; the only
  repetition left is a `text-right whitespace-nowrap` class pair on six cells. Not worth a
  component.
- **`components/facility-visualization.tsx` (197 LOC, the largest file).** The canvas loop and
  the KPI panel are separable and a `useFacilityCanvas` hook would be a mechanical lift, but
  the file is cohesive as it stands and the canvas is the one part of the app with no test
  coverage. Left alone deliberately; revisit only with a screenshot check in hand.

## Deliberately NOT refactoring

- The pure engines (`lib/economics`, `lib/scene`) are already DRY and well-bounded (DRY
  helpers `capacityPerYear`/`demandPerYear` shared; per-vertical layout functions small).
- The query layer (`lib/db/queries.ts`) is clean and consistently `userId`-scoped.
- Churning these would be gold-plating a working, reviewed codebase.

## Related (separate from refactoring — see other docs)

- Pre-production **security hardening** (rate-limiting, security headers): `docs/DEPLOY.md §5`.
- Deferred economics/viz findings for future feature work: `docs/02-execution-plan.md §8`.
- Minor fast-follows noted in reviews — re-checked against the tree on 2026-09-07, four of five
  closed:
  - **Save-button double-submit disable** — DONE (`save-control.tsx`, `disabled={saving}`).
  - **RU pluralization in the viz** — DONE; `pluralRu` drives the canvas `aria-label`
    («2 робота», not «2 роботов») and `formatYearsRu` the year figures.
  - **Validate the saved-analysis payload** — DONE, hand-rolled rather than with zod
    (`lib/analyses/validate.ts`), so it shares `ASSUMPTION_BOUNDS` with the engine instead of
    restating the ranges in a second schema.
  - **Engine-side guard for zero-valued assumption divisors** — DONE via `ASSUMPTION_BOUNDS`
    (`turnoverPerDay` min is 1, not 0) plus `clampAssumption` on every read path.
  - **Canvas devicePixelRatio scaling — STILL OPEN.** The canvas has a fixed 720×360 backing
    store displayed at whatever width the grid gives it (~470 px), so it is ~1.5× oversampled:
    sharper than 1× but soft on a 2× display. The fix is to size the backing store from the
    element's measured CSS box × `devicePixelRatio` (ResizeObserver) and draw in CSS pixels,
    which also means re-checking the robot dot radius, currently 5 *backing* pixels. Cosmetic
    only — no figure it displays is affected. This file is the one with no test coverage, so
    do it with a screenshot check in hand.
