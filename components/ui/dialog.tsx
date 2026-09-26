"use client";

import * as React from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Модальное окно — первое в приложении (docs/design/PROTOTYPE-DESIGN-SYSTEM.md §4.9: до этого
 * ни одного модала не было ни в одном компоненте). Анатомия — BCB: скрим с размытием (BCB
 * `.overlay`), сильная граница, rounded-panel (16px), shadow-pop — и именно поэтому shadow-pop
 * существовал в globals.css с первой волны порта, но был не подключен ни к чему: это первая
 * всплывающая поверхность в приложении.
 *
 * @base-ui/react/dialog, тот же примитив, что уже даёт кнопку/радио в этом репозитории
 * (components/ui/button.tsx, components/ui/radio-group.tsx) — не третья библиотека.
 */
function Dialog(props: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root {...props} />;
}

function DialogTrigger(props: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger {...props} />;
}

function DialogClose(props: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close {...props} />;
}

function DialogContent({
  className,
  children,
  showClose = true,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Popup> & { showClose?: boolean }) {
  return (
    <DialogPrimitive.Portal>
      {/* .glass (BCB): тот же приём, что и у site-rail/step-nav — тонированный фон + блюр,
          а не сплошной чёрный скрим. */}
      <DialogPrimitive.Backdrop className="glass fixed inset-0 z-[100] bg-background/40 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
      <DialogPrimitive.Popup
        className={cn(
          "shadow-pop fixed top-1/2 left-1/2 z-[100] w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2",
          "rounded-panel border-2 border-border bg-card p-6 text-card-foreground",
          "data-[ending-style]:scale-95 data-[ending-style]:opacity-0",
          "data-[starting-style]:scale-95 data-[starting-style]:opacity-0",
          "transition-all duration-150",
          className,
        )}
        {...props}
      >
        {children}
        {showClose && (
          <DialogClose className="tap-target absolute top-3 right-3 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
            <X size={16} aria-hidden={true} />
            <span className="sr-only">Закрыть</span>
          </DialogClose>
        )}
      </DialogPrimitive.Popup>
    </DialogPrimitive.Portal>
  );
}

function DialogTitle(props: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title className="panel-label" {...props} />;
}

function DialogDescription(props: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return <DialogPrimitive.Description className="text-sm text-muted-foreground" {...props} />;
}

export { Dialog, DialogTrigger, DialogClose, DialogContent, DialogTitle, DialogDescription };
