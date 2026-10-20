"use client";

import Link from "next/link";
import { ChevronDown, PlayCircle } from "lucide-react";
import { Menu } from "@base-ui/react/menu";
import { OnboardingTour, openOnboardingTour } from "@/components/onboarding/onboarding-tour";
import { cn } from "@/lib/utils";

/**
 * Вкладка «Демо» в шапке: готовые демо-расчёты и тур «Как это работает». Раньше это были кнопки
 * первого экрана; владелец оставил там две основные (создать проект и сложный склад в 3D), а
 * остальное попросил собрать в навигации (2026-10-20). Одна вкладка-меню, а не три вкладки: с xl
 * шапка в один ряд и так почти занята.
 *
 * Окно тура живёт здесь, рядом с меню, а не внутри всплывающего списка: список закрывается
 * по нажатию пункта, и окно закрылось бы вместе с ним. Шапка есть на каждой странице, поэтому
 * тур теперь открывается отовсюду, а не только с главной.
 *
 * Список - тёмный, как шапка: он рисуется в портале, вне `.dark` шапки, поэтому класс задан
 * самому списку.
 */
const ITEM =
  "flex min-h-10 cursor-pointer items-center rounded-md px-3 py-2 text-sm text-foreground outline-none select-none data-[highlighted]:bg-muted";

export function DemoMenu({ triggerClassName }: { triggerClassName?: string }) {
  return (
    <>
      <Menu.Root modal={false}>
        <Menu.Trigger className={cn(triggerClassName, "cursor-pointer")}>
          <PlayCircle size={16} aria-hidden={true} />
          Демо
          <ChevronDown size={14} aria-hidden={true} className="-ml-1 opacity-70" />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner sideOffset={6} align="start" className="z-30">
            <Menu.Popup className="dark shadow-pop min-w-60 rounded-lg border border-border bg-popover p-1 text-popover-foreground outline-none">
              <Menu.LinkItem closeOnClick render={<Link href="/demo?example=steady-flow" />} className={ITEM}>
                Открыть демо-расчёт склада
              </Menu.LinkItem>
              <Menu.LinkItem closeOnClick render={<Link href="/demo?example=warehouse-cleaning" />} className={ITEM}>
                Уборка склада · расчёт
              </Menu.LinkItem>
              <Menu.Item onClick={openOnboardingTour} className={ITEM}>
                Как это работает
              </Menu.Item>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
      <OnboardingTour showTrigger={false} />
    </>
  );
}
