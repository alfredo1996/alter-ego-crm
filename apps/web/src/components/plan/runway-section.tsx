"use client"

import { eur } from "@alter-ego/kernel/currency"
import { formatYearMonth } from "@alter-ego/kernel/dates"
import { DataTableCard } from "@alter-ego/ui/page/data-table-card"
import { SectionHeader } from "@alter-ego/ui/page/section-header"
import { StatCard, StatStrip } from "@alter-ego/ui/page/stat-card"
import { StatusPill } from "@alter-ego/ui/page/status-pill"
import { Button } from "@alter-ego/ui/ui/button"
import { cn } from "@alter-ego/ui/utils"
import { format } from "date-fns"
import { Fragment, useState } from "react"

import { RunwayChart } from "@/components/plan/runway-chart"
import { SetFloorDialog } from "@/components/plan/set-floor-dialog"

import type { Runway } from "@/lib/runway"
import type { ReactNode } from "react"

/** The folded table opens with this many months (the approved mockup). */
const HEAD = 2
const month = (ym: string) => formatYearMonth(ym, "MMM yyyy")
const B = ({ children }: { children: ReactNode }) => <b className="font-semibold text-foreground">{children}</b>

function coveredUntil(r: Runway): { value: ReactNode; detail: ReactNode; negative?: boolean } {
  const last = r.rows[r.rows.length - 1]?.yearMonth
  if (r.start < 0) {
    const below = `Accounts are ${eur(-r.start)} below €0.`
    if (!r.backAboveZero) return { value: "Not today", negative: true, detail: `${below} They stay below it for all ${r.rows.length} months.` }
    return {
      value: "Not today",
      negative: true,
      detail: (
        <>
          {below} Back above it in <B>{month(r.backAboveZero)}</B>, then covered {r.thenUntil === "beyond" ? "beyond" : "until"}{" "}
          <B>{month(r.thenUntil === "beyond" ? last! : r.thenUntil!)}</B>.
        </>
      ),
    }
  }
  if (r.coveredUntil === "beyond") {
    return { value: `Beyond ${month(last!)}`, detail: `The balance stays at or above €0 for all ${r.rows.length} months the Plan looks ahead.` }
  }
  return {
    value: month(r.coveredUntil!),
    detail: (
      <>
        Then <B>{month(r.runsOut!)}</B> would go under €0, before your pay, VAT and taxes.
      </>
    ),
  }
}

function underFloor(r: Runway): { value: ReactNode; detail: ReactNode; small?: boolean } {
  if (r.floor == null) return { value: "No floor set", small: true, detail: "Set a floor to see the first month the balance goes under it." }
  if (r.floorState === "never") return { value: "Never", detail: `Stays at or above ${eur(r.floor)} for all ${r.rows.length} months.` }
  if (r.floorState === "will") {
    return { value: month(r.belowFloor!), detail: `First month under ${eur(r.floor)}: the balance is ${eur(r.belowFloorBalance!)}.` }
  }
  return {
    value: "Now",
    detail: (
      <>
        {eur(r.start)} is under {eur(r.floor)}.{" "}
        {r.backAboveFloor ? (
          <>
            Back above it in <B>{month(r.backAboveFloor)}</B>
            {r.belowFloorAgain && (
              <>
                , under it again from <B>{month(r.belowFloorAgain)}</B>
              </>
            )}
            .
          </>
        ) : (
          `It stays under it for all ${r.rows.length} months.`
        )}
      </>
    ),
  }
}

/** Starting below zero, back above it, then under it again: the month the money runs out the second time. */
const runsOutAgain = (r: Runway) =>
  r.thenUntil && r.thenUntil !== "beyond" ? (r.rows[r.rows.findIndex((x) => x.yearMonth === r.thenUntil) + 1]?.yearMonth ?? null) : null

