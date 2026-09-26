"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import { Image as ImageIcon } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/**
 * Онбординг-тур по восьми шагам пути жюри (ТЗ §5.4): карточка на каждый шаг — картинка шага,
 * короткое объяснение, «Назад»/«Далее» и «Пропустить». Показывается один раз новому
 * посетителю на лендинге, дальше доступен по кнопке «Как это работает».
 *
 * Как и рейл (components/rail-nav.tsx), состояние «показывать ли» синхронизировано через
 * useSyncExternalStore с явным серверным снимком (false — на сервере тур никогда не открыт),
 * а не useState + запись в useEffect: последнее ловит react-hooks/set-state-in-effect под
 * --max-warnings=0 этого репозитория, а внешний источник (localStorage) — ровно тот случай,
 * для которого useSyncExternalStore и существует.
 */
const SEEN_KEY = "onboarding-tour-seen";
const listeners = new Set<() => void>();
let cachedOpen: boolean | null = null;

function readShouldOpen(): boolean {
  try {
    return window.localStorage.getItem(SEEN_KEY) !== "1";
  } catch {
    // Приватный режим/запрещённое хранилище — не навязываем тур насильно каждый раз.
    return false;
  }
}

function getSnapshot(): boolean {
  if (cachedOpen === null) cachedOpen = readShouldOpen();
  return cachedOpen;
}

