# Brand Identity & Design Tokens (#5a) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (recommended here — this is a visual refactor whose real gate is eyeballed screenshots, best done inline by the controller) or subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Replace shadcn's grayscale theme with a deep-blue + cyan brand and route components through one token per semantic — a cohesive, professional look across all existing screens. Visual-only.

**Architecture:** Brand tokens in `app/globals.css` (oklch, AA, matching dark vars); then normalize 12 component/page files from ad-hoc `sky/emerald/amber/red` to consistent semantic classes.

**Tech Stack:** Tailwind v4 + shadcn tokens, Next 16, oklch CSS variables. No new deps.

**Spec:** `docs/superpowers/specs/2026-09-01-brand-tokens-design.md`

## Global Constraints
- **Never commit to `master`.** Branch `brand-tokens` (already checked out).
- **Visual-only:** no layout/DOM/behavior/logic/copy changes. **All 127 unit + 3 E2E stay green** (they assert text/roles/numbers, not colors — a structure safety-net).
- Build `npm run build` exit 0. Keep **WCAG AA** contrast on text pairs.
- The **canvas robot/zone colors in `facility-visualization.tsx` STAY** (cyan robots intentionally echo the accent) — do not touch that file.

## File structure
- `app/globals.css` — MODIFY: brand token values (`:root` + `.dark`) + a heading base rule.
- 11 component/page files — MODIFY: ad-hoc color → semantic tokens (list in Task 2).

---

### Task 1: Brand tokens in `globals.css`

**Files:** Modify `app/globals.css`.

- [ ] **Step 1: Replace the brand-carrying values in `:root`** (keep everything else). Set:
```css
  --primary: oklch(0.42 0.17 264);          /* deep blue */
  --primary-foreground: oklch(0.985 0 0);
  --accent: oklch(0.96 0.02 250);           /* faint blue surface (hovers/subtle) */
  --accent-foreground: oklch(0.42 0.17 264);
  --ring: oklch(0.55 0.15 264);             /* visible brand-blue focus ring */
  --chart-1: oklch(0.42 0.17 264);          /* blue → cyan ramp */
  --chart-2: oklch(0.55 0.13 240);
  --chart-3: oklch(0.65 0.12 210);
  --chart-4: oklch(0.72 0.11 195);
  --chart-5: oklch(0.80 0.09 190);
```
Leave `--background/foreground/card/muted/border/input/secondary/destructive/radius` as-is
(neutral grayscale + the existing red destructive — safe for contrast; brand is carried by
primary/accent/ring/charts).

