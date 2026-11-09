"use client"


import { ContentCard } from "@alter-ego/ui/page/content-card"
import { EmptyPrompt } from "@alter-ego/ui/page/empty-prompt"
import { SectionHeader } from "@alter-ego/ui/page/section-header"
import { Timeline } from "@alter-ego/ui/page/timeline"
import { Button } from "@alter-ego/ui/ui/button"
import { format } from "date-fns"
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, Pencil, Trash2 } from "lucide-react"

import { ownerLoanLedger } from "@/lib/cash-book"
import { eurCents } from "@/lib/invoices"

import { LOAN_ACTIONS } from "./loan-form-dialog"

import type { OwnerLedgerEntry } from "@/lib/cash-book"
import type { CompanyExpense, CompanyLoan, CompanyLoanDirection } from "@/types"
import type { TimelineItem } from "@alter-ego/ui/page/timeline"
import type { ReactNode } from "react"

/** More entries than this and a desktop reads them as a table. */
const TIMELINE_MAX = 10

const day = (e: OwnerLedgerEntry) => `${format(e.date, "dd/MM/yyyy")}`
const estimated = (e: OwnerLedgerEntry) => (e.kind === "loan" && e.loan.dateEstimated ? "~" : "")

interface LoansSectionProps {
  loans: CompanyLoan[]
  expenses: CompanyExpense[]
  owner: { lent: number; card: number; repaid: number; total: number }
  accountName: (id: string | null) => string | null
  today: Date
  onLend: (direction: CompanyLoanDirection, opener: HTMLElement | null) => void
  onEditLoan: (loan: CompanyLoan, opener: HTMLElement | null) => void
  onDeleteLoan: (loan: CompanyLoan) => void
  onOpenCost: (expense: CompanyExpense, opener: HTMLElement | null) => void
}

