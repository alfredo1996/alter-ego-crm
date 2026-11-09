import { ProgressBar } from "@alter-ego/ui/page/progress"
import { cn } from "@alter-ego/ui/utils"

import { inContractUnit } from "@/lib/engagements"

import type { AssignmentUsage } from "@/lib/assignments"
import type { ContractUnit } from "@/types"

/**
 * A collaborator's days on a contract: the meter, "7 of 26 days used · 19 left", this month's, and "over" in words.
 * An assignment with no end on a contract with no end has no total: it reads "7 days used" and the meter is this month's.
 * Stored days are shown in the contract's `unit`.
 */
export function AssignmentMeter({ usage, label, unit = "day", className }: { usage: AssignmentUsage; label: string; unit?: ContractUnit; className?: string }) {
  const over = usage.over.length > 0
  const n = (days: number) => inContractUnit(days, unit)
  const word = unit === "hour" ? "hours" : "days"
  const { month, planned } = usage
  const share = planned === null ? (month.planned > 0 ? month.used / month.planned : month.used > 0 ? 1 : 0) : planned > 0 ? usage.used / planned : usage.used > 0 ? 1 : 0
  return (
    <div className={cn("space-y-1.5", className)}>
      <ProgressBar label={label} value={share} tone={over ? "warning" : "default"} />
      <p className="text-meta tabular-nums text-subtle-foreground">
        {planned === null ? `${n(usage.used)} ${n(usage.used) === 1 ? word.slice(0, -1) : word} used` : `${n(usage.used)} of ${n(planned)} ${word} used · ${n(usage.left ?? 0)} left`} · this month {n(month.used)} of {n(month.planned)}
        {month.used > month.planned && <b className="font-medium text-foreground"> · over this month</b>}
      </p>
    </div>
  )
}
