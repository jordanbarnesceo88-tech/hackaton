import Link from "next/link";
import { CATALOG_VIDEOS, CUSTOMER_VIDEO_AUDIT, FEATURED_CUSTOMER_VIDEOS, SHEET_VIDEOS, VIDEO_KIND_LABELS, videosForProduct, type CatalogVideo } from "@/lib/data/customer-videos";

const LINK = "tap-target inline-flex min-h-11 items-center text-sm font-medium text-primary underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4";
function date(value: string) { return value.split("-").reverse().join("."); }

function VideoEntry({ video, catalogLinks = false }: { video: CatalogVideo; catalogLinks?: boolean }) {
  return <article data-video-id={video.id} className="min-w-0 py-5">
    <p className="text-sm font-medium">{VIDEO_KIND_LABELS[video.kind]}</p>
    <h3 className="mt-2 text-base font-semibold leading-snug [overflow-wrap:anywhere]">{video.title}</h3>
    <p className="mt-2 max-w-prose text-sm text-muted-foreground">{video.scope}</p>
    <p className="mt-2 text-sm">Издатель: {video.publisher} · {video.publisherRole}</p>
    <p className="mt-1 text-xs text-muted-foreground">{video.platform} · опубликовано {date(video.publishedAt)} · проверено {date(video.checkedAt)}</p>
    {video.products.length === 0 && <p className="mt-2 text-sm text-muted-foreground">Без привязки к модели каталога: {video.bindingNote}</p>}
    <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1">
      <a href={video.url} target="_blank" rel="noopener noreferrer" className={LINK} aria-label={`Смотреть «${video.title}» на ${video.platform} (новая вкладка)`}>Смотреть на {video.platform} <span aria-hidden="true" className="ml-1">↗</span></a>
      {catalogLinks && video.products.map(product => <Link key={product.slug} prefetch={false} href={`/catalog/${product.slug}#customer-videos`} className={LINK}>Карточка: {product.name}</Link>)}
    </div>
    <details className="mt-1 text-xs text-muted-foreground">
      <summary className="tap-target cursor-pointer py-2 underline underline-offset-4">Источник и границы проверки</summary>
      <p className="max-w-prose py-2">Тип материала определён по {video.descriptionPresent ? "названию и описанию автора" : "названию; описание отсутствует"}. Видео целиком не просмотрено. Доступность метаданных не гарантирует воспроизведение в вашем регионе. Заявления автора не являются замерами платформы.</p>
      {video.products.length > 0 && <p className="max-w-prose pb-2">{video.bindingNote}</p>}
      <a href={video.sourceUrl} target="_blank" rel="noopener noreferrer" className="tap-target inline-flex min-h-11 items-center underline underline-offset-4">{video.sourceLabel}<span className="sr-only"> (новая вкладка)</span></a>
    </details>
  </article>;
}

/** Existing catalog typography and dividers; external media loads only after following a watch link. */
export function CustomerVideos({ productSlug }: { productSlug?: string }) {
  const videos = productSlug ? videosForProduct(productSlug) : CATALOG_VIDEOS;
  if (!videos.length) return null;
  return <section id="customer-videos" aria-labelledby="customer-videos-title" className="scroll-mt-20 border-t border-border py-6">
    <h2 id="customer-videos-title" className="text-xl">{productSlug ? "Видео, отзывы и опыт внедрения" : "Отзывы заказчиков и видео внедрений"}</h2>
    <p className="mt-3 max-w-prose text-sm text-muted-foreground">Интервью, кейсы, обзоры и демонстрации. Тип материала и издатель указаны отдельно; опыт одного объекта не определяет результат вашего проекта.</p>
    {productSlug ? <ul className="mt-3 divide-y divide-border">{videos.map(video => <li key={video.id}><VideoEntry video={video} /></li>)}</ul> : <>
      <ul aria-label="Интервью и выступления представителей заказчиков" className="mt-3 grid divide-y divide-border lg:grid-cols-3 lg:gap-x-8 lg:divide-y-0">
        {FEATURED_CUSTOMER_VIDEOS.map(video => <li key={video.id}><VideoEntry video={video} catalogLinks /></li>)}
      </ul>
      <details className="mt-3 border-t border-border">
        <summary className="tap-target cursor-pointer py-4 text-base font-semibold underline underline-offset-4">Все {SHEET_VIDEOS.length} видеоматериалов из таблицы</summary>
        <p className="max-w-prose pb-3 text-sm text-muted-foreground">В том числе материалы о семействах и других модификациях. Если точная модель не установлена, ссылка остаётся доступной без перехода в карточку. Ещё {CUSTOMER_VIDEO_AUDIT.missingLinks} строк таблицы отмечены «не найдено» и не содержат видео.</p>
        <ul className="divide-y divide-border">{SHEET_VIDEOS.map(video => <li key={video.id}><VideoEntry video={video} catalogLinks /></li>)}</ul>
        <a href={CUSTOMER_VIDEO_AUDIT.sourceUrl} target="_blank" rel="noopener noreferrer" className={LINK}>Исходная таблица<span className="sr-only"> (новая вкладка)</span></a>
      </details>
    </>}
  </section>;
}
