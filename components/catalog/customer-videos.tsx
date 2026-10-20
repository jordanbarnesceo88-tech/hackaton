import Link from "next/link";
import { videosForProducts, VIDEO_KIND_LABELS, type CatalogVideo } from "@/lib/data/customer-videos";

const LINK = "tap-target inline-flex min-h-11 items-center text-sm font-medium text-primary underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4";

function VideoEntry({ video, catalogLinks = false }: { video: CatalogVideo; catalogLinks?: boolean }) {
  return <article data-video-id={video.id} className="min-w-0 py-5">
    <p className="text-sm text-muted-foreground">{VIDEO_KIND_LABELS[video.kind]} · {video.publisher}</p>
    <h3 className="mt-2 text-base font-semibold leading-snug [overflow-wrap:anywhere]">{video.title}</h3>
    <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1">
      <a href={video.url} target="_blank" rel="noopener noreferrer" className={LINK} aria-label={`Смотреть «${video.title}» на ${video.platform} (новая вкладка)`}>Смотреть на {video.platform} <span aria-hidden="true" className="ml-1">↗</span></a>
      {catalogLinks && video.products.map(product => <Link key={product.slug} prefetch={false} href={`/catalog/${product.slug}#customer-videos`} className={LINK}>Карточка: {product.name}</Link>)}
    </div>
  </article>;
}

/** Existing catalog typography and dividers; external media loads only after following a watch link. */
export function CustomerVideos({ productSlug, productSlugs, id = "customer-videos" }: { productSlug?: string; productSlugs?: readonly string[]; id?: string }) {
  const videos = videosForProducts(productSlugs ?? (productSlug ? [productSlug] : []));
  if (!videos.length) return null;
  return <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-20 border-t border-border py-6">
    <h2 id={`${id}-title`} className="text-xl">{productSlugs ? "Видео по моделям сценария" : "Видео, отзывы и опыт внедрения"}</h2>
    <ul className="mt-3 divide-y divide-border">{videos.map(video => <li key={video.id}><VideoEntry video={video} catalogLinks={Boolean(productSlugs)} /></li>)}</ul>
  </section>;
}
