"use client";

import { useId, useRef } from "react";

export type Choice = { value: string; label: string; hint?: string };

// Буквы для бейджей. Кириллица — потому что интерфейс русский и человек ищет глазами «Б», а
// не «B». Список кончается на 30 позициях: дальше бейджи перестают помогать (двузначные метки
// читаются медленнее, чем сам текст), и они просто не рисуются.
const BADGES = "АБВГДЕЖЗИКЛМНОПРСТУФХЦЧШЩЭЮЯ".split("");

/**
 * Выбор одного варианта из списка.
 *
 * Не радиокнопки: при 12 отраслях и 47 типах объектов список радиокнопок — это экран, по
 * которому ползут глазами. Плитка даёт крупную цель для мыши и палец, а буквенный бейдж —
 * выбор одним нажатием с клавиатуры.
 *
 * Роли расставлены руками, а не взяты из библиотеки, потому что поведение специфично:
 * стрелки перемещают выбор внутри группы, буква выбирает сразу, и в таб-порядке группа
 * занимает одну остановку (roving tabindex), а не сорок семь.
 */
export function ChoiceTiles({
  items,
  value,
  onChange,
  label,
}: {
  items: Choice[];
  value: string | null;
  onChange: (value: string) => void;
  label: string;
}) {
  // Префикс для id имени и подсказки: на странице может быть больше одной группы.
  const groupId = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const activeIndex = Math.max(0, items.findIndex((i) => i.value === value));

  function move(to: number) {
    const next = (to + items.length) % items.length;
    onChange(items[next]!.value);
    refs.current[next]?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent, index: number) {
    if (e.key === "ArrowDown" || e.key === "ArrowRight") { e.preventDefault(); move(index + 1); return; }
    if (e.key === "ArrowUp" || e.key === "ArrowLeft") { e.preventDefault(); move(index - 1); return; }
    if (e.key === "Home") { e.preventDefault(); move(0); return; }
    if (e.key === "End") { e.preventDefault(); move(items.length - 1); return; }
    // Буква выбирает сразу. Сравниваем в верхнем регистре: раскладка может быть любой, а
    // Caps Lock не должен ломать подсказку, которую мы сами же нарисовали.
    const k = e.key.toUpperCase();
    const byBadge = BADGES.indexOf(k);
    if (byBadge >= 0 && byBadge < items.length) { e.preventDefault(); move(byBadge); }
  }

  return (
    <div role="radiogroup" aria-label={label} className="flex flex-col gap-2">
      {items.map((item, i) => {
        const selected = item.value === value;
        const badge = BADGES[i];
        // Имя радиокнопки — название варианта, а описание — отдельно от имени.
        //
        // По умолчанию имя вычисляется из содержимого кнопки, поэтому подсказка попадала
        // ВНУТРЬ имени: у типов объектов она длиной в три предложения, и скринридер
        // объявлял каждый из сорока семи вариантов трёхсотзначной фразой вместо слова
        // «Склад». Это та же порча имени, от которой уже закрыт бейдж чуть ниже, только
        // в разы больнее — там лишняя буква, здесь абзац.
        //
        // `aria-labelledby` перекрывает вычисление по содержимому, `aria-describedby`
        // отдаёт подсказку как описание: её читают после имени и после паузы, и её можно
        // прервать. Видимый текст при этом не меняется ни на пиксель.
        const labelId = `${groupId}-l${i}`;
        const hintId = `${groupId}-h${i}`;
        return (
          <button
            key={item.value}
            ref={(el) => { refs.current[i] = el; }}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-labelledby={labelId}
            aria-describedby={item.hint ? hintId : undefined}
            // Roving tabindex: группа — одна остановка в таб-порядке, а не сорок семь.
            tabIndex={i === activeIndex ? 0 : -1}
            onClick={() => onChange(item.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={`flex w-full items-center gap-3 rounded-lg border-2 px-4 py-3 text-left
              transition-colors outline-none
              focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2
              ${selected
                ? "border-primary bg-primary/5"
                : "border-border bg-card hover:border-muted-foreground"}`}
          >
            {badge && (
              // aria-hidden: бейдж — подсказка для глаз. Озвученный, он превращает «Склад»
              // в «А Склад», то есть портит ровно то имя, ради которого существует.
              <span
                aria-hidden="true"
                className={`grid size-7 shrink-0 place-items-center rounded border text-xs font-medium
                  ${selected ? "border-primary text-primary" : "border-border text-muted-foreground"}`}
              >
                {badge}
              </span>
            )}
            <span className="flex flex-col">
              <span id={labelId} className="font-medium">
                {item.label}
              </span>
              {item.hint && (
                <span id={hintId} className="text-sm text-muted-foreground">
                  {item.hint}
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
