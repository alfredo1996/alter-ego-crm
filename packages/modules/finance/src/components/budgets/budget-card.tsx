"use client"


import { ProgressBar } from "@alter-ego/ui/page/progress"
import { StatusPill } from "@alter-ego/ui/page/status-pill"
import { Button } from "@alter-ego/ui/ui/button"
import { Card } from "@alter-ego/ui/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@alter-ego/ui/ui/dropdown-menu"
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react"
import { useId } from "react"

import { getBudgetStatus } from "../../lib/budgets"
import { CategoryChip } from "../categories/category-chip"

import type { BudgetWithSpending, Category, Currency } from "../../types"

interface BudgetCardProps {
  budget: BudgetWithSpending
  categories: Category[]
  format: (amount: number, currency?: Currency) => string
  onEdit: (budget: BudgetWithSpending) => void
  onDelete: (budget: BudgetWithSpending) => void
}

/**
 * A thin mapping of `getBudgetStatus`, the rule the dashboard widget and the MCP tool share, so a
 * budget spent to exactly its limit, or spent at all against a limit of zero, reads "Over" everywhere.
 */
export function budgetState(budget: Pick<BudgetWithSpending, "spent" | "effectiveAmount">): "over" | "near" | "ok" {
  const status = getBudgetStatus(budget)
  return status === "danger" ? "over" : status === "warning" ? "near" : "ok"
}

/** "Over by €10.00"; spent to exactly the limit there is no amount to name: "Over limit". */
export function overLabel(b: Pick<BudgetWithSpending, "spent" | "effectiveAmount" | "currency">, format: BudgetCardProps["format"]): string {
  return b.spent > b.effectiveAmount ? `Over by ${format(b.spent - b.effectiveAmount, b.currency)}` : "Over limit"
}

export function BudgetCard({ budget, categories, format, onEdit, onDelete }: BudgetCardProps) {
  const id = useId()
  const category = budget.categoryId ? categories.find((c) => c.id === budget.categoryId) : null
  // A category that only repeats the name adds nothing; a budget on no category covers all expenses.
  const showCategory = !category || category.name.trim().toLowerCase() !== budget.name.trim().toLowerCase()
  const state = budgetState(budget)
  const used = Math.round(budget.percentage)

  return (
    <Card role="article" aria-labelledby={id} className="flex flex-col gap-3.5 p-5 sm:p-[22px]">
      <div className="flex min-h-6 items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-1.5 text-[13px] text-muted-foreground">
          <span className="capitalize">{budget.period}</span>
          {showCategory && (
            <>
              <span aria-hidden>·</span>
              {category ? <CategoryChip category={category} plain /> : "All expenses"}
            </>
          )}
        </span>
        <span className="flex shrink-0 items-center gap-0.5">
          {state === "over" ? (
            <StatusPill tone="danger">{overLabel(budget, format)}</StatusPill>
          ) : state === "near" ? (
            <StatusPill tone="warning">Near limit</StatusPill>
          ) : (
            <StatusPill tone="success">On track</StatusPill>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              {/* -my-2.5 -mr-3: a 44px target that adds no height and sits flush with the card's edge. */}
              <Button variant="ghost" size="icon-lg" className="-my-2.5 -mr-3 text-subtle-foreground" aria-label={`Actions for ${budget.name}`}>
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onEdit(budget)}>
                <Pencil className="mr-2 h-4 w-4" />
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onDelete(budget)} variant="destructive">
                <Trash2 className="mr-2 h-4 w-4" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </span>
      </div>
      <h2 id={id} className="truncate text-[19px] font-semibold tracking-tight">
        {budget.name}
      </h2>
      <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 tabular-nums">
        <span className="text-2xl font-semibold leading-tight tracking-tight">{format(budget.spent, budget.currency)}</span>
        <span className="text-sm text-muted-foreground">of {format(budget.effectiveAmount, budget.currency)}</span>
      </p>
      <ProgressBar
        value={budget.percentage / 100}
        tone={state === "over" ? "danger" : state === "near" ? "warning" : "default"}
        label={budget.spent === 0 ? `${budget.name}, nothing spent yet` : `${budget.name}, ${used}% of the limit used`}
      />
      <div className="mt-auto flex flex-wrap justify-between gap-x-4 gap-y-1 border-t border-hairline pt-3.5 text-[13px] text-subtle-foreground tabular-nums">
        <span>
          {state === "over" ? "No budget left" : `${format(budget.remaining, budget.currency)} left`}
          {budget.rolloverAmount !== 0 && (
            <>
              {" · "}
              {budget.rolloverAmount > 0 ? "+" : "−"}
              {format(Math.abs(budget.rolloverAmount), budget.currency)} rolled over
            </>
          )}
        </span>
        <span>{budget.spent === 0 ? "Nothing spent yet" : `${used}% used`}</span>
      </div>
    </Card>
  )
}
