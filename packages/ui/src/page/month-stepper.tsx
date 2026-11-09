import { ChevronLeft, ChevronRight } from "lucide-react"
import Link from "next/link"

import { Button } from "../ui/button"
import { cn } from "../utils"

import type { ReactNode } from "react"

interface MonthStepperProps {
  /** The month shown, "September 2026": said again as it changes. */
  label: ReactNode
  /** Steps back a month; none at the first month, where the button is disabled. */
  prev?: () => void
  /** Steps forward a month; none at the last month. */
  next?: () => void
  prevHref?: string
  nextHref?: string
  prevLabel?: string
  nextLabel?: string
  groupLabel?: string
  className?: string
}

/**
 * One 44 px "‹ September 2026 ›" control (MonthEnd.dc). A caller's `max-sm:flex-1` stretches it on a phone.
 * `prevHref`/`nextHref` step by URL (Plan's week): a link instead of a button, and `groupLabel` renames the group.
 * A step with neither is a disabled button.
 */
export function MonthStepper({ label, prev, next, prevHref, nextHref, prevLabel = "Previous month", nextLabel = "Next month", groupLabel = "Month", className }: MonthStepperProps) {
  // 42 px inside the 44 px border, on a touch screen too: the box is the target.
  const step = "size-[42px] rounded-[9px] text-subtle-foreground hover:bg-muted pointer-coarse:min-h-0 pointer-coarse:min-w-0"
  const button = (href: string | undefined, onClick: (() => void) | undefined, label: string, icon: ReactNode) =>
    href ? (
      <Button variant="ghost" size="icon" className={step} asChild>
        <Link href={href} aria-label={label}>
          {icon}
        </Link>
      </Button>
    ) : (
      <Button type="button" variant="ghost" size="icon" className={step} aria-label={label} disabled={!onClick} onClick={onClick}>
        {icon}
      </Button>
    )
  return (
    <div role="group" aria-label={groupLabel} className={cn("inline-flex h-11 items-center justify-between rounded-[10px] border bg-background", className)}>
      {button(prevHref, prev, prevLabel, <ChevronLeft aria-hidden />)}
      <span aria-live="polite" className="min-w-32 px-1 text-center text-[15px] font-medium sm:text-sm">
        {label}
      </span>
      {button(nextHref, next, nextLabel, <ChevronRight aria-hidden />)}
    </div>
  )
}
