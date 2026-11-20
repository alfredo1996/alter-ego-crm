import type { RecurringTransaction } from "../types"

/** "Monthly", or "Every 2 weeks". */
export function cadenceLabel(r: Pick<RecurringTransaction, "frequency" | "interval">): string {
  const labels = { daily: ["Daily", "days"], weekly: ["Weekly", "weeks"], monthly: ["Monthly", "months"], yearly: ["Yearly", "years"] } as const
  const [one, many] = labels[r.frequency]
  return r.interval === 1 ? one : `Every ${r.interval} ${many}`
}

const isMonthly = (r: RecurringTransaction) => r.frequency === "monthly" && r.interval === 1

/**
 * The Recurring page's three figures (Recurring.dc): what the running rules move every month. Only
 * rules that repeat monthly are summed; the others are named beside them, not spread over twelve months.
 * ponytail: amounts are added as they are, whatever each rule's currency; a mixed-currency user would need conversion.
 */
export function summarizeRecurring(rules: RecurringTransaction[]) {
  const running = rules.filter((r) => r.isActive)
  const monthly = running.filter(isMonthly)
  const ins = monthly.filter((r) => r.type === "income")
  const outs = monthly.filter((r) => r.type !== "income")
  const sum = (list: RecurringTransaction[]) => list.reduce((s, r) => s + r.amount, 0)
  const rest = running.filter((r) => !isMonthly(r))
  return {
    monthlyIn: { total: sum(ins), names: ins.map((r) => r.description) },
    monthlyOut: { total: sum(outs), count: outs.length },
    other: rest.length
      ? {
          out: sum(rest.filter((r) => r.type !== "income")),
          in: sum(rest.filter((r) => r.type === "income")),
          names: rest.map((r) => r.description),
          yearlyOnly: rest.every((r) => r.frequency === "yearly" && r.interval === 1),
        }
      : null,
  }
}
