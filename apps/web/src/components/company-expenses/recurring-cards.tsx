"use client"


import { SectionHeader } from "@alter-ego/ui/page/section-header"
import { StatusPill, TagChip } from "@alter-ego/ui/page/status-pill"
import { Button } from "@alter-ego/ui/ui/button"
import { format } from "date-fns"

import { COST_CATEGORY_LABELS, round2 } from "@/lib/cash-book"
import { estimateFacts, recurringStatus } from "@/lib/cash-book-recurring"
import { eurCents } from "@/lib/invoices"
import { countedWhenPaid, perMonthIn, priceIn } from "@/lib/projection"

import { everyLabel } from "./company-expense-form-dialog"
import { CostMoreMenu } from "./cost-more-menu"

import type { CompanyExpense } from "@/types"

const cadence = (e: CompanyExpense) => (e.recurrenceMonths && e.recurrenceMonths > 0 ? e.recurrenceMonths : 1)
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** The big figure and the words under it: what is paid each time when counted when paid, else the monthly share. */
function figure(e: CompanyExpense, today: Date): { big: string; small: string } {
  const months = cadence(e)
  const price = priceIn(e, format(today, "yyyy-MM"))
  if (countedWhenPaid(e)) {
    return { big: eurCents(price), small: `${months === 12 ? "a year" : `every ${months} months`} · about ${eurCents(round2(price / months))} a month` }
  }
  return { big: eurCents(round2(price / months)), small: "a month" }
}

const endedAfter = (e: CompanyExpense) => `Ended after ${format(new Date(`${e.endMonth}-01T00:00:00`), "MMM yyyy")}`

/** The Costs page's templates: what the Plan expects each period, with the payment still to record. */
export function RecurringCards({
  estimates,
  expenses,
  today,
  onPay,
  onEdit,
  onDelete,
}: {
  estimates: CompanyExpense[]
  expenses: CompanyExpense[]
  today: Date
  onPay: (estimate: CompanyExpense, opener: HTMLElement | null) => void
  onEdit: (estimate: CompanyExpense, opener: HTMLElement | null) => void
  onDelete: (estimate: CompanyExpense) => void
}) {
  const month = format(today, "yyyy-MM")
  const perMonth = round2(estimates.reduce((s, e) => s + perMonthIn(e, month), 0))
  const running = estimates.filter((e) => !e.endMonth || e.endMonth >= month).length
  return (
    <section aria-labelledby="recurring-title" className="flex flex-col gap-4">
      <SectionHeader
        id="recurring-title"
        title="Recurring"
        description={`${running} ${running === 1 ? "cost" : "costs"} · About ${eurCents(perMonth)} a month, net of VAT`}
      />
      {/* A phone: compact rows in one card, as Costs-phone draws it. */}
      <div className="rounded-xl border bg-card px-4 text-card-foreground shadow-xs sm:hidden">
        {estimates.map((e) => (
          <RecurringRow key={e.id} estimate={e} expenses={expenses} today={today} onPay={onPay} onEdit={onEdit} onDelete={onDelete} />
        ))}
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4 max-sm:hidden">
        {estimates.map((e) => (
          <RecurringCard key={e.id} estimate={e} expenses={expenses} today={today} onPay={onPay} onEdit={onEdit} onDelete={onDelete} />
        ))}
      </div>
    </section>
  )
}

function RecurringRow({
  estimate: e,
  expenses,
  today,
  onPay,
  onEdit,
  onDelete,
}: {
  estimate: CompanyExpense
  expenses: CompanyExpense[]
  today: Date
  onPay: (estimate: CompanyExpense, opener: HTMLElement | null) => void
  onEdit: (estimate: CompanyExpense, opener: HTMLElement | null) => void
  onDelete: (estimate: CompanyExpense) => void
}) {
  const status = recurringStatus(e, expenses, today)
  const months = cadence(e)
  const due = status.state === "due"
  const day = format(status.next, "d MMM")
  const vat = e.vat !== null && e.vat !== 0 ? ` · + VAT ${eurCents(Math.abs(e.vat))}` : ""
  const fig = figure(e, today)
  const when =
    status.state === "ended"
      ? endedAfter(e)
      : status.state === "due"
      ? `${status.next < today ? "Was due" : "Due"} ${day} · not recorded yet`
      : status.state === "upcoming"
        ? `Starts ${format(e.date, "d MMM yyyy")}`
        : "last" in status
          ? "No more payments"
          : `Next ${day}${months === 1 && status.state === "paid" ? ` · paid for ${format(new Date(`${status.paidFor}-01T00:00:00`), "MMM")}` : ""}`
  return (
    <article aria-labelledby={`rp-${e.id}`} className="flex flex-col gap-3 border-t border-hairline py-3.5 first:border-t-0">
      <div className="flex items-start gap-2.5">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
            <h3 id={`rp-${e.id}`} className="text-[15px] font-medium">
              {e.description}
            </h3>
            {due && <StatusPill tone="warning">Due</StatusPill>}
          </div>
          <span className="text-meta text-muted-foreground">
            {capital(everyLabel(e.recurrenceMonths))}
            {vat}
          </span>
          <span className="text-meta text-muted-foreground">{when}</span>
          {estimateFacts(e, today).map((f) => (
            <span key={f} className="text-meta text-muted-foreground">
              {f}
            </span>
          ))}
        </div>
        <div className="flex flex-col items-end tabular-nums whitespace-nowrap">
          <span className="text-[15px] font-semibold">{fig.big}</span>
          <span className="text-xs text-muted-foreground">{fig.small}</span>
        </div>
        <div className="-mt-1.5 -mr-3">
          <CostMoreMenu name={e.description} noun="Recurring Cost" onEdit={(el) => onEdit(e, el)} onDelete={() => onDelete(e)} />
        </div>
      </div>
      {due && (
        <Button size="lg" className="self-start" onClick={(ev) => onPay(e, ev.currentTarget)} aria-label={`Record Payment of ${e.description}`}>
          Record Payment
        </Button>
      )}
    </article>
  )
}

