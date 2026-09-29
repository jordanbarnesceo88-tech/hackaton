import Image from "next/image";
import { cn } from "@/lib/utils";

/**
 * Рисунок «от руки» (scripts/illustrations → public/<набор>/*.svg) на белом листе: рамка и
 * скругление — как у панелей, в тёмной теме лист чуть приглушён, чтобы не слепил. Белый фон — часть
 * рисунка (чёрный человечек на тёмном фоне пропал бы), поэтому лист остаётся листом в обеих темах.
 * SVG next/image отдаёт как есть, без оптимизатора; ширина и высота — из viewBox рисунка.
 */
export function Illustration({
  src,
  alt,
  width = 1600,
  height = 900,
  className,
}: {
  src: string;
  alt: string;
  width?: number;
  height?: number;
  className?: string;
}) {
  return (
    <Image
      src={src}
      alt={alt}
      width={width}
      height={height}
      className={cn("h-auto w-full rounded-lg border border-border bg-white dark:brightness-90", className)}
    />
  );
}
