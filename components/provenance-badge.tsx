// Data-provenance badge: honest labelling of where a solution's data came from.
export function ProvenanceBadge({
  source,
  sourceUrl,
  isClass = false,
}: {
  source: string;
  sourceUrl: string | null;
  isClass?: boolean;
}) {
  // These three keep distinct data-source hues on purpose — the badge's whole job is telling
// «данные организатора» from «открытый источник» from «демо-данные» at a glance, so they are
// deliberately not folded into the semantic tokens. They do need dark steps, though: a
// 100-level tint with 800-level text is unreadable on a dark surface.
const base = "inline-block rounded px-1.5 py-0.5 text-[10px] font-medium";
  if (source === "ORGANIZER") {
    return <span className={`${base} bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200`}>данные организатора</span>;
  }
  if (source === "PARSED") {
    return sourceUrl ? (
      <a href={sourceUrl} target="_blank" rel="noopener noreferrer"
        className={`${base} bg-blue-100 text-blue-800 underline dark:bg-blue-950 dark:text-blue-200`}>открытый источник ↗</a>
    ) : (
      <span className={`${base} bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200`}>открытый источник</span>
    );
  }
  // Класс решения — не демо-строка: у него есть опубликованный диапазон и ссылка, по правилу
  // «оба конца обоих диапазонов из источника, иначе класс не заводится». Метка «демо-данные»
  // на нём — не осторожность, а неверное утверждение, и ровно на том экране, который продаёт
  // проверяемость цифр.
  if (isClass) {
    return sourceUrl ? (
      <a href={sourceUrl} target="_blank" rel="noopener noreferrer"
        className={`${base} bg-blue-100 text-blue-800 underline dark:bg-blue-950 dark:text-blue-200`}>класс · открытый источник ↗</a>
    ) : (
      <span className={`${base} bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200`}>класс решений</span>
    );
  }
  return <span className={`${base} bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200`}>демо-данные</span>;
}
