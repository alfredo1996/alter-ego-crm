"use client"

import { formatDate } from "@alter-ego/kernel/dates"
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

import type { SavingsGoalWithProgress, Currency } from "../../types"

interface SavingsGoalCardProps {
  goal: SavingsGoalWithProgress
  format: (amount: number, currency?: Currency) => string
  onEdit: (goal: SavingsGoalWithProgress) => void
  onDelete: (goal: SavingsGoalWithProgress) => void
  onAddFunds: (goal: SavingsGoalWithProgress) => void
}

const HEX = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i

/** The goal's colour at 12% for its icon tile; a colour that is not #rrggbb gets the muted tile. */
function tint(color: string) {
  const m = HEX.exec(color)
  return m ? `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, 0.12)` : undefined
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`

export function SavingsGoalCard({ goal, format, onEdit, onDelete, onAddFunds }: SavingsGoalCardProps) {
  const id = useId()
  const days = goal.daysRemaining
  const overdue = !goal.isCompleted && days !== null && days < 0
  const saved = Math.round(goal.percentage)
  // What it takes each month to arrive on the target date (a month is 30.4375 days).
  // Hidden in the last month, where dividing by a fraction of a month would exceed what is left.
  const perMonth = !goal.isCompleted && days !== null && days >= 31 ? Math.ceil(goal.remaining / (days / 30.4375)) : null

  return (
    <Card role="article" aria-labelledby={id} className="flex flex-col gap-4 p-5 sm:p-[22px]">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span
            aria-hidden
            className="inline-flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-muted text-xl"
            style={{ backgroundColor: tint(goal.color) }}
          >
            {goal.icon}
          </span>
          <h2 id={id} className="truncate text-[19px] font-semibold tracking-tight">
            {goal.name}
          </h2>
        </div>
        <span className="flex shrink-0 items-center gap-0.5">
          {goal.isCompleted ? (
            <StatusPill tone="success">Reached</StatusPill>
          ) : overdue ? (
            <StatusPill tone="danger">Overdue</StatusPill>
          ) : (
            <StatusPill tone="info">Saving</StatusPill>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              {/* -my-2.5 -mr-3: a 44px target that adds no height and sits flush with the card's edge. */}
              <Button variant="ghost" size="icon-lg" className="-my-2.5 -mr-3 text-subtle-foreground" aria-label={`Actions for ${goal.name}`}>
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onEdit(goal)}>
                <Pencil className="mr-2 h-4 w-4" />
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onDelete(goal)} variant="destructive">
                <Trash2 className="mr-2 h-4 w-4" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </span>
      </div>
      <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 tabular-nums">
        <span className="text-2xl font-semibold leading-tight tracking-tight">{format(goal.currentAmount, goal.currency)}</span>
        <span className="text-sm text-muted-foreground">of {format(goal.targetAmount, goal.currency)}</span>
      </p>
      <ProgressBar value={goal.percentage / 100} color={goal.color} label={`${goal.name}, ${saved}% saved`} />
      <p className="text-[13px] leading-normal text-subtle-foreground tabular-nums">
        {goal.isCompleted ? (
          "Goal reached!"
        ) : (
          <>
            {saved}% saved · {format(goal.remaining, goal.currency)} to go
            {perMonth !== null && ` · ${format(perMonth, goal.currency)} a month gets you there`}
          </>
        )}
      </p>
      <div className="mt-auto flex min-h-11 items-center justify-between gap-3 border-t border-hairline pt-3">
        <span className="flex min-w-0 flex-col gap-0.5">
          {goal.targetDate ? (
            <>
              <span className="font-mono text-[12.5px] text-foreground">{formatDate(goal.targetDate, "d MMM yyyy")}</span>
              <span className="text-[13px] text-subtle-foreground">
                {goal.isCompleted
                  ? "Target date"
                  : days === null
                    ? null
                    : days > 0
                      ? `${plural(days, "day")} left`
                      : days === 0
                        ? "Due today"
                        : `${plural(-days, "day")} overdue`}
              </span>
            </>
          ) : (
            <span className="text-[13px] text-subtle-foreground">No target date</span>
          )}
        </span>
        {!goal.isCompleted && (
          <Button variant="outline" size="lg" aria-label={`Add Funds to ${goal.name}`} aria-haspopup="dialog" onClick={() => onAddFunds(goal)}>
            Add Funds
          </Button>
        )}
      </div>
    </Card>
  )
}
