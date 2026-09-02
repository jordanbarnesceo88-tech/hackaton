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

const MAX_AGE_DAYS = Number(process.env.MAX_SOURCE_AGE_DAYS ?? 180);
const DAY_MS = 24 * 60 * 60 * 1000;

const now = Date.now();
let stale = 0;

console.log(`Citation freshness (threshold ${MAX_AGE_DAYS} days)\n`);
for (const s of WAREHOUSE_REAL) {
  const ageDays = Math.floor((now - new Date(s.lastVerified).getTime()) / DAY_MS);
  const over = ageDays > MAX_AGE_DAYS;
  if (over) stale++;
  console.log(
    `  ${over ? "STALE" : "ok   "} ${String(ageDays).padStart(4)}d  ${s.name.padEnd(26)} ${s.sourceUrl}`
  );
}

if (stale > 0) {
  console.error(
    `\n${stale} citation(s) older than ${MAX_AGE_DAYS} days. Re-check the source pages and update ` +
      `lastVerified before showing these figures to anyone.`
  );
  process.exit(1);
}
console.log(`\nAll ${WAREHOUSE_REAL.length} citations are within ${MAX_AGE_DAYS} days.`);
