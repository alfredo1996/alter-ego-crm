import { cn } from "../utils"

import type { HTMLAttributes } from "react"

/**
 * For a card's title link: it stretches over the whole card (which is `relative`),
 * and the card's own buttons sit above it with `relative z-10`. A link never wraps buttons.
 */
export const stretchedLink = "after:absolute after:inset-0"

const VARIANT = {
  default: "border bg-card text-card-foreground shadow-xs",
  // Nothing written yet: dashed, flat.
  dashed: "border-[1.5px] border-dashed border-border-strong bg-surface-subtle",
  warning: "border border-warning/40 bg-warning-soft/60 text-warning-soft-foreground",
}

interface ContentCardProps extends HTMLAttributes<HTMLElement> {
  /** An article by default, which also gives tests a role locator. */
  as?: "article" | "section" | "div"
  /** The id of the card's title. */
  labelledBy?: string
  variant?: keyof typeof VARIANT
  /** `none` for a card whose table or list runs to its edges. */
  padding?: "default" | "none"
}

/** A Card at 22px padding (18px on a phone): the block most pages are made of. */
export function ContentCard({
  as: Comp = "article",
  labelledBy,
  variant = "default",
  padding = "default",
  className,
  ...props
}: ContentCardProps) {
  return (
    <Comp
      aria-labelledby={labelledBy}
      // The Card's 14px radius (rounded-xl, --radius-xl) and padding variable.
      className={cn("relative rounded-xl", VARIANT[variant], padding === "default" && "p-(--card-padding)", className)}
      {...props}
    />
  )
}
