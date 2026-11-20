"use client"


import { ContentCard } from "@alter-ego/ui/page/content-card"
import { EmptyPrompt } from "@alter-ego/ui/page/empty-prompt"
import { SectionHeader } from "@alter-ego/ui/page/section-header"
import { cn } from "@alter-ego/ui/utils"
import { ChevronDown } from "lucide-react"
import { useId, useState } from "react"

import { Donut, HUES, REST, SHOWN } from "../dashboard/spending-by-category-card"

import type { CategorySpending } from "../../types"

interface WhereItWentCardProps {
  data: CategorySpending[]
  /** "October 2026": for the empty line. */
  period: string
  format: (amount: number) => string
}

interface Row {
  key: string
  name: string
  hint?: string
  amount: number
  percentage: number
  color: string
}

function Bar({ percentage, color }: { percentage: number; color: string }) {
  return (
    <span aria-hidden className="block h-1 overflow-hidden rounded-full bg-hairline max-sm:order-last max-sm:col-span-3">
      <span className="block h-full rounded-full" style={{ width: `${Math.min(percentage, 100)}%`, backgroundColor: color }} />
    </span>
  )
}

// Name, share bar, amount, %: one line from sm up; a phone puts the bar under the figures.
const LINE = "grid min-h-9 items-center gap-x-4 gap-y-1.5 py-1.5 max-sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_96px_56px]"

function Figures({ amount, percentage, format }: { amount: number; percentage: number; format: (n: number) => string }) {
  return (
    <>
      <span className="text-right font-medium tabular-nums">{format(amount)}</span>
      <span className="w-12 text-right text-[13px] text-muted-foreground tabular-nums sm:w-auto">{percentage.toFixed(1)}%</span>
    </>
  )
}

/** "Where It Went": the donut and every category with its share, in one card. */
export function WhereItWentCard({ data, period, format }: WhereItWentCardProps) {
  const listId = useId()
  // A desktop shows the whole breakdown; a phone folds the small categories into "Everything else".
  const [open, setOpen] = useState(() => typeof window !== "undefined" && !!window.matchMedia?.("(min-width: 640px)").matches)

  const total = data.reduce((sum, c) => sum + c.amount, 0)
  const top = data.slice(0, SHOWN)
  const rest = data.slice(SHOWN)

  const rows: Row[] = top.map((c, i) => ({
    key: c.categoryId,
    name: c.categoryName,
    amount: c.amount,
    percentage: c.percentage,
    color: HUES[i]!,
  }))
  const restRows: Row[] = rest.map((c) => ({ key: c.categoryId, name: c.categoryName, amount: c.amount, percentage: c.percentage, color: REST }))
  const everything: Row | null =
    rest.length > 0
      ? {
          key: "rest",
          name: "Everything else",
          hint: `${rest[0]!.categoryName}${rest.length > 1 ? `, ${rest[1]!.categoryName}` : ""}${rest.length > 2 ? ` and ${rest.length - 2} more` : ""}`,
          amount: rest.reduce((s, c) => s + c.amount, 0),
          percentage: rest.reduce((s, c) => s + c.percentage, 0),
          color: REST,
        }
      : null
  const slices = everything ? [...rows, everything] : rows
  const summary = slices.map((s) => `${s.name} ${format(s.amount)} (${s.percentage.toFixed(0)}%)`).join(", ")

  return (
    <ContentCard as="section" id="where" labelledBy="where-title" className="flex min-w-0 scroll-mt-20 flex-col gap-5">
      <SectionHeader
        variant="card"
        id="where-title"
        title="Where It Went"
        description={data.length > 0 ? `${format(total)} across ${data.length} ${data.length === 1 ? "category" : "categories"}` : undefined}
      />
      {data.length === 0 ? (
        <EmptyPrompt variant="inline" title={`No spending recorded in ${period}.`} />
      ) : (
        <div className="flex flex-wrap items-start gap-x-10 gap-y-5">
          <div className="max-sm:flex max-sm:w-full max-sm:justify-center">
            <Donut slices={slices} total={format(total)} label={`Spending by category in ${period}, ${format(total)} in all: ${summary}.`} />
          </div>
          <div className="min-w-0 flex-[1_1_360px]">
            <div aria-hidden className="hidden items-center gap-x-4 border-b border-hairline pb-2 text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase sm:grid sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_96px_56px]">
              <span>Category</span>
              <span>Share</span>
              <span className="text-right">Spent</span>
              <span className="text-right">%</span>
            </div>
            <ul className="flex flex-col text-sm">
              {rows.map((r) => (
                <li key={r.key} className={cn(LINE, "border-b border-hairline last:border-0")}>
                  <span className="flex min-w-0 items-center gap-2.5">
                    <span aria-hidden className="size-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: r.color }} />
                    <span className="truncate">{r.name}</span>
                  </span>
                  <Bar percentage={r.percentage} color={r.color} />
                  <Figures amount={r.amount} percentage={r.percentage} format={format} />
                </li>
              ))}
              {everything && (
                <li className="border-b border-hairline last:border-0">
                  <button
                    type="button"
                    aria-expanded={open}
                    aria-controls={listId}
                    onClick={() => setOpen((v) => !v)}
                    className={cn(LINE, "w-full text-left pointer-coarse:min-h-11")}
                  >
                    <span className="flex min-w-0 items-center gap-2.5">
                      <span aria-hidden className="size-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: REST }} />
                      <span className="flex min-w-0 flex-col">
                        <span>
                          Everything else <span className="text-muted-foreground">· {rest.length} {rest.length === 1 ? "category" : "categories"}</span>
                        </span>
                        <span className="truncate text-[13px] text-muted-foreground sm:hidden">{everything.hint}</span>
                      </span>
                    </span>
                    <Bar percentage={everything.percentage} color={REST} />
                    <span className="text-right font-medium tabular-nums">{format(everything.amount)}</span>
                    <span className="flex items-center justify-end gap-1 text-[13px] text-muted-foreground tabular-nums">
                      {everything.percentage.toFixed(1)}%
                      <ChevronDown aria-hidden className={cn("size-4 transition-transform motion-reduce:transition-none", open && "rotate-180")} />
                    </span>
                  </button>
                  <ul id={listId} className={cn("mb-1.5 ml-[22px] flex-col border-l border-hairline pl-3 text-sm", open ? "flex" : "hidden")}>
                    {restRows.map((r) => (
                      <li key={r.key} className={LINE}>
                        <span className="flex min-w-0 items-center gap-2.5">
                          <span className="truncate">{r.name}</span>
                        </span>
                        <Bar percentage={r.percentage} color={r.color} />
                        <Figures amount={r.amount} percentage={r.percentage} format={format} />
                      </li>
                    ))}
                  </ul>
                </li>
              )}
            </ul>
          </div>
        </div>
      )}
    </ContentCard>
  )
}
