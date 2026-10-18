import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Standalone geometry examples never inherit a project's input or return results to its opener. */
export function DemoSceneLinks({ project = false }: { project?: boolean }) {
  return <nav aria-label="Отдельные демонстрационные сцены" className="grid min-w-0 gap-2 border-t border-border pt-3" data-demo-scenes>
    <p className="text-xs text-muted-foreground">Отдельные демо геометрии и процессов{project ? ": откроются в новой вкладке, входы и результат проекта не изменятся." : ": собственные условия, отдельно от бизнес-примеров и текущего расчёта."}</p>
    <div className="flex min-w-0 flex-wrap gap-2">
      <Link href="/demo/warehouse?case=complex" target="_blank" rel="noopener noreferrer" className={cn(buttonVariants({ variant: "outline" }), "min-h-11 whitespace-normal")}>Сложный склад · отдельное демо ↗</Link>
      <Link href="/demo/cleaning" target="_blank" rel="noopener noreferrer" className={cn(buttonVariants({ variant: "outline" }), "min-h-11 whitespace-normal")}>Уборка · отдельное демо ↗</Link>
    </div>
  </nav>;
}
