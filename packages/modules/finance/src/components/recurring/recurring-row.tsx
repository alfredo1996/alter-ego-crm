"use client"

import { SignedAmount } from "@alter-ego/ui/page/signed-amount"
import { StatusPill, TagChip } from "@alter-ego/ui/page/status-pill"
import { Button } from "@alter-ego/ui/ui/button"
import { cn } from "@alter-ego/ui/utils"
import { format as formatDate } from "date-fns"
import { Pencil, Trash2, Pause, Play, History } from "lucide-react"
import { useId } from "react"

import { RecurringHistory } from "./recurring-history"
import { cadenceLabel } from "../../lib/recurring-summary"
import { CategoryChip } from "../categories/category-chip"


import type { RecurringTransaction, Category, Currency } from "../../types"

/** The columns, shared with the header row in the shell. */
export const RULE_GRID = "grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 sm:grid-cols-[minmax(0,1fr)_120px_100px_140px_auto]"

interface RecurringRowProps {
  rule: RecurringTransaction
  categories: Category[]
  accountName?: string
  format: (amount: number, currency?: Currency) => string
  historyOpen?: boolean
  onEdit: (rule: RecurringTransaction) => void
  onDelete: (rule: RecurringTransaction) => void
  onToggle: (rule: RecurringTransaction) => void
  onHistory?: (rule: RecurringTransaction) => void
}

// Muted 44px ghost icons; Delete turns red only on hover or focus.
const ACTION = "size-11 text-subtle-foreground"

/** One rule: name and category, how often, next date, amount, and four actions. History opens under the row. */
export function RecurringRow({
  rule,
  categories,
  accountName,
  format,
  historyOpen = false,
  onEdit,
  onDelete,
  onToggle,
  onHistory,
}: RecurringRowProps) {
  const category = rule.categoryId ? categories.find((c) => c.id === rule.categoryId) : null
  const nameId = useId()
  const panelId = `history-${rule.id}`
  const thisYear = rule.nextDueDate.getFullYear() === new Date().getFullYear()
  const next = formatDate(rule.nextDueDate, thisYear ? "d MMM" : "d MMM yyyy")
  const loan = rule.loanMeta
    ? `Loan ${rule.loanMeta.annualRate}% · ${+(rule.loanMeta.termMonths / 12).toFixed(1)} yr`
    : null
  const describe = { "aria-describedby": nameId }

  return (
    <li className="border-t border-hairline first:border-t-0">
      <div className={cn(RULE_GRID, "items-center py-3 max-sm:px-[18px] sm:min-h-16 sm:pr-[22px] sm:pl-[22px]")}>
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span id={nameId} className="text-[15px] font-medium [overflow-wrap:anywhere]">
              {rule.description}
            </span>
            {!rule.isActive && <StatusPill>Paused</StatusPill>}
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-meta text-subtle-foreground">
            {category && <CategoryChip category={category} plain />}
            {category && accountName && <span aria-hidden>·</span>}
            {accountName && <span>{accountName}</span>}
            {loan && (
              <>
                <span aria-hidden>·</span>
                <span>{loan}</span>
              </>
            )}
          </div>
        </div>
        <SignedAmount
          amount={rule.amount}
          kind={rule.type === "income" ? "in" : "out"}
          format={(v) => format(v, rule.currency)}
          className="text-[15px] max-sm:col-start-2 max-sm:row-start-1 sm:col-start-4 sm:row-start-1 sm:text-right"
        />
        {/* A phone: both in one line under the name; from sm up, a column each. */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pt-2 text-meta text-subtle-foreground max-sm:col-span-2 max-sm:col-start-1 max-sm:row-start-2 sm:contents">
          <TagChip className="sm:col-start-2 sm:row-start-1 sm:justify-self-start">{cadenceLabel(rule)}</TagChip>
          <span className="font-mono text-[13px] text-foreground/80 sm:col-start-3 sm:row-start-1">
            {rule.isActive && <span className="sm:hidden">next </span>}
            {rule.isActive ? next : "—"}
          </span>
        </div>
        <div className="flex justify-end gap-0.5 max-sm:col-span-2 max-sm:col-start-1 max-sm:row-start-3 sm:col-start-5 sm:row-start-1">
          <Button
            variant="ghost"
            size="icon-lg"
            className={ACTION}
            onClick={() => onToggle(rule)}
            aria-label={rule.isActive ? "Pause" : "Resume"}
            {...describe}
          >
            {rule.isActive ? <Pause /> : <Play />}
          </Button>
          {onHistory && (
            <Button
              variant="ghost"
              size="icon-lg"
              className={cn(ACTION, historyOpen && "bg-accent text-foreground")}
              onClick={() => onHistory(rule)}
              aria-label="History"
              aria-expanded={historyOpen}
              aria-controls={historyOpen ? panelId : undefined}
              {...describe}
            >
              <History />
            </Button>
          )}
          <Button variant="ghost" size="icon-lg" className={ACTION} onClick={() => onEdit(rule)} aria-label="Edit" {...describe}>
            <Pencil />
          </Button>
          <Button
            variant="ghost"
            size="icon-lg"
            className={cn(ACTION, "hover:text-destructive focus-visible:text-destructive")}
            onClick={() => onDelete(rule)}
            aria-label="Delete"
            {...describe}
          >
            <Trash2 />
          </Button>
        </div>
      </div>
      {historyOpen && <RecurringHistory rule={rule} id={panelId} format={format} />}
    </li>
  )
}
