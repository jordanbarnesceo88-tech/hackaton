// Reports how stale each cited product figure is, and exits non-zero past the threshold.
//
// docs/data-provenance.md promises a "verify before a live demo" gate on every real figure, but
// nothing enforced it — `lastVerified` was only checked for its date FORMAT, so a citation could
// silently rot for a year and still pass. This is deliberately a script rather than a unit test:
// a test that fails on a date boundary turns CI red for something no commit caused. Run it
// before a demo or a deploy (see docs/DEPLOY.md).
//
// RELATIVE import: this runs under tsx, which does not resolve the "@/" tsconfig alias.
import { WAREHOUSE_REAL } from "./parse-sources/warehouse-real";
import { SOLUTION_CLASSES } from "./seed-data/solution-classes";

const rawMax = Number(process.env.MAX_SOURCE_AGE_DAYS ?? 180);
if (!Number.isFinite(rawMax) || rawMax <= 0) {
  console.error(`MAX_SOURCE_AGE_DAYS must be a positive number, got "${process.env.MAX_SOURCE_AGE_DAYS}".`);
  process.exit(2);
}
const MAX_AGE_DAYS = rawMax;
const DAY_MS = 24 * 60 * 60 * 1000;

const now = Date.now();
let stale = 0;

// A class of solution carries TWO independent claims — a price range and a throughput range —
// taken from two different pages. Either can rot on its own, so both are listed separately
// rather than one row per row of data.
type Citation = { label: string; url: string; lastVerified: string };
const citations: Citation[] = [
  ...WAREHOUSE_REAL.map((s) => ({ label: s.name, url: s.sourceUrl, lastVerified: s.lastVerified })),
  ...SOLUTION_CLASSES.flatMap((c) => [
    { label: `${c.slug} (цена)`, url: c.sourceUrl, lastVerified: c.lastVerified },
    { label: `${c.slug} (произв.)`, url: c.capacitySourceUrl, lastVerified: c.lastVerified },
  ]),
];
const width = Math.max(...citations.map((c) => c.label.length));

console.log(`Citation freshness (threshold ${MAX_AGE_DAYS} days)\n`);
for (const s of citations) {
  const parsed = new Date(s.lastVerified).getTime();
  // An unparseable date produced NaN, and `NaN > MAX_AGE_DAYS` is false — so the one script
  // whose entire job is to refuse printed "ok NaNd" and exited 0. Treat it as the worst case.
  const ageDays = Number.isFinite(parsed) ? Math.floor((now - parsed) / DAY_MS) : null;
  const over = ageDays === null || ageDays > MAX_AGE_DAYS;
  if (over) stale++;
  const age = ageDays === null ? "  ??" : String(ageDays).padStart(4);
  console.log(
    `  ${over ? "STALE" : "ok   "} ${age}d  ${s.label.padEnd(width)}  ${s.url}` +
      (ageDays === null ? `  <- unparseable lastVerified: "${s.lastVerified}"` : "")
  );
}

if (stale > 0) {
  console.error(
    `\n${stale} citation(s) older than ${MAX_AGE_DAYS} days. Re-check the source pages and update ` +
      `lastVerified before showing these figures to anyone.`
  );
  process.exit(1);
}
console.log(`\nAll ${citations.length} citations are within ${MAX_AGE_DAYS} days.`);
