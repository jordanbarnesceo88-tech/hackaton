// Reports how stale each cited product figure is, and exits non-zero past the threshold.
//
// docs/data-provenance.md promises a "verify before a live demo" gate on every real figure, but
// nothing enforced it — `lastVerified` was only checked for its date FORMAT, so a citation could
// silently rot for a year and still pass. This is deliberately a script rather than a unit test:
// a test that fails on a date boundary turns CI red for something no commit caused. Run it
// before a demo or a deploy (see docs/DEPLOY.md).
//
// RELATIVE import: this runs under tsx, which does not resolve the "@/" tsconfig alias.
// RELATIVE import: под tsx алиас "@/" не резолвится.
import { ALL_CITATIONS, citationAgeDays } from "../lib/sources/registry";

const rawMax = Number(process.env.MAX_SOURCE_AGE_DAYS ?? 180);
if (!Number.isFinite(rawMax) || rawMax <= 0) {
  console.error(`MAX_SOURCE_AGE_DAYS must be a positive number, got "${process.env.MAX_SOURCE_AGE_DAYS}".`);
  process.exit(2);
}
const MAX_AGE_DAYS = rawMax;

const now = Date.now();
let stale = 0;

// Список берётся из общего реестра, а не собирается здесь заново: два определения «списка
// источников» разъедутся, и разойдётся тот, который никто не открывает.
const citations = ALL_CITATIONS.map((c) => ({
  label: `${c.label} (${c.kind === "price" ? "цена" : "произв."})`,
  url: c.url,
  ageDays: citationAgeDays(c, now),
  lastVerified: c.lastVerified,
}));

const width = Math.max(...citations.map((c) => c.label.length));

console.log(`Citation freshness (threshold ${MAX_AGE_DAYS} days)\n`);
for (const c of citations) {
  // Непарсящаяся дата — худший случай, а не пропуск: скрипт, чья работа отказывать, однажды
  // печатал "ok NaNd" и выходил с нулём.
  const over = c.ageDays === null || c.ageDays > MAX_AGE_DAYS;
  if (over) stale++;
  const age = c.ageDays === null ? "  ??" : String(c.ageDays).padStart(4);
  console.log(
    `  ${over ? "STALE" : "ok   "} ${age}d  ${c.label.padEnd(width)}  ${c.url}` +
      (c.ageDays === null ? `  <- unparseable lastVerified: "${c.lastVerified}"` : "")
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
