"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import { preload } from "react-dom";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Illustration } from "@/components/illustration";
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
  /**
   * Рисунок шага, 16:9 (public/onboarding, собираются scripts/illustrations): не
   * снимок экрана, а метафора шага — главное действие делает чёрный человечек.
   */
  image: string;
  /** Что нарисовано: метафору не восстановить из текста шага, поэтому alt её пересказывает. */
  imageAlt: string;
  text: string;
};

/** Восемь карточек — те же шаги и порядок, что в components/project/step-nav.tsx (TZ_STEPS). */
const STEPS: readonly TourStep[] = [
  {
    title: "1. Объект",
    image: "/onboarding/01-object.svg",
    imageAlt:
      "Рисунок: чёрный человечек автоматом-хваталкой достаёт склад из кучи игрушечных объектов, рядом аэропорт и медучреждение; на пульте кнопки «демо» и «свои»",
    text: "Выбираете тип объекта — склад, аэропорт или медучреждение — и берёте демо-данные или вводите свои.",
  },
  {
    title: "2. Параметры",
    image: "/onboarding/02-params.svg",
    imageAlt:
      "Рисунок: человечек снимает мерки со склада портновским сантиметром; на складе бирка — площадь, спрос в сутки, численность",
    text: "Указываете площадь, объёмы операций и численность персонала: от них зависит весь расчёт.",
  },
  {
    title: "3. Подбор",
    image: "/onboarding/03-match.svg",
    imageAlt:
      "Рисунок: человечек взял с ключницы-каталога ключ-робота и открыл им замок объекта; на ключе бирка «почему этот»",
    text: "Платформа подбирает роботизированные решения из каталога и объясняет, почему именно эти.",
  },
  {
    title: "4. Сравнение",
    image: "/onboarding/04-compare.svg",
    imageAlt:
      "Рисунок: три робота-варианта A, B и C стоят у одной ростовой стены, человечек заносит их в одну таблицу — окупаемость, NPV, парк",
    text: "Решения сравниваются по одним и тем же показателям: окупаемость, NPV, требуемый парк.",
  },
  {
    title: "5. Экономика",
    image: "/onboarding/05-economics.svg",
    imageAlt:
      "Рисунок: человечек крутит ручку допущений, и машина печатает чек — CAPEX, OPEX, окупаемость, NPV",
    text: "Платформа считает CAPEX, OPEX, срок окупаемости и NPV. Допущения можно поменять.",
  },
  {
    title: "6. Сценарии",
    image: "/onboarding/06-scenarios.svg",
    imageAlt:
      "Рисунок: из одной точки расходятся три дороги — покупка с крутым подъёмом вначале, услуга со шлагбаумами оплаты каждый месяц и «Как есть»; человечек смотрит на все три в тройную подзорную трубу",
    text: "«Как есть», покупка и услуга (RaaS) — в одной таблице: видно, что даёт каждый сценарий и во что обходится.",
  },
  {
    title: "7. Имитация",
    image: "/onboarding/07-simulation.svg",
    imageAlt:
      "Рисунок: человечек двигает фишки-роботы по плану склада, как в настольной игре; настоящие цифры записаны рядом в блокноте",
    text: "Имитация прогоняет расчётный парк через пиковый поток на планировке объекта и показывает, подтверждается ли расчёт.",
  },
  {
    title: "8. Отчёт",
    image: "/onboarding/08-report.svg",
    imageAlt:
      "Рисунок: человечек закрывается отчётом с источниками от вопросов «а цифры откуда?», вопросы отскакивают",
    text: "Сохраняете проект и получаете отчёт (PDF): его можно показать тем, кто будет проверять цифры.",
  },
];

export function OnboardingTour({
  triggerSize = "default",
  triggerClassName,
}: {
  triggerSize?: ButtonProps["size"];
  /** Раскладка кнопки в ряду вызывающего (например, во всю ширину на телефоне) — не её вид. */
  triggerClassName?: string;
}) {
  const open = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [index, setIndex] = useState(0);
  const nextRef = useRef<HTMLButtonElement>(null);
  const step = STEPS[index]!;
  const isFirst = index === 0;
  const isLast = index === STEPS.length - 1;
  // Рисунок следующего шага — заранее: по «Далее» он появляется сразу, а не догружается.
  if (open && !isLast) preload(STEPS[index + 1]!.image, { as: "image" });

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
        className={triggerClassName}
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
          {/* Рисунок шага, 16:9. Отступы: по бокам — поле окна, сверху и снизу по 16px, чтобы
              текст шага стоял рядом с картинкой, а не отдельно от неё. */}
          <Illustration src={step.image} alt={step.imageAlt} className="mt-4 aspect-video" />
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
