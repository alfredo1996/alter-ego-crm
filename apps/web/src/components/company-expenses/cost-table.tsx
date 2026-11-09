"use client"


import { ContentCard } from "@alter-ego/ui/page/content-card"
import { DataTableCard } from "@alter-ego/ui/page/data-table-card"
import { StatusPill, TagChip } from "@alter-ego/ui/page/status-pill"
import { Button } from "@alter-ego/ui/ui/button"
import { format } from "date-fns"
import { ChevronDown, Pencil, Repeat, Trash2 } from "lucide-react"
import { useState } from "react"

import { COST_CATEGORY_LABELS, round2 } from "@/lib/cash-book"
import { eurCents } from "@/lib/invoices"

import { CostMoreMenu } from "./cost-more-menu"

import type { CompanyExpense } from "@/types"
import type { ReactNode } from "react"

/** Months shown before the rest fold away: three on a desktop, two on a phone. */
const DESKTOP_MONTHS = 3
const PHONE_MONTHS = 2

const vatOf = (e: CompanyExpense) => e.vat ?? 0
const sumOf = (costs: CompanyExpense[], f: (e: CompanyExpense) => number) => round2(costs.reduce((s, e) => s + f(e), 0))
const plural = (n: number) => `${n} ${n === 1 ? "cost" : "costs"}`
const monthName = (key: string, pattern = "MMMM") => format(new Date(`${key}-01T00:00:00`), pattern)

interface MonthGroup {
  key: string
  label: string
  costs: CompanyExpense[]
  amount: number
  vat: number
}

function groupByMonth(costs: CompanyExpense[]): MonthGroup[] {
  const sorted = [...costs].sort((a, b) => b.date.getTime() - a.date.getTime() || b.createdAt.getTime() - a.createdAt.getTime())
  const groups: MonthGroup[] = []
  for (const cost of sorted) {
    const key = format(cost.date, "yyyy-MM")
    const last = groups.at(-1)
    if (last?.key === key) last.costs.push(cost)
    else groups.push({ key, label: format(cost.date, "MMMM yyyy"), costs: [cost], amount: 0, vat: 0 })
  }
  for (const g of groups) {
    g.amount = sumOf(g.costs, (e) => e.amount)
    g.vat = sumOf(g.costs, vatOf)
  }
  return groups
}

/** The amount of a cost, a refund in words, and its VAT under it. */
function Amount({ cost, className }: { cost: CompanyExpense; className?: string }) {
  return (
    <span className={className}>
      <span className="font-medium">{cost.amount < 0 ? `Refund ${eurCents(-cost.amount)}` : eurCents(cost.amount)}</span>
      {cost.vat !== null && (
        <span className="block text-meta text-muted-foreground">{cost.vat === 0 ? "no VAT" : `+ VAT ${eurCents(Math.abs(cost.vat))}`}</span>
      )}
    </span>
  )
}

function Subtotal({ amount, vat }: { amount: number; vat: number }) {
  return (
    <>
      {eurCents(amount)} <span className="font-normal text-muted-foreground">+ VAT {eurCents(vat)}</span>
    </>
  )
}

interface CostTableProps {
  /** The one-off costs to show, in any order. */
  costs: CompanyExpense[]
  /** The estimate a cost pays, if it still exists. */
  estimateOf: (cost: CompanyExpense) => CompanyExpense | undefined
  /** How the cost was paid: the account, or a pill, and a line under it. */
  paidFrom: (cost: CompanyExpense) => { node: ReactNode; sub?: string }
  /** A collaborator's invoice: who, for which contract and month. */
  linkOf?: (cost: CompanyExpense) => string | null
  onEdit: (cost: CompanyExpense, opener: HTMLElement | null) => void
  onDelete: (cost: CompanyExpense) => void
  empty: ReactNode
}

