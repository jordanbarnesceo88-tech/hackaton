# Design: Regional Labor / Energy Inputs (backlog #8a)

> Status: approved via brainstorming 2026-09-01. First slice of #8 (model depth). Replaces the
> single global `$15/hr` labor default with **opt-in regional presets** that set labor cost and a
> regional energy-cost factor — directly addressing the top sensitivity lever ("are these numbers
> real for MY region?"). Changes output numbers ONLY when a region is picked (default is a no-op).

## Goal & context

The audit + the sensitivity tornado both show `laborCostPerHourUsd` is the #1 driver of ROI, yet
today it's a single global constant ($15/hr) with no regional/sector variation — the easiest
figure for a skeptic to attack. This adds a **region selector** that sets the labor rate and an
**energy-cost factor** from a small cited preset table.

### Decisions locked in brainstorming
- **Labor presets + a regional energy FACTOR** (not a full ₽/kWh tariff) — only 1 of 13 solutions
  has power-draw data, so a true tariff can't be applied uniformly and power draws must not be
  fabricated. The factor scales each solution's existing flat `energyUsdYear`.
- **Opt-in, default unchanged.** No region selected ⇒ labor $15 + factor 1.0 ⇒ **existing numbers
  are byte-identical**. Picking a region is an explicit user action. (Real RF regional labor is
  often below $15/hr, so picking a region typically *lowers* savings/ROI — a more conservative,
  more defensible number.)
- Region is a **convenience setter**, not a lock: it sets two assumptions that stay individually
  visible/editable in the assumptions panel.

## Model & data

### `lib/economics/regions.ts` (pure, cited, tested)
```ts
export type RegionPreset = {
  id: string;                 // stable slug, e.g. "moscow"
  name: string;               // RU label, e.g. "Москва"
  laborCostPerHourUsd: number;
  energyCostFactor: number;   // multiplier on energyUsdYear; ~0.7–1.1, Москва ≈ 1.0
};
export const REGION_PRESETS: RegionPreset[];   // ~5 entries + values researched & cited
```
Candidates: Москва, Санкт-Петербург, РФ-среднее, a lower-cost region (e.g. Приволжье/Урал), and
optionally a high-cost northern region. Labor from RF regional average wage → USD/hr at a
documented rate; energy factor from RF industrial-tariff variation (Москва = 1.0 reference). Every
value cited in `docs/data-provenance.md` with the "verify before a live demo" caveat.

### Engine change (small; sign-off — but a no-op at defaults)
- `AssumptionValues` gains `energyCostFactor: number` (**default 1.0**).
- In `baseEconomics` (`lib/economics/calculate.ts`), the energy term of OPEX becomes:
  `quantity × (maintenanceUsdYear + energyUsdYear × a.energyCostFactor + licensingUsdYear)`.
- At `energyCostFactor = 1.0` this is byte-identical to today — enforced by a parity test.
- Seed the new assumption (`energyCostFactor`, 1.0); it auto-flows into the derived validator keys
  (`validate.ts` reads `Object.keys(DEFAULT_ASSUMPTIONS)`), the assumptions panel, and the report.

## UI & flow

- A **«Регион (труд/энергия)» `<select>`** in the params form: options = a «— (свои значения)»
  sentinel (default, changes nothing) + each `REGION_PRESETS` entry. Option labels show the
  human-readable labor rate for context, e.g. «Москва — ~850 ₽/ч» (₽ = `laborCostPerHourUsd ×
  usdToRub`, so it tracks the exchange rate; pinned-locale formatting to avoid hydration drift).
- On change → `setAssumptions` sets `laborCostPerHourUsd` + `energyCostFactor` from the preset. The
  two underlying fields remain editable in the assumptions panel (region is a setter, not a lock).
- **Not persisted as its own field** — it seeds two assumptions, which *are* saved; a saved
  analysis round-trips its effective rates. No schema change beyond the `energyCostFactor`
  assumption. The report already prints labor cost; it will also show the energy factor via the
  assumptions it renders.
- Component: a small client control; the select lives in `ParamsForm` (which already holds the
  region-relevant inputs) OR a thin new `RegionSelect` composed into the shell — implementer's
  choice, kept presentational.

## Testing
- **Parity test** (`calculate.test.ts`): `energyCostFactor: 1.0` ⇒ `computeEconomics` identical to
  the pre-change numbers (guards "default unchanged"). Add `energyCostFactor` to the test fixtures.
- **Energy-scaling test:** `energyCostFactor: 0.8` scales only the energy component of OPEX (assert
  `opexAnnualUsd` drops by `quantity × energyUsdYear × 0.2`), and (economical) savings rise by the
  same amount.
- **`regions.test.ts`** integrity: every preset has `laborCostPerHourUsd > 0`, `energyCostFactor`
  in [0.5, 1.5], non-empty `id`/`name`, unique ids.
- Existing **106 unit tests + 3 E2E stay green** (default path unchanged). `energyCostFactor` added
  to every `AssumptionValues` fixture across the test suite.
- UI select: presentational → build + a logged-in/manual check; optionally an E2E assertion that
  picking a region changes the labor field (nice-to-have, not required).

## Sign-off deltas
Default (no region) = no change. At implementation I will report the **example delta when a region
is picked** (e.g. «Москва ~$9.5/hr» vs the $15 default → savings/ROI change by X%) for explicit
sign-off, and update `docs/superpowers/specs/2026-08-25-economics-model-revision.md` / execution-
plan §8 noting `energyCostFactor` + regional presets.

## Out of scope (later #8 slices)
- Full per-solution power-draw + ₽/kWh tariff energy model (needs a schema field + data for all 13
  solutions).
- Sector (not just region) labor variation; more than ~5 regions.
- ROI ranges (8b), break-even (8c), RaaS (8d), A4 stock coupling (8e).
