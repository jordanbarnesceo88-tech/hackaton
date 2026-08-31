// Data-provenance badge: honest labelling of where a solution's data came from.
export function ProvenanceBadge({
  source,
  sourceUrl,
}: {
  source: string;
  sourceUrl: string | null;
}) {
  const base = "inline-block rounded px-1.5 py-0.5 text-[10px] font-medium";
  if (source === "ORGANIZER") {
    return <span className={`${base} bg-emerald-100 text-emerald-800`}>данные организатора</span>;
  }
  if (source === "PARSED") {
    return sourceUrl ? (
      <a href={sourceUrl} target="_blank" rel="noopener noreferrer"
        className={`${base} bg-blue-100 text-blue-800 underline`}>открытый источник ↗</a>
    ) : (
      <span className={`${base} bg-blue-100 text-blue-800`}>открытый источник</span>
    );
  }
  return <span className={`${base} bg-amber-100 text-amber-800`}>демо-данные</span>;
}
