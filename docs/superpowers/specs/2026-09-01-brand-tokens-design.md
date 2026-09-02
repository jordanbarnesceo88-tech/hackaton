# Design: Brand Identity & Design Tokens (backlog #5a)

> Status: approved via brainstorming 2026-09-01. First slice of #5 (design/brand + a11y). Replaces
> the default shadcn **pure-grayscale** theme with a **deep-blue + cyan** brand, and routes
> components through a small set of semantic conventions instead of scattered ad-hoc
> `sky/emerald/amber/red`. Visual-only — no layout, behavior, logic, or copy changes.

## Goal & context

Every color token today is zero-chroma grayscale (no brand); 12 component files hardcode ad-hoc
Tailwind colors (`sky/emerald/amber/red/blue`); dark-mode vars exist but are never activated. The
app looks "default shadcn," not intentional. This slice gives it a cohesive, professional identity
that uplifts all existing screens at once — the foundation the landing page (5b) and a11y (5c)
build on.

Brand direction (chosen): **deep-blue primary + cyan accent** — trust (finance) + tech (robotics),
and the canvas already renders cyan robots, so the accent ties to what's on screen.

## Tokens (`app/globals.css`)

Replace the grayscale `:root` and `.dark` values for the brand-carrying tokens; keep radius, fonts
(Geist), and the neutral surfaces largely as-is (cool-tinted, not colored). All values in oklch to
match the existing file; **maintain WCAG AA contrast** (primary/accent vs their foregrounds, and
`muted-foreground` vs background ≥ 4.5:1 for text).

- `--primary`: deep blue (~`#1e40af`), `--primary-foreground`: near-white.
- `--accent` / `--accent-foreground`: cyan-tinted surface for subtle highlights.
- `--ring`: brand blue (focus states pick up the brand — also helps 5c).
- `--chart-1..5`: a small brand-aligned ramp (blue→cyan) for the sensitivity tornado / future viz
  (see the `dataviz` guidance for an accessible categorical order).
- `.dark`: matching blue/cyan tuned for dark surfaces (wired, but no toggle in this slice — 5d).
- Neutrals (`--background/foreground/card/muted/border/input`): give a very slight cool tint so
  surfaces read intentional, keeping contrast AA.

## Component adoption (the real work — semantic conventions)

Normalize the 12 files to **one token per semantic meaning**, replacing ad-hoc colors:

| Semantic | Today (ad-hoc) | → Convention |
|---|---|---|
| Primary action / link / header accent / hero band / ★ best | `sky-*`, `blue-*` | brand **primary/accent** (`text-primary`, `bg-primary`, `border-primary/…`, accent surface) |
| Positive (economical, savings, safety-margin OK) | `emerald-*` | a single positive green (a `--success`-style token or a pinned `emerald` kept intentionally) |
| Caution (оценка / estimate notes) | `amber-*` | a single caution amber (kept, but consistent shade) |
| Negative (не окупается, below break-even) | `red-*`, `text-red-600` | `text-destructive` / `destructive` token |
| Provenance badges | mixed | keep the 3 distinct hues (демо/организатор/источник) — they encode data, not brand |

Files: `components/site-header.tsx`, `components/calculator/{hero-results,recommendation-panel,sensitivity-chart,break-even-note,results-panel}.tsx`, `components/facility-visualization.tsx` (canvas robot/zone colors STAY — cyan robots now intentionally echo the accent), `components/provenance-badge.tsx` (unchanged — data hues), `components/economics-calculator.tsx`, `app/(app)/compare/[type]/page.tsx`, `app/(app)/report/[analysisId]/page.tsx`, `app/(auth)/{login,signup}/page.tsx`.

Add a small heading polish: `--font-heading` already maps to sans; apply consistent weight/tracking
to h1/h2 via a base layer rule (no per-component churn).

## Scope guard (YAGNI)
Visual-only. **No** layout/DOM restructuring, **no** behavior/logic/copy changes, **no** new
components, **no** dark-mode toggle (5d), **no** landing page (5b), **no** a11y-specific work beyond
the free contrast/ring wins (5c owns the audit). Same components, same props, same tests.

## Testing & verification
- `npm run build` exit 0; **all 127 unit + 3 E2E stay green** (E2E asserts text/roles, not colors —
  a built-in safety net that the visual refactor didn't break structure/flow).
- **Visual check (required — design isn't provable by tests):** run the app and capture screenshots
  of onboarding, compare, and calculate (light theme) to eyeball the new identity before merge.
  Present them at the review gate.
- Contrast: spot-check primary/accent/muted-foreground pairs meet AA (the deeper a11y audit is 5c).

## Out of scope (later #5 slices)
- 5b landing/intro page; 5c full WCAG AA pass; 5d dark-mode toggle + loading/empty states.
