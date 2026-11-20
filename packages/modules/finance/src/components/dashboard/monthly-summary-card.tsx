import { formatMonthYear } from "@alter-ego/kernel/dates"
import { SignedAmount } from "@alter-ego/ui/page/signed-amount"
import { StatCard, StatStrip } from "@alter-ego/ui/page/stat-card"
import { format as formatDate, subMonths } from "date-fns"

import type { Currency, MonthlySummary } from "../../types"

interface MonthlySummaryCardProps {
  netWorth: number
  totalAssets: number
  totalLiabilities: number
  /** The last day of last month, and the net worth the newest snapshot on or before it holds. No snapshot: no change line. */
  lastMonthEnd?: Date
  /** undefined: still loading, the line's place is held so nothing below moves. null: no snapshot, no line. */
  lastMonthNetWorth?: number | null
  monthlyIncome: number
  monthlyExpenses: number
  /** A fraction of income: 0.59 is 59%. */
  monthlySavingsRate: number
  /** Last months' totals, to say how last month closed. */
  monthlySummary?: MonthlySummary[]
  format: (amount: number, currency?: Currency) => string
}

/** The four figures at the top: where you stand, what came in and went out this month, and how much of it you kept. */
export function MonthlySummaryCard({
  netWorth,
  totalAssets,
  totalLiabilities,
  lastMonthEnd,
  lastMonthNetWorth,
  monthlyIncome,
  monthlyExpenses,
  monthlySavingsRate,
  monthlySummary = [],
  format,
}: MonthlySummaryCardProps) {
  const now = new Date()
  const last = subMonths(now, 1)
  const before = monthlySummary.find((m) => m.month === formatDate(last, "yyyy-MM"))
  const lastName = formatDate(last, "MMMM")
  // To the cent: balances drift by float error under increment(), which must not read "Up €0.00".
  const change = lastMonthNetWorth == null ? 0 : Math.round((netWorth - lastMonthNetWorth) * 100) / 100

  return (
    <StatStrip aria-label={`${formatMonthYear(now)} at a glance`} phone="grid">
      <StatCard
        label="Net worth"
        value={format(netWorth)}
        detail={`Assets ${format(totalAssets)} · Liabilities ${format(totalLiabilities)}`}
      >
        {lastMonthNetWorth !== null && lastMonthEnd && (
          <p data-slot="stat-detail" className="text-meta text-muted-foreground tabular-nums">
            {lastMonthNetWorth === undefined ? (
              <span aria-hidden>&nbsp;</span>
            ) : (
              <>
                {change === 0 ? "No change" : `${change > 0 ? "Up" : "Down"} ${format(Math.abs(change))}`} since{" "}
                {formatDate(lastMonthEnd, "d MMMM")}
              </>
            )}
          </p>
        )}
      </StatCard>
      <StatCard
        label="This month in"
        value={<SignedAmount amount={monthlyIncome} kind="in" format={(n) => format(n)} className="font-semibold" />}
        detail={before && `${format(before.income)} in all of ${lastName}`}
      />
      <StatCard
        label="This month out"
        value={<SignedAmount amount={monthlyExpenses} kind="out" format={(n) => format(n)} className="font-semibold" />}
        detail={before && `${format(before.expenses)} in all of ${lastName}`}
      />
      <StatCard
        label="Savings rate"
        // The backends give a fraction (0.59), not a percentage: printed as is it read 0.6%.
        value={`${(monthlySavingsRate * 100).toFixed(1)}%`}
        detail={before && before.income > 0 ? `${lastName} closed at ${(((before.income - before.expenses) / before.income) * 100).toFixed(1)}%` : undefined}
      />
    </StatStrip>
  )
}
