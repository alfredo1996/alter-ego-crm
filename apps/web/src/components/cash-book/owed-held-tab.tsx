"use client"

import { isoDate } from "@alter-ego/kernel/dates"
import { ContentCard } from "@alter-ego/ui/page/content-card"
import { EmptyPrompt } from "@alter-ego/ui/page/empty-prompt"
import { StatusPill, TagChip } from "@alter-ego/ui/page/status-pill"
import { Button } from "@alter-ego/ui/ui/button"
import { AlertTriangle } from "lucide-react"

import { clientsOweBy, dayLabel, deposits, ownerLoanBalance, round2, supplierDocuments } from "@/lib/cash-book"
import { eurCents } from "@/lib/invoices"

import type { SupplierDocument } from "@/lib/cash-book"
import type { Client, CompanyExpense, CompanyLoan, CompanyMovement, Engagement, Invoice } from "@/types"
import type { ReactNode } from "react"

const sum = (values: number[]) => round2(values.reduce((s, v) => s + v, 0))

/**
 * Who owes what to whom: clients to the company, the company to its suppliers
 * and to the owner, and the deposits it holds or paid. Company-wide, whatever
 * the account chip.
 */
export function OwedHeldTab({
  invoices,
  engagements,
  clients,
  expenses,
  loans,
  movements,
  onPay,
}: {
  invoices: Invoice[]
  engagements: Pick<Engagement, "id" | "clientId">[]
  clients: Pick<Client, "id" | "name">[]
  expenses: CompanyExpense[]
  loans: CompanyLoan[]
  movements: CompanyMovement[]
  /** Pay on a supplier invoice: Add Movement, filled in. */
  onPay: (bill: SupplierDocument) => void
}) {
  const owe = clientsOweBy(invoices, engagements)
  const bills = supplierDocuments(expenses, movements)
  const open = bills.docs.filter((b) => b.owed > 0)
  const held = deposits(movements)
  const toGiveBack = held.filter((d) => d.kind === "deposit_held")
  const toGetBack = held.filter((d) => d.kind === "deposit_paid")
  const owner = ownerLoanBalance(loans, expenses)
  const clientName = (id: string | null) => clients.find((c) => c.id === id)?.name ?? "Unknown customer"

  return (
    <div className="flex flex-col gap-3 sm:gap-4">
      <p className="text-meta text-muted-foreground">
        Every account together: money owed to the company, money it owes, and deposits that are not its own.
      </p>
      <div className="grid gap-4 sm:gap-5 lg:grid-cols-2">
        <Card title="Clients Owe You" total={sum(owe.map((c) => c.amount))} help="Unpaid invoices, VAT included, the same as Unpaid on the Invoices page.">
          {owe.length === 0 ? (
            <EmptyPrompt variant="inline" title="No client owes anything." />
          ) : (
            <Lines>
              {owe.map((c) => (
                <Line key={c.clientId ?? "none"} label={clientName(c.clientId)} value={c.amount} />
              ))}
            </Lines>
          )}
        </Card>

        <Card
          title="You Owe Suppliers"
          total={bills.owed}
          help="Supplier invoices recorded on Costs as Not Paid Yet, less the Supplier Invoice Payments made. The invoice is the cost; a payment is only money."
        >
          {open.length === 0 ? (
            <EmptyPrompt variant="inline" title="No supplier invoice is waiting." />
          ) : (
            <Lines>
              {open.map((b) => (
                <li key={b.expense.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 py-2.5">
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-medium">
                      <TagChip>{b.expense.documentRef}</TagChip>
                      <span className="min-w-0 [overflow-wrap:anywhere]">{b.expense.description}</span>
                    </p>
                    <p className="text-meta text-muted-foreground tabular-nums">
                      {dayLabel(isoDate(b.expense.date))}: {eurCents(b.total)} in all, {eurCents(b.paid)} paid
                      {b.expense.project ? ` · ${b.expense.project}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <StatusPill tone="warning" className="tabular-nums">
                      {eurCents(b.owed)} owed
                    </StatusPill>
                    <Button size="sm" variant="outline" onClick={() => onPay(b)} aria-label={`Pay ${b.expense.documentRef}`}>
                      Pay
                    </Button>
                  </div>
                </li>
              ))}
            </Lines>
          )}
          {bills.dangling.length > 0 && (
            <Warning>
              {bills.dangling.length === 1 ? "1 Supplier Invoice Payment names" : `${bills.dangling.length} Supplier Invoice Payments name`}{" "}
              an invoice that is no longer on Costs: {eurCents(sum(bills.dangling.map((m) => m.amount)))}. Open them in Movements to fix.
            </Warning>
          )}
        </Card>

        <Card title="Deposits to Give Back" total={sum(toGiveBack.map((d) => d.amount))} help="Tenants' deposits held: money to return, not income.">
          {toGiveBack.length === 0 ? (
            <EmptyPrompt variant="inline" title="No deposit held." />
          ) : (
            <Lines>
              {toGiveBack.map((d) => (
                <Line key={d.counterparty} label={d.counterparty} value={d.amount} />
              ))}
            </Lines>
          )}
          {toGetBack.length > 0 && (
            <>
              <h3 className="border-t border-hairline pt-3 text-meta font-medium text-subtle-foreground">Deposits you paid, to get back</h3>
              <Lines>
                {toGetBack.map((d) => (
                  <Line key={`paid-${d.counterparty}`} label={d.counterparty} value={d.amount} />
                ))}
              </Lines>
            </>
          )}
        </Card>

        <Card
          title="SRL Owes You"
          total={Math.max(0, owner.total)}
          help="What you lent and the costs you paid with your own card, less what the SRL paid you back."
        >
          <Lines>
            <Line label="Lent to the SRL" value={owner.lent} />
            <Line label="Costs paid with your card" value={owner.card} />
            <Line label="Paid back to you" value={-owner.repaid || 0} />
          </Lines>
          {owner.total < 0 && (
            <Warning>
              The SRL has paid you {eurCents(-owner.total)} more than it owed. In an SRL that money has no reason: check the
              repayments.
            </Warning>
          )}
        </Card>
      </div>
    </div>
  )
}

/** One of the four: its name, its total, one line of what it counts. Named by its title. */
function Card({ title, total, help, children }: { title: string; total: number; help: string; children: ReactNode }) {
  return (
    <ContentCard as="section" aria-label={title} className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-col gap-1">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-[17px] font-semibold tracking-tight">{title}</h2>
          <span className="text-lg font-semibold tracking-[-0.01em] whitespace-nowrap tabular-nums">{eurCents(total)}</span>
        </div>
        <p className="text-meta text-muted-foreground">{help}</p>
      </div>
      {children}
    </ContentCard>
  )
}

function Lines({ children }: { children: ReactNode }) {
  return <ul className="divide-y divide-hairline border-t border-hairline text-sm">{children}</ul>
}

function Line({ label, value }: { label: string; value: number }) {
  return (
    <li className="flex justify-between gap-3 py-2.5">
      <span className="min-w-0 [overflow-wrap:anywhere]">{label}</span>
      <span className="shrink-0 tabular-nums">{eurCents(value)}</span>
    </li>
  )
}

function Warning({ children }: { children: ReactNode }) {
  return (
    <p className="flex gap-1.5 text-meta text-warning-soft-foreground">
      <AlertTriangle aria-hidden className="mt-0.5 size-3.5 shrink-0" />
      <span>{children}</span>
    </p>
  )
}