function RecurringCard({
  estimate: e,
  expenses,
  today,
  onPay,
  onEdit,
  onDelete,
}: {
  estimate: CompanyExpense
  expenses: CompanyExpense[]
  today: Date
  onPay: (estimate: CompanyExpense, opener: HTMLElement | null) => void
  onEdit: (estimate: CompanyExpense, opener: HTMLElement | null) => void
  onDelete: (estimate: CompanyExpense) => void
}) {
  const status = recurringStatus(e, expenses, today)
  const months = cadence(e)
  const due = status.state === "due"
  const vat = e.vat !== null && e.vat !== 0 ? `+ VAT ${eurCents(Math.abs(e.vat))}` : null
  const price = priceIn(e, format(today, "yyyy-MM"))
  const perYear = months === 12 ? `${eurCents(price)} a year` : `${eurCents(price)} every ${months} months`
  const fig = figure(e, today)
  const pill =
    status.state === "ended" ? (
      <StatusPill>Ended</StatusPill>
    ) : status.state === "due" ? (
      <StatusPill tone="warning">Due</StatusPill>
    ) : status.state === "upcoming" ? (
      <StatusPill>Starts {format(e.date, "MMM yyyy")}</StatusPill>
    ) : months === 1 && status.state === "paid" ? (
      <StatusPill tone="success">Paid for {format(new Date(`${status.paidFor}-01T00:00:00`), "MMM")}</StatusPill>
    ) : (
      <StatusPill>{months === 12 ? "Yearly" : months === 3 ? "Quarterly" : `Every ${months} months`}</StatusPill>
    )
  const pay = (
    <Button
      variant={due ? "default" : "outline"}
      size="lg"
      className="flex-1"
      onClick={(ev) => onPay(e, ev.currentTarget)}
      aria-label={`Record Payment of ${e.description}`}
    >
      Record Payment
    </Button>
  )
  return (
    <article aria-labelledby={`rc-${e.id}`} className="flex min-w-0 flex-col gap-3.5 rounded-xl border bg-card p-5 text-card-foreground shadow-xs">
      <div className="flex items-center justify-between gap-2">
        <TagChip mono={false}>{COST_CATEGORY_LABELS[e.category] ?? e.category}</TagChip>
        {pill}
      </div>
      <div className="flex flex-col gap-1">
        <h3 id={`rc-${e.id}`} className="text-[17px] font-semibold tracking-tight">
          {e.description}
        </h3>
        <span className="text-meta text-muted-foreground">
          {capital(everyLabel(e.recurrenceMonths))} · since {format(e.date, "MMM yyyy")}
        </span>
      </div>
      <div className="flex flex-col gap-0.5">
        <span className="text-2xl font-semibold tracking-[-0.02em] tabular-nums">{fig.big}</span>
        <span className="text-meta text-subtle-foreground tabular-nums">
          {countedWhenPaid(e) ? fig.small : `a month${months === 1 ? (vat && ` · ${vat}`) : ` · ${perYear}`}`}
        </span>
        {estimateFacts(e, today).map((f) => (
          <span key={f} className="text-meta text-muted-foreground">
            {f}
          </span>
        ))}
        {months > 1 && !countedWhenPaid(e) && status.state !== "ended" && (
          <span className="text-meta text-muted-foreground">
            {`Counted as a share every month. Edit it to count the full ${eurCents(price)} in the month it is paid.`}
          </span>
        )}
      </div>
      <div className="mt-auto h-px bg-hairline" />
      <div className="flex flex-col gap-0.5">
        {status.state === "ended" ? (
          <span className="text-sm font-medium">{endedAfter(e)}</span>
        ) : "last" in status ? (
          <span className="text-sm font-medium">No more payments</span>
        ) : (
          <>
            <span className="text-[12.5px] text-muted-foreground">{due && status.next < today ? "Was due" : "Next payment"}</span>
            <span className="text-sm font-medium">
              {format(status.next, "d MMM yyyy")}
              {due && " · not recorded yet"}
            </span>
          </>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        {pay}
        <CostMoreMenu name={e.description} noun="Recurring Cost" onEdit={(el) => onEdit(e, el)} onDelete={() => onDelete(e)} />
      </div>
    </article>
  )
}
