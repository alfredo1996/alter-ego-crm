import { cn } from "../utils"

import type { ReactNode } from "react"

const VALUE_TONE = {
  warning: "text-warning-soft-foreground",
  danger: "text-danger-soft-foreground",
}

interface StatCardProps {
  label: ReactNode
  value: ReactNode
  /** One muted line under the value. A phone's row leaves it out. */
  detail?: ReactNode
  /** Something waits on you: an overdue follow-up. The detail says what in words. */
  tone?: keyof typeof VALUE_TONE
  /** Under the detail: a bar, a legend, a status line. */
  children?: ReactNode
  className?: string
}

/**
 * A figure: label, value and detail, siblings in that order under one parent (tests read label → value).
 * The 220px basis is sm-only: in a phone's column strip it would become a minimum height.
 */
export function StatCard({ label, value, detail, tone, children, className }: StatCardProps) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-1.5 rounded-xl border bg-card px-[18px] py-4 text-card-foreground shadow-xs sm:flex-[1_1_220px] sm:px-[22px] sm:py-5",
        className,
      )}
    >
      <p className="text-meta text-subtle-foreground">{label}</p>
      <p
        data-slot="stat-value"
        className={cn("text-[26px] leading-tight font-semibold tracking-[-0.02em] tabular-nums", tone && VALUE_TONE[tone])}
      >
        {value}
      </p>
      {detail && (
        <p data-slot="stat-detail" className="text-meta text-muted-foreground tabular-nums">
          {detail}
        </p>
      )}
      {children}
    </div>
  )
}

interface StatStripProps {
  /** The headline StatCard: twice as wide, and still a card on a phone. */
  hero?: ReactNode
  /** The other StatCards. A phone stacks them as label → value rows in one card (CSS only, same DOM). */
  children: ReactNode
  "aria-label"?: string
  /**
   * What a phone shows. `rows` (default): label and value per row, no detail. `grid`: two columns of
   * label, value and detail, for four figures that each need their sentence (the Dashboard).
   */
  phone?: "rows" | "grid"
  /** Rows only: keep each detail line under its row, for a figure that is a comparison. */
  phoneDetail?: boolean
}

/** A page's figures in one row of cards. */
export function StatStrip({ hero, children, "aria-label": label = "Summary", phone = "rows", phoneDetail }: StatStripProps) {
  return (
    <section aria-label={label} className="flex flex-col gap-4 sm:flex-row sm:flex-wrap">
      {hero}
      {/* `contents` from sm up: the cards sit in the strip's row. On a phone this is the one card. */}
      <div
        className={cn(
          "rounded-xl border bg-card shadow-xs sm:contents",
          phone === "rows" && [
            "px-[18px] py-1",
            "max-sm:*:flex-row max-sm:*:flex-wrap max-sm:*:items-baseline max-sm:*:justify-between max-sm:*:gap-x-3 max-sm:*:rounded-none max-sm:*:border-0 max-sm:*:bg-transparent max-sm:*:px-0 max-sm:*:py-[11px] max-sm:*:shadow-none",
            "max-sm:*:not-first:border-t max-sm:*:not-first:border-hairline",
            "max-sm:**:data-[slot=stat-value]:text-[15px] max-sm:**:data-[slot=stat-value]:tracking-normal",
            !phoneDetail && "max-sm:**:data-[slot=stat-detail]:hidden",
            phoneDetail && "max-sm:**:data-[slot=stat-detail]:basis-full",
          ],
          // Hairlines between the cells: the grid's 1px gaps show the strip's own background.
          phone === "grid" &&
            "max-sm:grid max-sm:grid-cols-2 max-sm:gap-px max-sm:overflow-hidden max-sm:bg-hairline max-sm:*:rounded-none max-sm:*:border-0 max-sm:*:p-4 max-sm:*:shadow-none max-sm:**:data-[slot=stat-value]:text-[22px]",
        )}
      >
        {children}
      </div>
    </section>
  )
}
