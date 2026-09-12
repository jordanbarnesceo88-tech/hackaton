// Reports how stale each cited product figure is, and exits non-zero past the threshold.
//
// docs/data-provenance.md promises a "verify before a live demo" gate on every real figure, but
// nothing enforced it — `lastVerified` was only checked for its date FORMAT, so a citation could
// silently rot for a year and still pass. This is deliberately a script rather than a unit test:
// a test that fails on a date boundary turns CI red for something no commit caused. Run it
// before a demo or a deploy (see docs/DEPLOY.md).
//
// ДВА РЕЖИМА, И ТОЛЬКО ОДИН ИЗ НИХ — ГЕЙТ:
//
//   npm run check:sources        # ГЕЙТ ДЕПЛОЯ (docs/DEPLOY.md §4c). Выход 1, если цитата из
//                                # строгого бакета старше порога ИЛИ если у любой цитаты —
//                                # хоть из строгого бакета, хоть из снимков — непригодная дата.
//   npm run report:snapshots     # ОТЧЁТ, НЕ ГЕЙТ. Печатает возраст рыночных снимков и всегда
//                                # выходит с нулём. Ставить его в деплой-гейт бессмысленно:
//                                # он по определению никогда не откажет.
//
// Порог: MAX_SOURCE_AGE_DAYS, умолчание 180 (lib/sources/registry.ts).
//
// Почему проверки две, а не одна. Единый порог валил сборку за цитату, которая ни в чём не
// виновата: цена, прочитанная на витрине 7 сентября, — это утверждение О СЕДЬМОМ СЕНТЯБРЯ, и
// через полгода оно ровно так же верно. Требование «обнови или собери красную сборку» на таком
// утверждении не даёт ничего, кроме привычки продлевать `lastVerified`, не открывая страницу, —
// а этой привычкой гейт свежести и убивается, причём сразу для тех цитат, где он был нужен.
// Разбор бакетов и их обоснование по каждому источнику — в lib/sources/registry.ts.
//
// RELATIVE import: this runs under tsx, which does not resolve the "@/" tsconfig alias.
// RELATIVE import: под tsx алиас "@/" не резолвится.
import {
  auditSources,
  resolveMaxAgeDays,
  type CitationAudit,
} from "../lib/sources/registry";

const SNAPSHOT_MODE = process.argv.includes("--snapshots");

const maxAgeDays = resolveMaxAgeDays();
if (maxAgeDays === null) {
  console.error(
    `MAX_SOURCE_AGE_DAYS must be a positive number, got "${process.env.MAX_SOURCE_AGE_DAYS}".`
  );
  process.exit(2);
}

// Список берётся из общего реестра, а не собирается здесь заново: два определения «списка
// источников» разъедутся, и разойдётся тот, который никто не открывает. По той же причине
// возраст и бакеты считает та же функция, что показывает /methodology.
const audit = auditSources({ maxAgeDays });

const claim = (a: CitationAudit) =>
  `${a.citation.label} (${a.citation.kind === "price" ? "цена" : "произв."})`;
const source = (a: CitationAudit) => a.citation.url ?? "(оценка, без страницы)";
const ageCell = (a: CitationAudit) => (a.ageDays === null ? "  ??" : String(a.ageDays).padStart(4));
const unparseable = (a: CitationAudit) =>
  a.ageDays === null ? `  <- unusable lastVerified: "${a.citation.lastVerified}"` : "";
const widthOf = (rows: CitationAudit[]) => Math.max(1, ...rows.map((a) => claim(a).length));

if (SNAPSHOT_MODE) {
  // Отчёт о снимках. Здесь НЕТ колонки вердикта, и это не упущение: колонка «ok/STALE» на
  // снимке означала бы, что у даты есть срок годности, — то самое утверждение, которое эта
  // проверка и опровергает. Дата и возраст показываются рядом, чтобы читатель решил сам.
  const width = widthOf(audit.snapshots);
  console.log(
    `Market snapshots — ages are reported, never judged (${audit.snapshots.length} citations).\n` +
      `The deploy gate is the other command: npm run check:sources\n`
  );
  for (const a of audit.snapshots) {
    console.log(
      `  ${a.citation.lastVerified}  ${ageCell(a)}d  ${claim(a).padEnd(width)}  ${source(a)}` +
        unparseable(a)
    );
  }
  const oldest = audit.snapshots[0];
  if (oldest && oldest.ageDays !== null) {
    console.log(
      `\nOldest snapshot: ${oldest.ageDays} days (${oldest.citation.lastVerified}). ` +
        `Age here is information for the reader, not a failure: a price observed on a given ` +
        `day stays true about that day.`
    );
  }
  const brokenDates = audit.undated.filter((a) => a.timeliness === "market-snapshot");
  if (brokenDates.length > 0) {
    // Единственная плохая новость, которую этот отчёт умеет сообщить, — что дату назвать
    // нельзя. Ронять он ей не будет (роняет гейт), но промолчать тоже не может: снимок без
    // даты не снимок, а число без источника во времени.
    console.log(
      `\n${brokenDates.length} snapshot(s) have an unusable lastVerified — a snapshot without a ` +
        `usable date is just an undated number. npm run check:sources fails on these.`
    );
  }
  process.exit(0);
}

// Гейт. Печатаются только цитаты строгого бакета: смешивать их со снимками в одной таблице
// значило бы вернуть ровно ту путаницу, ради устранения которой проверки разведены.
const width = widthOf(audit.gated);
console.log(
  `Freshness gate — citations that must still be true TODAY (threshold ${audit.maxAgeDays} days)\n`
);
for (const a of audit.gated) {
  // Непарсящаяся дата — худший случай, а не пропуск: скрипт, чья работа отказывать, однажды
  // печатал "ok NaNd" и выходил с нулём.
  console.log(
    `  ${a.overdue ? "STALE" : "ok   "} ${ageCell(a)}d  ${claim(a).padEnd(width)}  ${source(a)}` +
      unparseable(a)
  );
}

// Снимок отвечает не за возраст, а за то, что дату можно предъявить. Непригодная дата отнимает
// у него единственное основание не подчиняться порогу, поэтому гейт роняют и такие строки.
const undatedSnapshots = audit.undated.filter((a) => a.timeliness === "market-snapshot");
for (const a of undatedSnapshots) {
  console.log(`  BROKEN   ??d  ${claim(a)}  ${source(a)}${unparseable(a)}`);
}

const failures = audit.overdue.length + undatedSnapshots.length;
if (failures > 0) {
  console.error(
    `\n${failures} citation(s) must be re-checked: ${audit.overdue.length} older than ` +
      `${audit.maxAgeDays} days or undated in the gated bucket` +
      (undatedSnapshots.length > 0
        ? `, ${undatedSnapshots.length} snapshot(s) with an unusable date`
        : "") +
      `. Re-open the source pages and update lastVerified before showing these figures to anyone.`
  );
  process.exit(1);
}
console.log(
  `\nAll ${audit.gated.length} gated citations are within ${audit.maxAgeDays} days. ` +
    `${audit.snapshots.length} market snapshot(s) are dated observations and are not gated — ` +
    `npm run report:snapshots shows their age.`
);
