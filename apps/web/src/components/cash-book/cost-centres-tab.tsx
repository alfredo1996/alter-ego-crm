"use client"

import { formatYearMonth } from "@alter-ego/kernel/dates"
import { ContentCard } from "@alter-ego/ui/page/content-card"
import { EmptyPrompt } from "@alter-ego/ui/page/empty-prompt"
import { StatusPill, type Tone } from "@alter-ego/ui/page/status-pill"
import { cn } from "@alter-ego/ui/utils"
import { useId, useMemo, useState } from "react"

import { UNTAGGED, costCentreTotals, monthEnd, resultLabel } from "@/lib/cash-book"
import { eurCents } from "@/lib/invoices"

import type { CostCentreTotal } from "@/lib/cash-book"
import type { CompanyExpense, CompanyLoan, CompanyMovement, Invoice } from "@/types"

/**
 * Each cost centre's income, costs and result for the month on show or its
 * year: a gain or a loss, said in words. Deposits sit beside a result, loans
 * below them all, never inside.
 */
export function CostCentresTab({
  data,
  ym,
  accountId,
  accountName,
}: {
  data: { invoices: Invoice[]; expenses: CompanyExpense[]; loans: CompanyLoan[]; movements: CompanyMovement[] }
  ym: string
  /** One account, or null for every account. */
  accountId: string | null
  accountName: string | null
}) {
  const [period, setPeriod] = useState<"month" | "year">("month")
  const year = ym.slice(0, 4)
  const from = period === "month" ? `${ym}-01` : `${year}-01-01`
  const to = period === "month" ? monthEnd(ym) : `${year}-12-31`
  const totals = useMemo(() => costCentreTotals(data, from, to, accountId), [data, from, to, accountId])
  const label = period === "month" ? formatYearMonth(ym) : year

  return (
    <div className="flex flex-col gap-3 sm:gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <p className="max-w-[68ch] text-meta text-muted-foreground">
          What each cost centre earned and spent in {label}
          {accountName ? `, through ${accountName}` : ""}, net of VAT. Invoices count under Consulting.{" "}
          {accountName
            ? "Supplier invoices and costs paid with your own card went through no account, so they are left out here: choose All Accounts to see them."
            : "A supplier invoice counts at its date, never its payments; costs paid with your own card count too."}
        </p>
        {/* The segmented look (Components.dc); buttons with aria-pressed, as the tests click them. */}
        <div role="group" aria-label="Period" className="inline-flex shrink-0 self-start rounded-[10px] bg-muted p-[3px]">
          {(["month", "year"] as const).map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={period === p}
              onClick={() => setPeriod(p)}
              className={cn(
                "min-h-9 rounded-lg px-3 text-[13px] text-subtle-foreground transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none pointer-coarse:min-h-11",
                period === p && "bg-background font-medium text-foreground shadow-xs",
              )}
            >
              {p === "month" ? formatYearMonth(ym) : `Year ${year}`}
            </button>
          ))}
        </div>
      </div>

      {totals.centres.length === 0 ? (
        <EmptyPrompt variant="inline" title={`Nothing earned or spent in ${label}.`} />
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4 sm:gap-5">
          {totals.centres.map((c) => (
            <CentreCard key={c.name} centre={c} />
          ))}
          {totals.centres.length > 1 && <CentreCard centre={totals.total} all />}
        </ul>
      )}

      <ContentCard as="section" aria-label="In no result" className="flex flex-col gap-1.5 bg-sidebar text-sm shadow-none">
        <h2 className="font-medium">In No Result</h2>
        <p>
          Shareholder loans in {label}: {eurCents(totals.loans.lent)} lent to the SRL, {eurCents(totals.loans.repaid)} paid
          back to you.
        </p>
        <p className="text-meta text-muted-foreground">
          Transfers between your accounts, VAT, taxes, administrator pay and supplier invoice payments are in no result
          either: they are not income or costs of a cost centre.
        </p>
      </ContentCard>
    </div>
  )
}

/** Gain in green, Loss in red, nothing at break-even: the pill carries the word. */
const resultTone = (result: number): Tone => (result > 0 ? "success" : result < 0 ? "danger" : "neutral")

function CentreCard({ centre: c, all }: { centre: CostCentreTotal; all?: boolean }) {
  const id = useId()
  return (
    <li className="flex">
      <ContentCard labelledBy={id} className={cn("flex flex-1 flex-col gap-3", all && "bg-sidebar")}>
        <div className="flex flex-col gap-1">
          <h2 id={id} className="text-[17px] font-semibold tracking-tight [overflow-wrap:anywhere]">{all ? "All Cost Centres" : c.name}</h2>
          {c.name === UNTAGGED && (
            <p className="text-meta text-muted-foreground">Rows with no cost centre: give them one where they are recorded.</p>
          )}
        </div>
        <dl className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-2 text-sm">
          <dt className="text-subtle-foreground">Income</dt>
          <dd className="text-right tabular-nums">{eurCents(c.income)}</dd>
          <dt className="text-subtle-foreground">Costs</dt>
          <dd className="text-right tabular-nums">{eurCents(c.costs)}</dd>
          <dt className="border-t border-hairline pt-2 font-medium">Result</dt>
          <dd className="border-t border-hairline pt-2 text-right">
            <StatusPill tone={resultTone(c.result)} className="text-[13px] tabular-nums">
              {resultLabel(c.result, eurCents)}
            </StatusPill>
          </dd>
        </dl>
        {(c.depositsHeld !== 0 || c.depositsPaid !== 0) && (
          <p className="mt-auto border-t border-hairline pt-2.5 text-meta text-muted-foreground">
            Apart, not in the result:
            {c.depositsHeld !== 0 && ` tenants' deposits ${eurCents(c.depositsHeld)} (received less returned)`}
            {c.depositsHeld !== 0 && c.depositsPaid !== 0 && ","}
            {c.depositsPaid !== 0 && ` deposits paid ${eurCents(c.depositsPaid)} (paid less refunded)`}.
          </p>
        )}
      </ContentCard>
    </li>
  )
}
