import { Wallet } from "lucide-react"

import { cn } from "../utils"

interface BrandMarkProps {
  /** Shows "Alter Ego" beside the tile; without it the name is still there for a screen reader. */
  withName?: boolean
  className?: string
}

/**
 * The app's mark: a 28px tile with the wallet glyph, and the name at 17px (plan §2).
 * Spans only, so it can sit inside a heading (the nav sheet's title).
 */
export function BrandMark({ withName = false, className }: BrandMarkProps) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <span aria-hidden className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
        <Wallet className="size-4" />
      </span>
      <span className={cn(withName ? "text-[17px] font-semibold tracking-tight text-foreground" : "sr-only")}>Alter Ego</span>
    </span>
  )
}
