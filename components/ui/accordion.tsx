import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Раскрывающийся пункт (вопрос → ответ) на нативных <details>/<summary>: работает без JS,
 * с клавиатуры и скринридером «из коробки», печатается раскрытым по умолчанию браузера.
 * Заголовок — h3 внутри summary (контентная модель summary это допускает), чтобы вопросы
 * оставались в оглавлении страницы для скринридера.
 */
export function AccordionItem({
  title,
  children,
  defaultOpen = false,
  className,
}: {
  title: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
  className?: string;
}) {
  return (
    <details open={defaultOpen} className={cn("group/acc border-b border-border", className)}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-5 transition-colors hover:text-primary [&::-webkit-details-marker]:hidden">
        <h3 className="section-title">{title}</h3>
        <span
          aria-hidden="true"
          className="grid size-8 shrink-0 place-items-center rounded-full border border-input transition-transform duration-200 group-open/acc:rotate-180 motion-reduce:transition-none"
        >
          <ChevronDown className="size-4" />
        </span>
      </summary>
      <div className="pb-6">{children}</div>
    </details>
  );
}

/** Список пунктов: общая верхняя линия, пункты разделены нижними. */
export function Accordion({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("border-t border-border", className)}>{children}</div>;
}
