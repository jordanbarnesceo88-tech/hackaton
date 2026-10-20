import source from "./customer-videos.source.json";
import verification from "./customer-videos.verification.json";
import bindings from "./customer-videos.bindings.json";
import review from "./customer-videos.review.json";

export const VIDEO_KIND_LABELS = {
  "claimed-review": "Отзыв", "customer-interview": "Интервью с заказчиком",
  "customer-talk": "Выступление с участием заказчика",
  "customer-case": "Опыт заказчика", "author-case": "Кейс внедрения",
  demonstration: "Демонстрация", overview: "Обзор", instruction: "Инструкция", report: "Репортаж",
  conference: "Доклад", "supplier-interview": "Интервью с поставщиком",
} as const;
export type VideoKind = keyof typeof VIDEO_KIND_LABELS;
export type CatalogVideo = {
  id: string; title: string; url: string; platform: "YouTube" | "Rutube";
  publisher: string; publisherRole: string; kind: VideoKind; scope: string;
  products: readonly { slug: string; name: string }[]; bindingNote: string | null;
  checkedAt: string; publishedAt: string; descriptionPresent: boolean;
  sourceUrl: string; sourceLabel: string; origin: "sheet" | "supplemental";
};

const PRODUCT_NAMES: Readonly<Record<string, string>> = {
  "r2b-mark-2-se": "MARK 2 SE", "waybot-klinbotiks-400-pro": "Клинботикс 400 PRO", "yaku-unit": "Unit",
  "viggo-sc80": "VIGGO SC80", "avtomakon-ak-sc80": "АК-SC80", "pudu-cc1": "PUDU CC1", "agibot-c5": "AGIBOT C5",
  "ronavi-h1500": "Ronavi H1500", "robocv-shtabeler": "Робот-штабелёр RoboCV", "sm-robotics-mule": "MULE",
  "stelkon-pallet-shuttle": "Pallet Shuttle", "smp-tral-patrul-5": "Трал Патруль 5", "evocargo-n1": "EVOCARGO N1",
  "avtomakon-ai-stock-counter-12m": "AI Stock Counter 12M", "pudubot-2": "PuduBot 2", "pick-by-light": "Pick by light",
  "pick-by-voice": "Pick by Voice", "dikom-dmr-600": "DMR 600", "dikom-dmr-carrier-p": "DMR Carrier P", "dikom-dmr-300-carrier-b": "DMR 300 Carrier B",
};

/** Curated links only: no runtime requests, player embeds or inference of financial/operating evidence. */
export const SHEET_VIDEOS: readonly CatalogVideo[] = source.records.flatMap(row => {
  if (!row.url) return [];
  const id = `${row.sheetId}:${row.row}`, checked = verification.records.find(v => v.url === row.url);
  const content = review.records.find(v => v.sourceId === id), binding = bindings.exact.find(b => b.sourceId === id);
  const unbound = bindings.omitted.find(b => b.sourceId === id);
  if (!checked || !content || !(content.kind in VIDEO_KIND_LABELS) || (!binding && !unbound)) throw new Error(`Video audit incomplete: ${id}`);
  return [{ id, title: checked.title, url: row.url, platform: "YouTube", publisher: checked.authorName,
    publisherRole: row.publisherType ?? "Роль автора не указана", kind: content.kind as VideoKind,
    scope: content.summary ?? binding?.scope ?? unbound!.reason,
    products: (binding?.productSlugs ?? []).map(slug => {
      const name = PRODUCT_NAMES[slug]; if (!name) throw new Error(`Unknown video product: ${slug}`);
      return { slug, name };
    }), bindingNote: binding ? binding.scope : unbound!.reason,
    checkedAt: checked.checkedAt.slice(0, 10), publishedAt: checked.publishedAt, descriptionPresent: checked.descriptionPresent,
    sourceUrl: `${source.spreadsheetUrl}#gid=${row.sheetId}&range=A${row.row}:J${row.row}`,
    sourceLabel: `${row.sheetTitle}, строка ${row.row}`, origin: "sheet" }];
});

/** Separately found primary source; never presented as one of the spreadsheet's 65 links. */
export const SCHOOL_CC1_REVIEW: CatalogVideo = {
  id: "spi-wunderpark-cc1", title: "SPI robotics: КЕЙС ОТЗЫВ Школа Wunderpark PUDU CC1",
  url: "https://rutube.ru/video/e9d23b3512cbdbad16363a493cb88841/", platform: "Rutube", publisher: "SPI robotics", publisherRole: "Интегратор",
  kind: "customer-interview", scope: "По описанию SPI robotics: Иван Мальцев, представитель собственника школы Wunderpark, рассказывает о внедрении PUDU CC1. Это опыт конкретного объекта; его заявления об окупаемости и лифте не переносятся в расчёт.",
  products: [{ slug: "pudu-cc1", name: "PUDU CC1" }], bindingNote: "В названии и описании прямо указаны PUDU CC1 и школа Wunderpark.",
  checkedAt: "2026-10-20", publishedAt: "2025-07-03", descriptionPresent: true,
  sourceUrl: "https://rutube.ru/api/video/e9d23b3512cbdbad16363a493cb88841/", sourceLabel: "Страница и метаданные Rutube; дополнительный источник вне таблицы", origin: "supplemental",
};
export const CATALOG_VIDEOS: readonly CatalogVideo[] = [SCHOOL_CC1_REVIEW, ...SHEET_VIDEOS];
export function videosForProducts(productSlugs: readonly string[]): readonly CatalogVideo[] {
  const slugs = new Set(productSlugs);
  return CATALOG_VIDEOS.filter(video => video.products.some(product => slugs.has(product.slug)));
}
export function videosForProduct(productSlug: string): readonly CatalogVideo[] {
  return videosForProducts([productSlug]);
}
export const CUSTOMER_VIDEO_AUDIT = {
  sourceRecords: source.records.length, sourceLinks: SHEET_VIDEOS.length,
  duplicateLinks: SHEET_VIDEOS.length - new Set(SHEET_VIDEOS.map(v => v.url)).size,
  missingLinks: source.records.filter(r => !r.url).length,
  availableMetadata: verification.records.filter(r => r.httpStatus === 200 && r.pageHttpStatus === 200).length,
  unavailableMetadata: verification.records.filter(r => r.httpStatus !== 200 || r.pageHttpStatus !== 200).length,
  exactModelLinks: SHEET_VIDEOS.filter(v => v.products.length > 0).length,
  unboundLinks: SHEET_VIDEOS.filter(v => v.products.length === 0).length,
  descriptionsPresent: verification.records.filter(r => r.descriptionPresent).length,
  sourceUrl: source.spreadsheetUrl, checkedAt: source.readAt,
};
