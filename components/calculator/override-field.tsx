"use client";

import { useState } from "react";
import { NumField, NullableNumField } from "@/components/ui/num-field";

/**
 * Поле переопределения: число, заданное человеком вместо вычисленного.
 *
 * Требование, из которого вырос весь дизайн: **переопределённое число обязано быть видимо
 * помечено как переопределённое.** Продукт, который продаёт защищаемость вывода, не может
 * показывать введённую руками цифру рядом с вычисленной, никак их не различая — первый же
 * въедливый вопрос обрушит обещание целиком.
 *
 * Поэтому расчётное значение не прячется, а стоит рядом, и вернуться к нему можно одним
 * действием. Прятать расчётное было бы хуже, чем не давать переопределять вовсе.
 */
export function OverrideField({
  id,
  label,
  computed,
  value,
  format = (n) => String(n),
  step = 1,
  integer = false,
  onChange,
}: {
  id: string;
  label: string;
  /**
   * Что даёт движок, если не вмешиваться. `null` — движок ОТКАЗАЛСЯ считать.
   *
   * Было `number`, и вызывающий подставлял `computed ?? 1`: при вырожденном вводе поле
   * показывало единицу и подписывало её «вычислено по вашим параметрам», хотя движок в этот
   * момент возвращал invalid_inputs и не вычислил ничего. Придуманное число под подписью
   * «вычислено» — худший вид ошибки для продукта, который продаёт защищаемость вывода.
   */
  computed: number | null;
  /** undefined = не переопределено. */
  value: number | undefined;
  format?: (n: number) => string;
  step?: number;
  /** Целое ≥ 1 — как количество единиц. Иначе просто положительное. */
  integer?: boolean;
  onChange: (n: number | undefined) => void;
}) {
  const [rejected, setRejected] = useState<string | null>(null);
  const overridden = value !== undefined;

  // Предикат ровно тот же, что в движке и в валидации сохранения. Три места, решающие, что
  // такое годное переопределение, обязаны решать одинаково: иначе поле помечает «задано
  // вами» число, которым ничего не посчитано, а сохранение падает с общей «Ошибкой
  // сохранения», ничего не объясняя.
  const accepts = (n: number) =>
    integer ? Number.isInteger(n) && n >= 1 : Number.isFinite(n) && n > 0;

  // Движок не смог посчитать, и своего числа человек ещё не дал: показывать нечего, и
  // притворяться, что есть, нельзя. Поле остаётся пустым и вводимым — своё число здесь как
  // раз и есть способ сдвинуться с места.
  if (computed === null && !overridden) {
    return (
      <div className="flex flex-col gap-1">
        <NullableNumField
          id={id}
          label={label}
          value={null}
          min={integer ? 1 : 0}
          placeholder="расчёт невозможен — задайте своё"
          onChange={(n) => {
            if (n === null) return;
            if (accepts(n)) {
              setRejected(null);
              onChange(n);
              return;
            }
            setRejected(
              integer
                ? "Количество единиц — целое число не меньше одной."
                : "Цена должна быть больше нуля."
            );
          }}
        />
        {rejected && <p className="text-xs text-destructive">{rejected}</p>}
        <p className="text-xs text-muted-foreground">
          При текущих параметрах движок это число не вычисляет — проверьте параметры выше или
          задайте своё.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <NumField
        id={id}
        label={label}
        value={overridden ? value : computed!}
        step={step}
        // База шага у input[type=number] — это min, поэтому при step=1000 и min=1 допустимыми
        // считались 1, 1001, 2001…, стрелка спиннера давала 48 001 вместо 48 500, а поле
        // помечалось :invalid по stepMismatch на любой реальной цене. Для нецелых полей
        // база должна быть кратна шагу.
        min={integer ? 1 : 0}
        onChange={(n) => {
          if (accepts(n)) {
            setRejected(null);
            onChange(n);
            return;
          }
          // Не принимаем и говорим почему. Молча округлить — значит показать число, которого
          // человек не вводил; принять и сломать сохранение — значит соврать пометкой.
          setRejected(
            integer
              ? "Количество единиц — целое число не меньше одной."
              : "Цена должна быть больше нуля."
          );
        }}
      />
      {rejected && <p className="text-xs text-destructive">{rejected}</p>}
      {overridden ? (
        <p className="flex flex-wrap items-center gap-x-2 text-xs">
          <span className="rounded bg-caution/15 px-1.5 py-0.5 font-medium text-caution">
            задано вами
          </span>
          <span className="text-muted-foreground">
            {computed === null ? "расчёт невозможен" : `расчёт даёт ${format(computed)}`}
          </span>
          {computed !== null && (
          <button
            type="button"
            onClick={() => {
              // И сообщение об отказе тоже: иначе красная надпись «Цена должна быть больше
              // нуля» остаётся висеть под полем, в котором уже стоит корректное расчётное
              // число, и утверждает неправду.
              setRejected(null);
              onChange(undefined);
            }}
            className="tap-target underline underline-offset-2 text-muted-foreground
              transition-colors hover:text-foreground
              focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            вернуть расчётное
          </button>
          )}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">Вычислено по вашим параметрам.</p>
      )}
    </div>
  );
}