/** One-off costs by month, newest first, each month with its subtotal. A table from sm up, cards on a phone. */
export function CostTable({ costs, estimateOf, paidFrom, linkOf, onEdit, onDelete, empty }: CostTableProps) {
  const [all, setAll] = useState(false)
  if (costs.length === 0) return <>{empty}</>
  const groups = groupByMonth(costs)
  const folded = (n: number) => groups.slice(n)
  const shown = (n: number) => (all ? groups : groups.slice(0, n))
  const total = { amount: sumOf(costs, (e) => e.amount), vat: sumOf(costs, vatOf) }
  const foldLabel = (n: number) => {
    const hidden = folded(n)
    // Newest first: name the range, not every month, so thirteen months of costs stay one line.
    const names = hidden.length === 1 ? hidden[0].label : `${monthName(hidden.at(-1)!.key, "MMM yyyy")} to ${monthName(hidden[0].key, "MMM yyyy")}`
    return `Show ${names} · ${plural(hidden.reduce((s, g) => s + g.costs.length, 0))}`
  }
  const footer = (n: number, className: string) => (
    <div className={className}>
      {!all && folded(n).length > 0 ? (
        <Button type="button" variant="ghost" size="lg" className="-ml-3 px-3 text-subtle-foreground" onClick={() => setAll(true)}>
          <ChevronDown aria-hidden />
          {foldLabel(n)}
        </Button>
      ) : (
        <span />
      )}
      <p className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 tabular-nums">
        <span className="text-meta text-muted-foreground">
          {groups.length === 1 ? "Total" : `Total since ${monthName(groups.at(-1)!.key, groups[0].key.slice(0, 4) === groups.at(-1)!.key.slice(0, 4) ? "MMMM" : "MMMM yyyy")}`}
        </span>
        <span className="text-[17px] font-semibold">{eurCents(total.amount)}</span>
        <span className="text-meta text-muted-foreground">+ VAT {eurCents(total.vat)}</span>
      </p>
    </div>
  )

  const chips = (cost: CompanyExpense) => {
    const pays = estimateOf(cost)
    return (
      <>
        {cost.documentRef && <TagChip>{cost.documentRef}</TagChip>}
        {pays && (
          <StatusPill tone="info">
            <Repeat aria-hidden className="size-3" />
            Recurring
            <span className="sr-only"> · Pays: {pays.description}</span>
          </StatusPill>
        )}
      </>
    )
  }
  const date = (cost: CompanyExpense) => `${cost.dateEstimated ? "~" : ""}${format(cost.date, "dd/MM")}`
  const category = (cost: CompanyExpense) => COST_CATEGORY_LABELS[cost.category] ?? cost.category

  return (
    <>
      <DataTableCard className="max-sm:hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm tabular-nums">
            <caption className="sr-only">One-off costs by month, newest first</caption>
            <thead>
              <tr className="border-b border-hairline">
                {["Description", "Category", "Paid From", "Date"].map((h) => (
                  <th key={h} scope="col" className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                    {h}
                  </th>
                ))}
                <th scope="col" className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  Amount
                </th>
                <th scope="col" className="w-24 px-4 py-2.5">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            {shown(DESKTOP_MONTHS).map((g) => (
              <tbody key={g.key} aria-label={g.label}>
                <tr className="border-b border-hairline bg-surface-subtle">
                  <th scope="rowgroup" colSpan={4} className="px-4 py-2.5 text-left text-sm font-semibold">
                    {g.label} <span className="font-normal text-muted-foreground">· {plural(g.costs.length)}</span>
                  </th>
                  <td className="px-4 py-2.5 text-right text-sm font-semibold whitespace-nowrap">
                    <Subtotal amount={g.amount} vat={g.vat} />
                  </td>
                  <td />
                </tr>
                {g.costs.map((cost) => {
                  const paid = paidFrom(cost)
                  return (
                    <tr key={cost.id} className="border-b border-hairline last:border-b-0 hover:bg-muted/50">
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                          <span className="font-medium">{cost.description}</span>
                          {chips(cost)}
                        </div>
                        {linkOf?.(cost) && <span className="block text-meta text-muted-foreground">{linkOf(cost)}</span>}
                      </td>
                      <td className="px-4 py-3">
                        <TagChip mono={false}>{category(cost)}</TagChip>
                      </td>
                      <td className="px-4 py-3">
                        {paid.node}
                        {paid.sub && <span className="block text-meta text-muted-foreground">{paid.sub}</span>}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-muted-foreground" title={cost.dateEstimated ? "Date estimated" : undefined}>
                        {date(cost)}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <Amount cost={cost} />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-0.5">
                          <Button variant="ghost" size="icon" className="text-subtle-foreground" onClick={(ev) => onEdit(cost, ev.currentTarget)} aria-label={`Edit ${cost.description}`}>
                            <Pencil aria-hidden />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-subtle-foreground hover:bg-danger-soft hover:text-danger-soft-foreground focus-visible:text-danger-soft-foreground"
                            onClick={() => onDelete(cost)}
                            aria-label={`Delete ${cost.description}`}
                          >
                            <Trash2 aria-hidden />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            ))}
          </table>
        </div>
        {footer(DESKTOP_MONTHS, "flex flex-wrap items-center justify-between gap-3 border-t border-hairline px-[22px] py-2")}
      </DataTableCard>

      {/* A phone: one card per cost, so how it was paid and its menu never go off screen. */}
      <div className="flex flex-col gap-4 sm:hidden">
        {shown(PHONE_MONTHS).map((g) => (
          <section key={g.key} aria-label={g.label} className="flex flex-col gap-2">
            <h3 className="flex items-baseline justify-between gap-3 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              {g.label}
              <span className="text-[13px] font-semibold tracking-normal text-foreground normal-case tabular-nums">
                <Subtotal amount={g.amount} vat={g.vat} />
              </span>
            </h3>
            <ContentCard as="div" padding="none">
              <ul>
                {g.costs.map((cost) => {
                  const paid = paidFrom(cost)
                  return (
                    <li key={cost.id} className="flex items-start gap-1 border-b border-hairline py-3 pr-1.5 pl-[18px] last:border-b-0">
                      <div className="flex min-w-0 flex-1 flex-col gap-1">
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="font-medium">{cost.description}</span>
                          <span className="font-medium whitespace-nowrap tabular-nums">
                            {cost.amount < 0 ? `Refund ${eurCents(-cost.amount)}` : eurCents(cost.amount)}
                          </span>
                        </div>
                        <div className="flex items-baseline justify-between gap-3 text-meta text-muted-foreground tabular-nums">
                          <span>
                            <span className="font-mono">{date(cost)}</span> · {category(cost)}
                          </span>
                          {cost.vat !== null && <span>{cost.vat === 0 ? "no VAT" : `+ VAT ${eurCents(Math.abs(cost.vat))}`}</span>}
                        </div>
                        {linkOf?.(cost) && <p className="text-meta text-muted-foreground">{linkOf(cost)}</p>}
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-meta text-subtle-foreground">
                          {chips(cost)}
                          <span>{paid.node}</span>
                          {paid.sub && <span className="text-muted-foreground">{paid.sub}</span>}
                        </div>
                      </div>
                      <CostMoreMenu name={cost.description} noun="Cost" onEdit={(el) => onEdit(cost, el)} onDelete={() => onDelete(cost)} />
                    </li>
                  )
                })}
              </ul>
            </ContentCard>
          </section>
        ))}
        {footer(PHONE_MONTHS, "flex flex-col gap-2")}
      </div>
    </>
  )
}
