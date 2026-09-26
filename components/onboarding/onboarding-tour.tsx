"use client";

import { useState, useSyncExternalStore } from "react";
import {
  Building2,
  Calculator,
  Columns3,
  FileText,
  GitBranch,
  ListChecks,
  PlayCircle,
  SlidersHorizontal,
} from "lucide-react";
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
  icon: React.ComponentType<{ size?: number; "aria-hidden"?: boolean; className?: string }>;
  text: string;
};

/** Восемь карточек — те же шаги и порядок, что в components/project/step-nav.tsx (TZ_STEPS). */
const STEPS: readonly TourStep[] = [
  {
    title: "1. Объект",
    icon: Building2,
    text: "Выбираете тип объекта — склад, аэропорт или медучреждение — и берёте демо-данные или вводите свои.",
  },
  {
    title: "2. Параметры",
    icon: SlidersHorizontal,
    text: "Указываете площадь, объём операций и занятость персонала по задачам — от этого считается всё дальше.",
  },
  {
    title: "3. Подбор",
    icon: ListChecks,
    text: "Платформа предлагает подходящие роботизированные решения из каталога, объясняя, почему именно эти.",
  },
  {
    title: "4. Сравнение",
    icon: Columns3,
    text: "Варианты стоят рядом по одним и тем же показателям — окупаемость, NPV, требуемый парк.",
  },
  {
    title: "5. Экономика",
    icon: Calculator,
    text: "Полный расчёт CAPEX, OPEX, срока окупаемости и NPV — с допущениями, которые можно поменять.",
  },
  {
    title: "6. Сценарии",
    icon: GitBranch,
    text: "«Как есть», покупка и услуга (RaaS) — в одной таблице, чтобы видеть компромисс между ними.",
  },
  {
    title: "7. Имитация",
    icon: PlayCircle,
    text: "2D-визуализация показывает работу роботов на схеме объекта — цифры рядом текстом, движение иллюстративное.",
  },
  {
    title: "8. Отчёт",
    icon: FileText,
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
          <div className="mb-4 flex items-center gap-3">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <step.icon size={22} aria-hidden={true} />
            </span>
            <div>
              <DialogTitle>{step.title}</DialogTitle>
              <p className="text-xs text-muted-foreground">
                Шаг {index + 1} из {STEPS.length}
              </p>
            </div>
          </div>
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
