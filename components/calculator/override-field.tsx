"use client";

import { NumField } from "@/components/ui/num-field";

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
  onChange,
}: {
  id: string;
  label: string;
  /** Что даёт движок, если не вмешиваться. */
  computed: number;
  /** undefined = не переопределено. */
  value: number | undefined;
  format?: (n: number) => string;
  step?: number;
  onChange: (n: number | undefined) => void;
}) {
  const overridden = value !== undefined;

  return (
    <div className="flex flex-col gap-1">
      <NumField
        id={id}
        label={label}
        value={overridden ? value : computed}
        step={step}
        min={step < 1 ? 0 : 1}
        onChange={(n) => onChange(n)}
      />
      {overridden ? (
        <p className="flex flex-wrap items-center gap-x-2 text-xs">
          <span className="rounded bg-caution/15 px-1.5 py-0.5 font-medium text-caution">
            задано вами
          </span>
          <span className="text-muted-foreground">расчёт даёт {format(computed)}</span>
          <button
            type="button"
            onClick={() => onChange(undefined)}
            className="tap-target underline underline-offset-2 text-muted-foreground
              transition-colors hover:text-foreground
              focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            вернуть расчётное
          </button>
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">Вычислено по вашим параметрам.</p>
      )}
    </div>
  );
}