function getServerSnapshot(): boolean {
  return false;
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

function markSeenAndClose() {
  cachedOpen = false;
  try {
    window.localStorage.setItem(SEEN_KEY, "1");
  } catch {
    // Не критично — просто предложится снова в следующий визит.
  }
  listeners.forEach((l) => l());
}

/** Повторный показ по кнопке «Как это работает» — не трогает флаг «видел», это разные вещи. */
function openTour() {
  cachedOpen = true;
  listeners.forEach((l) => l());
}

type TourStep = {
  title: string;
  /** Заглушка на месте будущей картинки шага — короткое описание для alt и для того, кто будет её рисовать. */
  imageAlt: string;
  text: string;
};

/** Восемь карточек — те же шаги и порядок, что в components/project/step-nav.tsx (TZ_STEPS). */
const STEPS: readonly TourStep[] = [
  {
    title: "1. Объект",
    imageAlt: "Выбор типа объекта: склад, аэропорт или медучреждение",
    text: "Выбираете тип объекта — склад, аэропорт или медучреждение — и берёте демо-данные или вводите свои.",
  },
  {
    title: "2. Параметры",
    imageAlt: "Форма параметров объекта: площадь, объём операций, занятость",
    text: "Указываете площадь, объём операций и занятость персонала по задачам — от этого считается всё дальше.",
  },
  {
    title: "3. Подбор",
    imageAlt: "Список предложенных роботизированных решений с объяснением выбора",
    text: "Платформа предлагает подходящие роботизированные решения из каталога, объясняя, почему именно эти.",
  },
  {
    title: "4. Сравнение",
    imageAlt: "Таблица сравнения решений по окупаемости, NPV и парку",
    text: "Варианты стоят рядом по одним и тем же показателям — окупаемость, NPV, требуемый парк.",
  },
  {
    title: "5. Экономика",
    imageAlt: "Панель расчёта CAPEX, OPEX и NPV с допущениями",
    text: "Полный расчёт CAPEX, OPEX, срока окупаемости и NPV — с допущениями, которые можно поменять.",
  },
  {
    title: "6. Сценарии",
    imageAlt: "Таблица сценариев: как есть, покупка, услуга (RaaS)",
    text: "«Как есть», покупка и услуга (RaaS) — в одной таблице, чтобы видеть компромисс между ними.",
  },
  {
    title: "7. Имитация",
    imageAlt: "2D-визуализация работы роботов на схеме объекта",
    text: "2D-визуализация показывает работу роботов на схеме объекта — цифры рядом текстом, движение иллюстративное.",
  },
  {
    title: "8. Отчёт",
    imageAlt: "Страница отчёта с сохранённым расчётом",
    text: "Сохраняете расчёт и выгружаете отчёт — с ним можно идти к тому, кто будет спорить с цифрами.",
  },
];

export function OnboardingTour({ triggerSize = "default" }: { triggerSize?: ButtonProps["size"] }) {
  const open = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [index, setIndex] = useState(0);
  const nextRef = useRef<HTMLButtonElement>(null);
  const step = STEPS[index]!;
  const isFirst = index === 0;
  const isLast = index === STEPS.length - 1;

  function next() {
    if (isLast) {
      markSeenAndClose();
      return;
    }
    setIndex((i) => i + 1);
  }

  function back() {
    // «Назад» исчезает на первом шаге. Фокус переводится на «Далее» до того, как кнопка
    // пропадёт, — иначе он падал бы на body, за пределы окна.
    if (index === 1) nextRef.current?.focus();
    setIndex((i) => Math.max(0, i - 1));
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size={triggerSize}
        onClick={() => {
          // С начала, а не с того шага, на котором тур закрыли: onOpenChange(true) здесь не
          // вызывается (окно открывается снаружи, не своим триггером), поэтому сброс — тут.
          setIndex(0);
          openTour();
        }}
      >
        Как это работает
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) markSeenAndClose();
        }}
      >
        {/* На 1/6 крупнее окна по умолчанию (просьба владельца, 2026-09-26): ширина 32rem ×
            7/6, поле 24px × 7/6 = 28px, основной текст 14px → 16px. Фокус при открытии — на
            «Далее»: главное действие тура, а не «Пропустить» первым по порядку. */}
        <DialogContent initialFocus={nextRef} className="max-w-[calc(32rem*7/6)] p-7">
          <DialogHeader>
            <DialogTitle>{step.title}</DialogTitle>
            <p className="text-xs text-muted-foreground">
              Шаг {index + 1} из {STEPS.length}
            </p>
          </DialogHeader>
          {/* Заглушка на месте будущей картинки шага (заказчик пришлёт свои иллюстрации) —
              нарочно оформлена как явное место-под-картинку (пунктир, подпись), а не мелкая
              иконка в кружке: последняя читалась дёшево на карточке такого размера. Держит
              16:9, чтобы вёрстка не прыгала, когда картинки появятся — просто заменить div на
              <img>/<Image> с тем же alt. Отступы: по бокам — поле окна, сверху и снизу по
              16px, чтобы текст шага стоял рядом с картинкой, а не отдельно от неё. */}
          <div
            role="img"
            aria-label={step.imageAlt}
            className="mt-4 flex aspect-video w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border bg-muted text-muted-foreground"
          >
            <ImageIcon size={32} aria-hidden={true} />
            <span className="px-6 text-center text-sm">{step.imageAlt}</span>
          </div>
          <DialogDescription className="mt-4 text-base text-foreground">{step.text}</DialogDescription>
          {/* Полоса прогресса — точки, не проценты: восемь коротких карточек, а не форма. */}
          <div className="mt-6 flex items-center gap-1.5" aria-hidden="true">
            {STEPS.map((s, i) => (
              <span
                key={s.title}
                className={cn(
                  "h-1.5 flex-1 rounded-full transition-colors",
                  // bg-border, не bg-muted: на белом --popover светлая тема теряла muted-полоски.
                  i <= index ? "bg-primary" : "bg-border",
                )}
              />
            ))}
          </div>
          <DialogFooter className="mt-6">
            {!isLast && (
              <Button type="button" variant="ghost" size="lg" onClick={markSeenAndClose}>
                Пропустить
              </Button>
            )}
            <div className="ml-auto flex items-center gap-2">
              {!isFirst && (
                <Button type="button" variant="outline" size="lg" onClick={back}>
                  Назад
                </Button>
              )}
              <Button ref={nextRef} type="button" size="lg" onClick={next}>
                {isLast ? "Начать" : "Далее"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