/** The shareholder loan: what the SRL owes you, how it got there, and the buttons that change it. */
export function LoansSection({ loans, expenses, owner, accountName, today, onLend, onEditLoan, onDeleteLoan, onOpenCost }: LoansSectionProps) {
  const entries = ownerLoanLedger(loans, expenses)
  const over = owner.total < 0
  const edit = (e: OwnerLedgerEntry) => {
    const label = `${e.kind === "loan" ? e.loan.description : e.expense.description}, ${format(e.date, "d MMM yyyy")}`
    return e.kind === "loan" ? (
      <>
        <Button variant="ghost" size="icon" className="text-subtle-foreground" onClick={(ev) => onEditLoan(e.loan, ev.currentTarget)} aria-label={`Edit ${label}`}>
          <Pencil aria-hidden />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="text-subtle-foreground hover:bg-danger-soft hover:text-danger-soft-foreground focus-visible:text-danger-soft-foreground"
          onClick={() => onDeleteLoan(e.loan)}
          aria-label={`Delete ${label}`}
        >
          <Trash2 aria-hidden />
        </Button>
      </>
    ) : (
      // A cost on your card is edited in One-Off Costs: this opens it.
      <Button variant="ghost" size="icon" className="text-subtle-foreground" onClick={(ev) => onOpenCost(e.expense, ev.currentTarget)} aria-label={`Open ${label}`}>
        <Pencil aria-hidden />
      </Button>
    )
  }
  const what = (e: OwnerLedgerEntry) =>
    e.kind === "card"
      ? "A cost you paid with your card · in One-Off Costs"
      : e.loan.direction === "to_company"
        ? `You lent to the SRL · ${accountName(e.loan.accountId) ?? "No account"}`
        : `SRL paid you back · ${accountName(e.loan.accountId) ?? "No account"}`
  const toYou = (e: OwnerLedgerEntry) => e.kind === "loan" && e.loan.direction === "from_company"
  const amount = (e: OwnerLedgerEntry) => Math.abs(e.delta)

  const items: TimelineItem[] = entries.map((e) => ({
    key: e.key,
    date: `${estimated(e)}${day(e)}`,
    outline: e.kind === "card",
    actions: <div className="flex items-center">{edit(e)}</div>,
    content: (
      <span className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <span className="flex min-w-0 flex-col">
          <span className="font-medium">{e.kind === "loan" ? e.loan.description : e.expense.description}</span>
          <span className="text-meta text-muted-foreground">{what(e)}</span>
        </span>
        <span className="flex flex-col sm:items-end">
          <span className="inline-flex items-center gap-1 font-medium tabular-nums">
            {toYou(e) ? <ArrowDownLeft aria-hidden className="size-3.5" /> : <ArrowUpRight aria-hidden className="size-3.5" />}
            <span className="sr-only">To </span>
            {toYou(e) ? "You" : "SRL"} {eurCents(amount(e))}
          </span>
          <span className="text-meta text-muted-foreground tabular-nums">
            Owes you <span className="font-medium text-foreground">{eurCents(e.balance)}</span>
          </span>
        </span>
      </span>
    ),
  }))

  return (
    <section id="shareholder-loan" aria-labelledby="loan-title" className="flex scroll-mt-20 flex-col gap-4">
      <SectionHeader
        id="loan-title"
        title="Shareholder Loan"
        description="Money between you and the SRL. Not a cost, so the Plan leaves it out; the Cash Book shows it."
        className="sm:items-baseline"
        actions={
          <div className="flex flex-wrap gap-2 max-sm:w-full max-sm:*:flex-1">
            <Button variant="outline" size="lg" onClick={(ev) => onLend("to_company", ev.currentTarget)}>
              <ArrowUpRight aria-hidden /> {LOAN_ACTIONS.to_company}
            </Button>
            <Button variant="outline" size="lg" onClick={(ev) => onLend("from_company", ev.currentTarget)}>
              <ArrowDownLeft aria-hidden /> {LOAN_ACTIONS.from_company}
            </Button>
          </div>
        }
      />
      <ContentCard as="div" className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between sm:gap-10">
        <div className="flex flex-col gap-1">
          <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">SRL Owes You</h3>
          <span className="text-[34px] leading-tight font-semibold tracking-[-0.02em] tabular-nums">{eurCents(Math.max(0, owner.total))}</span>
          <span className="text-meta text-muted-foreground">
            Today, {format(today, "d MMM yyyy")}, from {entries.length} {entries.length === 1 ? "entry" : "entries"}
          </span>
          {over && (
            <span className="mt-1 flex max-w-sm gap-1.5 text-meta text-warning-soft-foreground">
              <AlertTriangle aria-hidden className="mt-0.5 size-3.5 shrink-0" />
              The SRL has paid you {eurCents(-owner.total)} more than it owed. Check the repayments.
            </span>
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-2.5 sm:w-72">
          <Row label="Lent to the SRL" value={eurCents(owner.lent)} />
          <Row label="Paid With Your Card" value={eurCents(owner.card)} />
          <Row label="Paid Back to You" value={`${owner.repaid > 0 ? "−" : ""}${eurCents(owner.repaid)}`} />
          <Row label="SRL owes you" value={eurCents(owner.total)} total />
        </div>
      </ContentCard>

      {entries.length === 0 ? (
        <EmptyPrompt variant="inline" title="No shareholder loans recorded." />
      ) : (
        <ContentCard as="div" className="flex flex-col gap-4">
          <SectionHeader
            level={3}
            variant="card"
            title="History"
            description="Newest first, with what the SRL owes you after each entry"
          />
          <div className={entries.length > TIMELINE_MAX ? "sm:hidden" : undefined}>
            <Timeline items={items} phoneLimit={5} />
          </div>
          {entries.length > TIMELINE_MAX && (
            <div className="hidden overflow-x-auto sm:block">
              <HistoryTable entries={entries} accountName={accountName} edit={edit} toYou={toYou} />
            </div>
          )}
        </ContentCard>
      )}
    </section>
  )
}

function Row({ label, value, total }: { label: string; value: string; total?: boolean }) {
  return (
    <div className={total ? "flex items-baseline justify-between gap-4 border-t border-hairline pt-2.5" : "flex items-baseline justify-between gap-4"}>
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className={total ? "font-semibold tabular-nums" : "font-medium tabular-nums"}>{value}</p>
    </div>
  )
}

/** A long history, from sm up: the timeline stays for a phone. */
function HistoryTable({
  entries,
  accountName,
  edit,
  toYou,
}: {
  entries: OwnerLedgerEntry[]
  accountName: (id: string | null) => string | null
  edit: (e: OwnerLedgerEntry) => ReactNode
  toYou: (e: OwnerLedgerEntry) => boolean
}) {
  const th = "px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground"
  return (
    <table className="w-full text-sm tabular-nums">
        <caption className="sr-only">Shareholder loan history, newest first</caption>
        <thead>
          <tr className="border-b border-hairline">
            <th scope="col" className={th}>Date</th>
            <th scope="col" className={th}>Description</th>
            <th scope="col" className={th}>Direction</th>
            <th scope="col" className={th}>Account</th>
            <th scope="col" className={`${th} text-right`}>Amount</th>
            <th scope="col" className={`${th} text-right`}>Owes You</th>
            <th scope="col" className="w-24 px-4 py-2.5"><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.key} className="border-b border-hairline last:border-b-0 hover:bg-muted/50">
              <td className="px-4 py-3 whitespace-nowrap font-mono text-meta text-muted-foreground">{estimated(e)}{day(e)}</td>
              <td className="px-4 py-3">{e.kind === "loan" ? e.loan.description : e.expense.description}</td>
              <td className="px-4 py-3 whitespace-nowrap text-meta text-subtle-foreground">
                {e.kind === "card" ? "Your card → SRL" : toYou(e) ? "SRL → You" : "You → SRL"}
              </td>
              <td className="px-4 py-3">
                {e.kind === "loan" ? (accountName(e.loan.accountId) ?? <span className="text-muted-foreground">No account</span>) : <span className="text-muted-foreground">Your card</span>}
              </td>
              <td className="px-4 py-3 text-right font-medium whitespace-nowrap">{eurCents(Math.abs(e.delta))}</td>
              <td className="px-4 py-3 text-right whitespace-nowrap">{eurCents(e.balance)}</td>
              <td className="px-4 py-3"><div className="flex items-center justify-end">{edit(e)}</div></td>
            </tr>
          ))}
        </tbody>
    </table>
  )
}
