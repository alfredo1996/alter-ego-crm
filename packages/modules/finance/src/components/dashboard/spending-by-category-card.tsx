"use client"


import { ContentCard } from "@alter-ego/ui/page/content-card"
import { EmptyPrompt } from "@alter-ego/ui/page/empty-prompt"
import { SectionHeader } from "@alter-ego/ui/page/section-header"
import { cn } from "@alter-ego/ui/utils"
import Link from "next/link"

import type { CategorySpending, Currency } from "../../types"

interface SpendingByCategoryCardProps {
  categorySpending: CategorySpending[]
  /** "October": the period beside the title. */
  period: string
  format: (amount: number, currency?: Currency) => string
  className?: string
}

/**
 * Distinct hues by rank (Okabe-Ito, colour-blind safe), not each category's own colour: two
 * categories that share a colour made two slices of one hue. The legend carries every name.
 */
export const HUES = ["#0072b2", "#e69f00", "#009e73", "#cc79a7", "#56b4e9"]
export const REST = "#d4d4d4"
export const SHOWN = HUES.length

interface Slice {
  key: string
  name: string
  amount: number
  percentage: number
  color: string
  href?: string
}

export function Donut({ slices, total, label }: { slices: Slice[]; total: string; label: string }) {
  const r = 58
  const circumference = 2 * Math.PI * r
  // Where each slice starts, worked out up front: render must not mutate.
  const starts = slices.map((_, i) => slices.slice(0, i).reduce((sum, s) => sum + (s.percentage / 100) * circumference, 0))
  return (
    <svg width="150" height="150" viewBox="0 0 160 160" role="img" aria-label={label} className="shrink-0">
      <g transform="rotate(-90 80 80)" fill="none" strokeWidth="20">
        <circle cx="80" cy="80" r={r} stroke="currentColor" className="text-muted/40" />
        {slices.map((s, i) => {
          const length = (s.percentage / 100) * circumference
          return (
            <circle
              key={s.key}
              cx="80"
              cy="80"
              r={r}
              stroke={s.color}
              strokeDasharray={`${length} ${circumference - length}`}
              strokeDashoffset={-starts[i]}
            />
          )
        })}
      </g>
      <text x="80" y="76" textAnchor="middle" className="fill-muted-foreground text-[11px]">
        Total
      </text>
      <text x="80" y="96" textAnchor="middle" className="fill-foreground text-[15px] font-semibold">
        {total}
      </text>
    </svg>
  )
}

export function SpendingByCategoryCard({ categorySpending, period, format, className }: SpendingByCategoryCardProps) {
  const total = categorySpending.reduce((sum, cat) => sum + cat.amount, 0)
  const top = categorySpending.slice(0, SHOWN)
  const rest = categorySpending.slice(SHOWN)

  const slices: Slice[] = top.map((cat, i) => ({
    key: cat.categoryId,
    name: cat.categoryName,
    amount: cat.amount,
    percentage: cat.percentage,
    color: HUES[i],
    href: `/transactions?categoryId=${cat.categoryId}`,
  }))
  if (rest.length > 0) {
    slices.push({
      key: "rest",
      name: "Everything else",
      amount: rest.reduce((sum, c) => sum + c.amount, 0),
      percentage: rest.reduce((sum, c) => sum + c.percentage, 0),
      color: REST,
    })
  }
  const summary = slices.map((s) => `${s.name} ${format(s.amount)} (${s.percentage.toFixed(0)}%)`).join(", ")

  return (
    <ContentCard as="section" labelledBy="spending-title" className={cn("flex min-w-0 flex-col gap-4", className)}>
      <SectionHeader variant="card" id="spending-title" title="Spending by Category" description={period} />
      {slices.length === 0 ? (
        <EmptyPrompt variant="inline" title={`No spending recorded in ${period} yet.`} />
      ) : (
        <div className="flex flex-1 flex-wrap items-center gap-x-6 gap-y-4">
          <Donut slices={slices} total={format(total)} label={`Spending by category in ${period}, ${format(total)} in all: ${summary}.`} />
          <ul className="flex min-w-0 flex-[1_1_200px] flex-col gap-1 text-sm">
            {slices.map((s, i) => {
              const row = (
                <>
                  <span aria-hidden className="size-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: s.color }} />
                  <span className="min-w-0 flex-1 truncate">{s.name}</span>
                  <span className="font-medium tabular-nums">{format(s.amount)}</span>
                  <span className="w-9 text-right text-[13px] text-muted-foreground tabular-nums">{s.percentage.toFixed(0)}%</span>
                </>
              )
              const line = "flex min-h-7 items-center gap-2.5"
              return (
                <li key={s.key} className={cn(!s.href && i > 0 && "mt-1 border-t border-hairline pt-1.5 text-muted-foreground")}>
                  {s.href ? (
                    <Link href={s.href} className={cn(line, "rounded-sm hover:bg-accent/50 pointer-coarse:min-h-11")}>
                      {row}
                    </Link>
                  ) : (
                    <div className={line}>{row}</div>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </ContentCard>
  )
}
