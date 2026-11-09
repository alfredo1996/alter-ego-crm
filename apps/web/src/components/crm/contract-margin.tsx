import { eur } from "@alter-ego/kernel/currency"
import { formatYearMonth } from "@alter-ego/kernel/dates"
import { StatusPill } from "@alter-ego/ui/page/status-pill"

import { marginPct } from "@/lib/assignment-plan"
import { inContractUnit, unitMark } from "@/lib/engagements"

import type { MarginRow } from "@/lib/assignments"
import type { ContractUnit } from "@/types"

/** What the card shows of a contract that has collaborators on it: this quarter's months and who used what. */
export interface ContractMargin {
  /** "Q4 2026". */
  quarter: string
  rows: MarginRow[]
  total: Omit<MarginRow, "yearMonth" | "logged">
  /** What the contract counts in: its figures read in days or in hours. */
  unit: ContractUnit
  /** Anybody has an assignment on it or logged days: the table shows. */
  hasPeople: boolean
  /** "Giulia Neri", or "Collaborators" when there are several: the column's head. */
  herName: string
  /** Days logged on the contract by person (stored as days), the owner first: "used 28: you 21, Giulia Neri 7". */
  used: { name: string; days: number }[]
}

/** "Q margin 67%" for the card's head. */
export function MarginPill({ margin, quarter }: { margin: Pick<MarginRow, "margin" | "revenue">; quarter: string }) {
  return (
    <StatusPill tone="neutral">
      {quarter.split(" ")[0]} margin {marginPct(margin.margin, margin.revenue)}%
    </StatusPill>
  )
}

/** Days used by person, and the quarter's months: days billed, revenue, theirs, their cost and the margin. */
export function ContractMarginTable({ margin }: { margin: ContractMargin }) {
  const { rows, total } = margin
  const n = (days: number) => inContractUnit(days, margin.unit)
  const mark = unitMark(margin.unit)
  return (
    <div className="flex flex-col gap-2.5 border-t border-hairline pt-4 text-sm">
      <p className="tabular-nums text-subtle-foreground">
        Used {n(margin.used.reduce((s, u) => s + u.days, 0))}: {margin.used.map((u) => `${u.name} ${n(u.days)}`).join(", ")}
      </p>
      <div className="overflow-x-auto">
        <table aria-label={`Margin, ${margin.quarter}`} className="w-full text-sm tabular-nums">
          <thead>
            <tr className="text-left text-[12.5px] font-medium text-muted-foreground">
              <th scope="col" className="py-1.5 pr-3 font-medium">Month</th>
              <th scope="col" className="px-2 py-1.5 text-right font-medium">{margin.unit === "hour" ? "Hours" : "Days"} billed</th>
              <th scope="col" className="px-2 py-1.5 text-right font-medium">Revenue</th>
              <th scope="col" className="px-2 py-1.5 text-right font-medium">{margin.herName}</th>
              <th scope="col" className="px-2 py-1.5 text-right font-medium">Their cost</th>
              <th scope="col" className="py-1.5 pl-2 text-right font-medium">Margin</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.yearMonth} className="border-t border-hairline">
                <th scope="row" className="py-1.5 pr-3 text-left font-normal">
                  {formatYearMonth(r.yearMonth)}
                  {r.logged && <span className="text-muted-foreground"> · logged</span>}
                </th>
                <td className="px-2 py-1.5 text-right">{n(r.days)}</td>
                <td className="px-2 py-1.5 text-right">{eur(r.revenue)}</td>
                <td className="px-2 py-1.5 text-right">{n(r.herDays)} {mark}</td>
                <td className="px-2 py-1.5 text-right">{eur(r.cost)}</td>
                <td className="py-1.5 pl-2 text-right">
                  {eur(r.margin)} · {r.revenue > 0 ? `${marginPct(r.margin, r.revenue)}%` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t font-medium">
              <th scope="row" className="py-1.5 pr-3 text-left font-medium">{margin.quarter}</th>
              <td className="px-2 py-1.5 text-right">{n(total.days)}</td>
              <td className="px-2 py-1.5 text-right">{eur(total.revenue)}</td>
              <td className="px-2 py-1.5 text-right">{n(total.herDays)} {mark}</td>
              <td className="px-2 py-1.5 text-right">{eur(total.cost)}</td>
              <td className="py-1.5 pl-2 text-right">
                {eur(total.margin)} · {total.revenue > 0 ? `${marginPct(total.margin, total.revenue)}%` : "—"}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="text-meta text-muted-foreground">Planned figures. A month that has ended uses the days logged.</p>
    </div>
  )
}