- [ ] **Step 2: Match the `.dark` block** — set brand values tuned for dark surfaces:
```css
  --primary: oklch(0.62 0.16 264);
  --primary-foreground: oklch(0.145 0 0);
  --accent: oklch(0.30 0.03 250);
  --accent-foreground: oklch(0.90 0.03 240);
  --ring: oklch(0.62 0.16 264);
  --chart-1: oklch(0.62 0.16 264);
  --chart-2: oklch(0.66 0.13 235);
  --chart-3: oklch(0.72 0.12 205);
  --chart-4: oklch(0.78 0.11 195);
  --chart-5: oklch(0.84 0.09 190);
```
(Dark theme is wired but not toggled in this slice — that's 5d.)

- [ ] **Step 3: Add a heading polish** in the `@layer base` block (after the `body` rule):
```css
  h1, h2 {
    @apply font-semibold tracking-tight;
  }
```

- [ ] **Step 4: Build + full suite.** `npm run build` exit 0; `npx --yes vitest run < /dev/null` (127).

- [ ] **Step 5: Commit**
```bash
git add app/globals.css
git commit -m "feat: deep-blue + cyan brand tokens (globals.css, light + dark)"
```

---

### Task 2: Normalize components to semantic tokens

> Apply the mapping below across each file. Match by MEANING, not a blanket find-replace. After
> editing, the ad-hoc `sky-*`/`blue-*` for actions/accents should be gone; positive/caution/
> negative use one consistent treatment each.

**Mapping (apply consistently):**
- **Primary / action / link / header accent / hero band / ★ best / accent rules:** `sky-*`,
  `blue-*` → primary+accent tokens. Patterns:
  - solid text/link: `text-sky-700` → `text-primary`
  - tinted surface card (e.g. hero): `border-sky-200 bg-sky-50` → `border-primary/20 bg-primary/5`;
    inner text `text-sky-900`/`text-sky-800`/`text-sky-700` → `text-primary` (or `text-foreground`
    for body inside a tinted card)
  - bar fill (sensitivity tornado): `bg-sky-500` → `bg-primary` (track stays `bg-muted`)
  - `border-sky-500 bg-sky-50/50` (selected recommendation row) → `border-primary bg-accent`
- **Positive** (economical/savings/safety-margin OK): standardize on `emerald` at one shade set —
  `text-emerald-700`, `bg-emerald-50`, `border-emerald-200` (fix any off-shade to these).
- **Caution** (оценка / estimate notes): standardize on `amber` — `text-amber-700` (and
  `bg-amber-50 border-amber-200` where a surface is used).
- **Negative** (не окупается / below break-even / errors): `text-red-600`/`red-700`,
  `border-red-200 bg-red-50` → `text-destructive`, `border-destructive/30 bg-destructive/5`.
- **Provenance badges** (`components/provenance-badge.tsx`): LEAVE unchanged — the three hues
  encode data source, not brand.
- **`components/facility-visualization.tsx`:** LEAVE the canvas colors; only touch any
  non-canvas Tailwind classes if they use `sky/blue` for chrome.

- [ ] **Step 1: Edit each file per the mapping.** Files (read each, apply the swaps):
  - `components/site-header.tsx` (header accent/links → primary)
  - `components/calculator/hero-results.tsx` (sky tinted card → primary tints; keep the red/green/amber semantics via destructive/emerald/amber)
  - `components/calculator/recommendation-panel.tsx` (★ + selected row → primary/accent)
  - `components/calculator/sensitivity-chart.tsx` (`bg-sky-500` bar → `bg-primary`)
  - `components/calculator/break-even-note.tsx` (emerald/amber consistency; any sky → primary)
  - `components/calculator/results-panel.tsx` (`text-red-600` → `text-destructive`)
  - `components/economics-calculator.tsx` (amber estimate note consistency; dataChanged banner amber; any sky → primary)
  - `app/(app)/compare/[type]/page.tsx` (оценка `text-amber-700`, provenance stays; any link/border → primary)
  - `app/(app)/report/[analysisId]/page.tsx` (header `border-sky-600` + `text-sky-700` → `border-primary text-primary`; amber estimate note; dataChanged amber)
  - `app/(auth)/login/page.tsx`, `app/(auth)/signup/page.tsx` (links/buttons → primary)

- [ ] **Step 2: Verify no stray action-color remains.** Run:
```bash
grep -rnE "sky-[0-9]|text-sky|bg-sky|border-sky" components app --include=*.tsx || echo "no sky-* left (good)"
```
Expected: no `sky-*` (all migrated to primary/accent). `emerald/amber/red-as-destructive` are the
only palette colors left, used consistently. (`facility-visualization.tsx` canvas hex colors are
in JS strings, not Tailwind classes — unaffected.)

- [ ] **Step 3: Build + full suite.** `npm run build` exit 0; `npx --yes vitest run < /dev/null`
(127). Then `npm run test:e2e` (3) — confirms the visual refactor didn't break structure/flow.

- [ ] **Step 4: Visual capture (the real gate).** Start the DB + dev server, and use the browser
tooling (or the `run`/screenshot flow) to capture **light-theme** screenshots of:
`/onboarding`, `/compare/warehouse`, and a `/calculate/<warehouse-id>` page. Eyeball: primary is
the deep blue, hero/★/links/tornado read as brand, positive=green / caution=amber / negative=red
are consistent, nothing looks broken. Present the screenshots for sign-off before merge.

- [ ] **Step 5: Commit**
```bash
git add components app
git commit -m "feat: normalize components to brand semantic tokens (primary/positive/caution/destructive)"
```

---

## Whole-feature review (after Task 2)
- [ ] `npm run build` (exit 0), `npx --yes vitest run < /dev/null` (127), `npm run test:e2e` (3).
- [ ] Present screenshots; get visual sign-off.
- [ ] `/code-review` (medium — visual/mechanical diff) over `git diff master...HEAD`; fix findings.
- [ ] CHANGELOG "Changed" entry (brand tokens + component color normalization; visual-only).
- [ ] Merge to master with `--no-ff` after sign-off.