/** The row indexes the folded table keeps: the first two, the last, and each crossing with the month either side. */
function foldedRows(r: Runway): number[] {
  const keep = new Set([...Array(Math.min(HEAD, r.rows.length)).keys(), r.rows.length - 1])
  for (const ym of [r.belowFloor, r.runsOut, runsOutAgain(r), r.backAboveZero, r.backAboveFloor, r.belowFloorAgain]) {
    const i = r.rows.findIndex((x) => x.yearMonth === ym)
    if (ym && i >= 0) [i - 1, i, i + 1].forEach((k) => k >= 0 && k < r.rows.length && keep.add(k))
  }
  return [...keep].sort((a, b) => a - b)
}

/**
 * How long the company's money lasts: the accounts' balance today plus the plan's net, month by month.
 * Cash flow only, before the owner's pay, VAT and taxes.
 */
export function RunwaySection({
  runway,
  horizon,
  scenarioLabel,
  today,
  accountCount,
  heldDeposits,
  onSaveFloor,
}: {
  runway: Runway
  /** The months the Plan looks ahead, this one included. */
  horizon: number
  scenarioLabel: string
  today: Date
  accountCount: number
  /** Tenants' deposits the company holds, inside the balance. */
  heldDeposits: number
  onSaveFloor: (floor: number | null) => Promise<unknown>
}) {
  const [showAll, setShowAll] = useState(false)
  const [floorOpen, setFloorOpen] = useState(false)
  const covered = coveredUntil(runway)
  const floor = underFloor(runway)
  const shown = showAll ? runway.rows.map((_, i) => i) : foldedRows(runway)
  const again = runsOutAgain(runway)
  const th = "px-2 py-3 sm:px-4 text-[12.5px] font-medium text-muted-foreground"

  return (
    <section className="space-y-4 [&_h2]:scroll-mt-20">
      <SectionHeader
        id="runway"
        title="Runway"
        description={`Company accounts today plus the plan’s net, month by month, for the next ${horizon} months. Counting: ${scenarioLabel}. Before your pay, VAT and taxes.`}
        actions={
          <Button variant="outline" onClick={() => setFloorOpen(true)}>
            {runway.floor == null ? (
              "Set Floor"
            ) : (
              <>
                Floor <span className="text-muted-foreground tabular-nums">{eur(runway.floor)}</span>
              </>
            )}
          </Button>
        }
      />

      <StatStrip
        aria-label="Runway headline"
        phoneDetail
        hero={
          <StatCard
            className="border-foreground sm:flex-[2_1_440px]"
            label="Covered Until"
            value={covered.value}
            tone={covered.negative ? "danger" : undefined}
            detail={covered.detail}
          />
        }
      >
        <StatCard
          label="Money Today"
          value={eur(runway.start)}
          tone={runway.start < 0 ? "danger" : undefined}
          detail={`${accountCount} company ${accountCount === 1 ? "account" : "accounts"} · ${format(today, "d MMM")}${
            heldDeposits > 0 ? `. Includes ${eur(heldDeposits)} of tenants’ deposits you hold` : ""
          }`}
        />
        <StatCard
          label="Under Your Floor"
          value={<span className={cn(floor.small && "text-base")}>{floor.value}</span>}
          detail={floor.detail}
        />
      </StatStrip>

      <figure className="space-y-3 rounded-xl border bg-card p-5 shadow-xs">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h3 className="text-[17px] font-semibold tracking-tight">Balance at Month End</h3>
          <figcaption className="flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-subtle-foreground">
            <span>Line: balance at month end</span>
            {runway.floor != null && <span>Dashed: floor {eur(runway.floor)}</span>}
            {runway.floor != null && <span>Square: under the floor</span>}
            <span>Cross: under €0</span>
          </figcaption>
        </div>
        <RunwayChart
          points={[{ yearMonth: null, balance: runway.start }, ...runway.rows.map((r) => ({ yearMonth: r.yearMonth, balance: r.balance }))]}
          floor={runway.floor}
        />
      </figure>

      <DataTableCard>
        <div className="overflow-x-auto">
          <table className="w-full text-sm tabular-nums">
            <caption className="sr-only">Runway by month: the balance at month end is the month before plus the plan’s net</caption>
            <thead>
              <tr className="border-b">
                <th scope="col" className={cn(th, "text-left")}>Month</th>
                <th scope="col" className={cn(th, "text-right")}>Net</th>
                <th scope="col" className={cn(th, "text-right")}>Balance at month end</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-hairline bg-surface-subtle">
                <th scope="row" className="px-2 py-2.5 text-left font-normal sm:px-4">
                  <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                    <span className="font-medium">Today</span>
                    <span className="text-muted-foreground">{format(today, "d MMM")}</span>
                  </span>
                </th>
                <td className="px-2 py-2.5 text-right text-muted-foreground sm:px-4">–</td>
                <td className={cn("whitespace-nowrap px-2 py-2.5 text-right font-medium sm:px-4", runway.start < 0 && "text-danger")}>{eur(runway.start)}</td>
              </tr>
              {shown.map((i, n) => {
                const row = runway.rows[i]
                return (
                  <Fragment key={row.yearMonth}>
                    {n > 0 && i - shown[n - 1] > 1 && (
                      <tr className="border-b border-hairline">
                        <td colSpan={3} className="px-2 py-2 text-center text-muted-foreground sm:px-4">
                          … {month(runway.rows[shown[n - 1] + 1].yearMonth)} to {month(runway.rows[i - 1].yearMonth)} …
                        </td>
                      </tr>
                    )}
                    <tr className="border-b border-hairline">
                      <th scope="row" className="px-2 py-2.5 text-left font-normal sm:px-4">
                        <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                          <span className="font-medium">
                            <span className="sm:hidden">{month(row.yearMonth)}</span>
                            <span className="max-sm:hidden">{formatYearMonth(row.yearMonth)}</span>
                          </span>
                          {row.yearMonth === runway.belowFloor && <StatusPill tone="warning">Under your floor</StatusPill>}
                          {row.yearMonth === runway.belowFloorAgain && <StatusPill tone="warning">Under your floor again</StatusPill>}
                          {row.yearMonth === runway.runsOut && <StatusPill tone="danger">Money runs out</StatusPill>}
                          {row.yearMonth === again && <StatusPill tone="danger">Money runs out</StatusPill>}
                          {row.yearMonth === runway.backAboveZero && <StatusPill tone="success">Back above €0</StatusPill>}
                          {row.yearMonth === runway.backAboveFloor && runway.floorState === "now" && (
                            <StatusPill tone="success">Back above your floor</StatusPill>
                          )}
                        </span>
                      </th>
                      <td className={cn("whitespace-nowrap px-2 py-2.5 text-right sm:px-4", row.net < 0 && "text-danger")}>{eur(row.net)}</td>
                      <td className={cn("whitespace-nowrap px-2 py-2.5 text-right font-medium sm:px-4", row.balance < 0 && "text-danger")}>{eur(row.balance)}</td>
                    </tr>
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      </DataTableCard>

      <div className="flex justify-center">
        <Button variant="outline" onClick={() => setShowAll((v) => !v)}>
          {showAll ? "Show Fewer Months" : `Show ${runway.rows.length} Months`}
        </Button>
      </div>
      <p className="text-meta text-muted-foreground">
        Balance = the month before + Net, the Projection’s own figure. Revenue counts in the month the work is billed, not the month it is paid. The
        balance today is the Cash Book’s, VAT included. Pay, loan repayments, VAT and taxes paid are not in it. This month is left out: what has
        happened in it is already in the balance.
      </p>

      <SetFloorDialog open={floorOpen} onOpenChange={setFloorOpen} runway={runway} onSave={onSaveFloor} />
    </section>
  )
}
