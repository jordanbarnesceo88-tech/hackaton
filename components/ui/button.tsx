import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  // hover:-translate-y-px + active:translate-y-px: a 1px lift on hover, press back down on
  // click — reads as tactile without qualifying as the kind of large-scale motion
  // prefers-reduced-motion exists for (WCAG 2.3.3); still killed under it anyway, since the
  // rest of the app treats reduced-motion as a hard floor, not just for vestibular triggers.
  // ease-out, not the default linear transition-all: a hover response that starts fast and
  // settles reads as responsive; linear reads as mechanical at this duration.
  "group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap outline-none select-none transition-[background-color,border-color,color,box-shadow,transform] duration-150 ease-out focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 hover:-translate-y-px active:not-aria-[haspopup]:translate-y-px motion-reduce:transition-[background-color,border-color,color,box-shadow] motion-reduce:hover:translate-y-0 motion-reduce:active:translate-y-0 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/80",
        // BCB's outline button signals hover by border-color, not a background fill — a prior
        // pass only changed the background, so outline buttons looked identical to a
        // background-only hover pattern that isn't actually theirs.
        outline:
          "border-border bg-background hover:border-primary hover:text-foreground aria-expanded:border-primary aria-expanded:text-foreground dark:border-input dark:bg-input/30 dark:hover:border-primary",
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
        lg: "h-9 gap-1.5 px-3.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        // BCB's --btn--big: the large touch-target variant for high-touch contexts (13px 22px
        // padding, 18×18 icons) — a prior pass had no size above `lg` at all.
        // h-[52px] not h-11: border(2) + py-[13px]×2(26) + text-base line-height(24) = 52px;
        // a fixed h-11 (44px) clipped/overflowed the label by ~8px on every xl button.
        xl: "h-[52px] gap-2 px-[22px] py-[13px] text-base has-data-[icon=inline-end]:pr-4 has-data-[icon=inline-start]:pl-4 [&_svg:not([class*='size-'])]:size-[18px]",
        icon: "size-8",
        "icon-xs":
          "size-6 rounded-[min(var(--radius-md),10px)] in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3",
        "icon-sm":
          "size-7 rounded-[min(var(--radius-md),12px)] in-data-[slot=button-group]:rounded-lg",
        "icon-lg": "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
