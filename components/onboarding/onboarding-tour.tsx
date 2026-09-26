"use client";

import { useState, useSyncExternalStore } from "react";
import { Image as ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/**
 * Онбординг-тур по восьми шагам пути жюри (ТЗ §5.4): карточка на каждый шаг — иконка,
 * короткое объяснение, «Далее»/«Скип». Показывается один раз новому посетителю на лендинге,
 * дальше доступен по кнопке «Как это работает».
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

export function OnboardingTour() {
  const open = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [index, setIndex] = useState(0);
  const step = STEPS[index]!;
  const isLast = index === STEPS.length - 1;

  function handleOpenChange(next: boolean) {
    if (!next) markSeenAndClose();
  }

  function next() {
    if (isLast) {
      markSeenAndClose();
      return;
    }
    setIndex((i) => i + 1);
  }

  return (
    <>
      <Button type="button" variant="outline" onClick={openTour}>
        Как это работает
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          handleOpenChange(next);
          if (next) setIndex(0);
        }}
      >
        <DialogContent aria-describedby={undefined}>
          {/* Заглушка на месте будущей картинки шага (заказчик пришлёт свои иллюстрации) —
              нарочно оформлена как явное место-под-картинку (пунктир, подпись), а не мелкая
              иконка в кружке: последняя читалась дёшево на карточке такого размера. Держит
              16:9, чтобы вёрстка не прыгала, когда картинки появятся — просто заменить div на
              <img>/<Image> с тем же alt. */}
          <div
            role="img"
            aria-label={step.imageAlt}
            className="mb-4 flex aspect-video w-full flex-col items-center justify-center gap-1.5 rounded-md border-2 border-dashed border-border bg-muted text-muted-foreground"
          >
            <ImageIcon size={28} aria-hidden={true} />
            <span className="px-4 text-center text-xs">{step.imageAlt}</span>
          </div>
          <DialogTitle>{step.title}</DialogTitle>
          <p className="mb-2 text-xs text-muted-foreground">
            Шаг {index + 1} из {STEPS.length}
          </p>
          <DialogDescription className="text-sm text-foreground">{step.text}</DialogDescription>
          {/* Полоса прогресса — точки, не проценты: восемь коротких карточек, а не форма. */}
          <div className="mt-4 flex items-center gap-1.5" aria-hidden="true">
            {STEPS.map((s, i) => (
              <span
                key={s.title}
                className={cn(
                  "h-1.5 flex-1 rounded-full transition-colors",
                  i <= index ? "bg-primary" : "bg-muted",
                )}
              />
            ))}
          </div>
          <div className="mt-5 flex items-center justify-between gap-3">
            <Button type="button" variant="ghost" onClick={markSeenAndClose}>
              Скип
            </Button>
            <Button type="button" onClick={next}>
              {isLast ? "Начать" : "Далее"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
