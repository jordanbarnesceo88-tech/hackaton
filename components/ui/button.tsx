import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * Кнопка — единственный источник формы, размера и поведения кнопки в приложении. Всё, что
 * выглядит как кнопка (Link, `<a download>`, нативный `<button>` в формах сервера), берёт
 * классы отсюда через `buttonVariants`, а не собирает свои `rounded-md border px-3 py-2`.
 *
 * Размеры — одна шкала, общая с полями ввода (`.field` в globals.css), чтобы кнопка рядом с
 * полем стояла вровень:
 *   xs  24px — крошечные действия внутри строки текста;
 *   sm  28px — действия в строках таблиц и списков;
 *   default 32px — действия внутри панели, тулбара, формы шага;
 *   lg  40px — главное действие страницы или формы (вход, «Создать проект», фильтры каталога);
 *   xl  48px — входы на первом экране и «Далее» в мастере.
 * В одном ряду — один размер; иерархию задаёт вариант (одна default-кнопка, остальные
 * outline/ghost), а не разный рост кнопок.
 */
const buttonVariantsBase = cva(
  // hover:-translate-y-px + active:translate-y-px: a 1px lift on hover, press back down on
  // click — reads as tactile without qualifying as the kind of large-scale motion
  // prefers-reduced-motion exists for (WCAG 2.3.3); still killed under it anyway, since the
  // rest of the app treats reduced-motion as a hard floor, not just for vestibular triggers.
  // ease-out, not the default linear transition-all: a hover response that starts fast and
  // settles reads as responsive; linear reads as mechanical at this duration.
  "group/button inline-flex shrink-0 cursor-pointer items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap outline-none select-none transition-[background-color,border-color,color,box-shadow,transform] duration-150 ease-out focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 hover:-translate-y-px active:not-aria-[haspopup]:translate-y-px motion-reduce:transition-[background-color,border-color,color,box-shadow] motion-reduce:hover:translate-y-0 motion-reduce:active:translate-y-0 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/80",
        // BCB's outline button signals hover by border-color, not a background fill — a prior
        // pass only changed the background, so outline buttons looked identical to a
        // background-only hover pattern that isn't actually theirs.
        // border-input (BCB --line-strong) в обеих темах: светлая тема раньше брала
        // --border (--line), рамка которого на фоне страницы почти не видна (~1.2:1), и
        // контурная кнопка читалась как голый текст рядом с залитой.
        outline:
          "border-input bg-background hover:border-primary hover:text-foreground aria-expanded:border-primary aria-expanded:text-foreground dark:bg-input/30 dark:hover:border-primary",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
        // BCB's ghost hover is text-only — the button never gains a background fill, only its
        // text (and, via currentColor, any inline svg) shifts to the accent.
        ghost:
          "hover:text-primary aria-expanded:text-primary",
        destructive:
          "bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        // px-3.5 (14px): BCB's base button horizontal padding — a prior pass used px-2.5
        // (10px), which read visibly tighter than the prototype.
        default:
          "h-8 gap-1.5 px-3.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        xs: "h-6 gap-1 rounded-[min(var(--radius-md),10px)] px-2 text-xs in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 rounded-[min(var(--radius-md),12px)] px-2.5 text-[0.8rem] in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        // 40px, px-4: вызывающие добавляли "px-4" сверху к прежнему h-9 px-3.5 — теперь это
        // и есть размер, без правок на месте.
        lg: "h-10 gap-1.5 px-4 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        // BCB's --btn--big (22px side padding, 18×18 icons), fitted to the 8px grid: 48px tall
        // by fixed height with centred content, no vertical padding — the prototype's 52px
        // (13px padding around a 24px line) was the one size off the shared control scale.
        xl: "h-12 gap-2 px-5.5 text-base has-data-[icon=inline-end]:pr-4 has-data-[icon=inline-start]:pl-4 [&_svg:not([class*='size-'])]:size-[18px]",
        icon: "size-8",
        "icon-xs":
          "size-6 rounded-[min(var(--radius-md),10px)] in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3",
        "icon-sm":
          "size-7 rounded-[min(var(--radius-md),12px)] in-data-[slot=button-group]:rounded-lg",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

/**
 * Классы кнопки для элементов, которые не `<Button>`: Link, `<a download>`, `<span>` на месте
 * недоступной ссылки. Результат cva прогоняется через tailwind-merge: база несёт
 * `border-transparent`, а outline — `border-input`, и без слияния в строке оставались обе
 * утилиты. Побеждала та, что позже в сгенерированном CSS, — `border-transparent`, поэтому у
 * каждой outline-ССЫЛКИ рамка была невидимой, а у outline-`<Button>` (он и раньше звал cn)
 * видимой: «Создать проект» и «Как это работает» на лендинге выглядели разными кнопками.
 */
function buttonVariants(props?: Parameters<typeof buttonVariantsBase>[0]): string {
  return cn(buttonVariantsBase(props))
}

type ButtonProps = ButtonPrimitive.Props & VariantProps<typeof buttonVariantsBase>

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonProps) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={buttonVariants({ variant, size, className })}
      {...props}
    />
  )
}

export { Button, buttonVariants, type ButtonProps }
