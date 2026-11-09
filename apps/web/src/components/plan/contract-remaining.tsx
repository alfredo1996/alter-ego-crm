import { cn } from "@alter-ego/ui/utils"

import { contractRemaining, formatContractQuantity, inContractUnit, isOverBudget, unitMark } from "@/lib/engagements"

import type { ContractUnit } from "@/types"

type Input = Parameters<typeof contractRemaining>[0]

/**
 * Two lines under a contract's name: what is left of its budget and what the plan does not cover yet,
 * or, with no budget, what has been worked. Both lines always take their room (h-8, w-40: a figure growing never widens a column), so a figure
 * changing while typing never resizes or moves the table.
 */
export function ContractRemainingLines({ unit, id, ...input }: Input & { unit: ContractUnit | null | undefined; id?: string }) {
  const r = contractRemaining(input)
  const u = { unit }
  const mark = unitMark(unit ?? "day")
  // Unrounded days: below half a hundredth the figure shows 0, not "over plan".
  const over = r.cap && r.notPlanned < -0.005
  const overBudget = r.cap && isOverBudget({ total: r.total, used: r.worked })
  return (
    <div id={id} className="h-8 w-40 max-w-full overflow-hidden text-ellipsis whitespace-nowrap text-xs leading-4 text-muted-foreground">
      {r.cap ? (
        <>
          {overBudget ? (
            <div>
              <span className="font-medium text-danger">{formatContractQuantity(u, r.worked - r.total)} over budget</span> of{" "}
              {inContractUnit(r.total, unit ?? "day")}
            </div>
          ) : (
            <div>
              <span className="font-medium text-foreground">{formatContractQuantity(u, r.left)}</span> left of{" "}
              {inContractUnit(r.total, unit ?? "day")}
            </div>
          )}
          <div className={cn(over && "font-medium text-danger")}>
            {formatContractQuantity(u, Math.abs(r.notPlanned))} {over ? "over plan" : "not planned"}
          </div>
        </>
      ) : (
        <div>
          No cap · {inContractUnit(r.worked, unit ?? "day")} {mark} worked
        </div>
      )}
    </div>
  )
}
