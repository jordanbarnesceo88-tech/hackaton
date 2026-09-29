import Image, { type StaticImageData } from "next/image";
import { cn } from "@/lib/utils";

/**
 * Снимок экрана самого продукта для главной — в светлой и тёмной теме. Две картинки, видна
 * одна (по той же теме, что и страница: вариант `dark:` учитывает и настройку ОС, и класс
 * .dark). Обе загружаются лениво, поэтому браузер скачивает только видимую — так рекомендует
 * документация next/image (Theme detection); preload/eager здесь нельзя — скачались бы обе.
 *
 * Картинки — настоящие экраны демо-расчёта (scripts снимают их Playwright'ом), а не рисунки:
 * главная показывает то, что человек получит, открыв расчёт.
 */
export function ThemedScreenshot({
  light,
  dark,
  alt,
  sizes,
  className,
  fetchPriority,
}: {
  light: StaticImageData;
  dark: StaticImageData;
  alt: string;
  sizes: string;
  className?: string;
  fetchPriority?: "high" | "low" | "auto";
}) {
  const frame = cn(
    "h-auto w-full rounded-panel border border-border bg-card shadow-panel",
    className,
  );
  return (
    <>
      <Image src={light} alt={alt} sizes={sizes} fetchPriority={fetchPriority} className={cn(frame, "dark:hidden")} />
      <Image src={dark} alt={alt} sizes={sizes} fetchPriority={fetchPriority} className={cn(frame, "hidden dark:block")} />
    </>
  );
}
