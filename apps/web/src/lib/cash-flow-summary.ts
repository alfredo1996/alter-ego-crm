/**
 * The Cash Book's Summary tab: what came in, what went out, how it was paid and
 * where the balances went, for a period and an account (or all). Built only from
 * the cash book's read model (lib/cash-book.ts), so every cash figure is the one
 * the Movements and Months tabs and the export show. One basis throughout: money
 * as it moved, in full. No tax figure of any kind: that is the accountant's job.
 * Pure, no I/O.
 */

import { isoDate, parseYearMonth } from "@alter-ego/kernel/dates"
import { addMonths, format } from "date-fns"

import {
  balancesAt,
  COST_CATEGORY_LABELS,
  isSupplierDocument,
  monthEnd,
  ownerLoanBalance,
  round2,
  rowTypeLabel,
  supplierDocuments,
  UNTAGGED,
} from "@/lib/cash-book"

import type { CashRow, ExportSelection } from "@/lib/cash-book"
import type { CompanyAccount, CompanyExpense, CompanyLoan, CompanyMovement, Invoice } from "@/types"

/** The Export dialog's selection, less the cost centre: a summary covers them all. */
export type SummarySelection = Pick<ExportSelection, "from" | "to" | "accountId">

/** Rows of one type, as the Movements tab names it ("Cost: Software & Tools"). */
export type FlowGroup = { label: string; amount: number; count: number; share: number }

export type SummaryMonth = {
  ym: string
  /** Transfers between own accounts excluded, as on the Months tab. */
  in: number
  out: number
  net: number
  /** Each account's balance at the month's last day (or the period's), null while not open yet. */
  ends: Map<string, number | null>
}

type Tally = { amount: number; count: number }

export type CashFlowSummary = {
  in: number
  out: number
  net: number
  /**
   * Transfers in less out of the accounts in scope, the Movements tab's
   * "Transfers (net)": 0 under every account, unless one side was not open yet.
   * Opening balance + net + transfers = closing balance.
   */
  transfers: number
  /** Every month holding a row of the period: the totals are always their sum. */
  months: SummaryMonth[]
  /**
   * Each account's balance at the start of the first month shown (the period's
   * first day, or the first opening): the Movements tab's opening balance. null
   * when no month is shown.
   */
  start: { day: string; balances: Map<string, number | null> } | null
  /** Cash out by type, largest first; deposits apart. Shares are of `out`. */
  spending: FlowGroup[]
  /** Cash in by type, largest first; deposits apart. Shares are of `in`. */
  income: FlowGroup[]
  /** Deposits paid or given back: money held for someone, not spending. */
  depositsOut: FlowGroup[]
  /** Deposits received or refunded: money held for someone, not income. */
  depositsIn: FlowGroup[]
  /** What went out of each account, and what it moved to and from the others apart. */
  byAccount: { accountId: string; out: number; transfersOut: number; transfersIn: number }[]
  /**
   * Costs dated in the period that moved no company money, in full: the owner's
   * card, supplier invoices still owed on the period's last day, and one-offs
   * recorded with no account. Under every account only, null under one.
   */
  offBank: { ownerCard: Tally; supplierOwed: Tally; noAccount: Tally } | null
  /** The `spending` rows by cost centre, largest first: they add up to the same total. */
  costCentres: { name: string; amount: number; share: number }[]
  /** The costs and supplier invoices that took the most money out, by name. */
  topCosts: { name: string; amount: number; count: number }[]
}

const sum = (values: number[]) => round2(values.reduce((s, v) => s + v, 0))
const isDeposit = (r: CashRow) => r.kind === "deposit_held" || r.kind === "deposit_paid"
const nextMonth = (ym: string) => format(addMonths(parseYearMonth(ym), 1), "yyyy-MM")
const tally = (amounts: number[]): Tally => ({ amount: sum(amounts), count: amounts.length })

function tallyBy(rows: CashRow[], key: (r: CashRow) => string) {
  const by = new Map<string, Tally & { name: string }>()
  for (const r of rows) {
    const name = key(r)
    const g = by.get(name.toLowerCase()) ?? { name, amount: 0, count: 0 }
    by.set(name.toLowerCase(), { name: g.name, amount: g.amount + Math.abs(r.delta), count: g.count + 1 })
  }
  return [...by.values()]
    .map((g) => ({ ...g, amount: round2(g.amount) }))
    .sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name))
}

const groups = (rows: CashRow[], total: number, label: (r: CashRow) => string): FlowGroup[] =>
  tallyBy(rows, label).map((g) => ({ label: g.name, amount: g.amount, count: g.count, share: total > 0 ? g.amount / total : 0 }))

/** The period's cash flow over counted rows (bookRows). */
export function cashFlowSummary(
  book: {
    accounts: CompanyAccount[]
    counted: CashRow[]
    invoices: Invoice[]
    expenses: CompanyExpense[]
    loans: CompanyLoan[]
    movements: CompanyMovement[]
  },
  sel: SummarySelection,
  today: string,
): CashFlowSummary {
  const scope = sel.accountId === null ? book.accounts : book.accounts.filter((a) => a.id === sel.accountId)
  const ids = new Set(scope.map((a) => a.id))
  const rows = book.counted.filter((r) => ids.has(r.accountId) && r.day >= sel.from && r.day <= sel.to)
  const plain = rows.filter((r) => r.kind !== "transfer")
  const ins = plain.filter((r) => r.delta > 0)
  const outs = plain.filter((r) => r.delta < 0)
  const cashIn = sum(ins.map((r) => r.delta))
  const cashOut = sum(outs.map((r) => -r.delta))

  // A Supplier Invoice Payment says what it bought through the invoice it pays.
  const expenseById = new Map(book.expenses.map((e) => [e.id, e]))
  const billOf = new Map(book.movements.map((m) => [m.id, m.expenseId ? expenseById.get(m.expenseId) : undefined]))
  const bill = (r: CashRow) => (r.kind === "supplier_payment" ? billOf.get(r.sourceId) : undefined)
  const typeLabel = (r: CashRow) => {
    const b = bill(r)
    return b ? `${r.delta < 0 ? "Supplier Invoice" : "Supplier Refund"}: ${COST_CATEGORY_LABELS[b.category]}` : rowTypeLabel(r)
  }

  // Months run from the period's first month, or the first opening, to its last
  // or this month, whichever is earlier; on to a later row's month if one is
  // dated after today, so no row is in a total and in no month.
  const months: SummaryMonth[] = []
  const firstOpen = scope.map((a) => isoDate(a.openingDate).slice(0, 7)).sort()[0]
  const lastRow = rows.reduce((last, r) => (r.day > last ? r.day : last), "")
  const lastYm = [[sel.to, today].sort()[0], lastRow].sort()[1].slice(0, 7)
  if (firstOpen !== undefined) {
    for (let ym = [sel.from.slice(0, 7), firstOpen].sort()[1]; ym <= lastYm; ym = nextMonth(ym)) {
      const mine = plain.filter((r) => r.day.startsWith(ym))
      const mIn = sum(mine.filter((r) => r.delta > 0).map((r) => r.delta))
      const mOut = sum(mine.filter((r) => r.delta < 0).map((r) => -r.delta))
      const end = balancesAt(scope, book.counted, [monthEnd(ym), sel.to].sort()[0])
      months.push({ ym, in: mIn, out: mOut, net: round2(mIn - mOut), ends: new Map(scope.map((a) => [a.id, end.get(a.id) ?? null])) })
    }
  }

  const startDay = months.length > 0 ? [sel.from, `${months[0].ym}-01`].sort()[1] : null
  const opening = startDay ? balancesAt(scope, book.counted.filter((r) => r.day < startDay), startDay) : null

  const within = (d: Date) => {
    const day = isoDate(d)
    return day >= sel.from && day <= sel.to
  }
  let offBank: CashFlowSummary["offBank"] = null
  if (sel.accountId === null) {
    const oneOffs = book.expenses.filter((e) => !e.isRecurring && e.accountId === null && within(e.date))
    const card = oneOffs.filter((e) => e.paidByOwner)
    // What was still owed on the period's last day, as the export's Owed column.
    const paidBy = book.movements.filter((m) => isoDate(m.date) <= sel.to)
    const bills = supplierDocuments(book.expenses, paidBy).docs.filter((b) => b.owed > 0 && within(b.expense.date))
    offBank = {
      ownerCard: { amount: ownerLoanBalance([], card).card, count: card.length },
      supplierOwed: tally(bills.map((b) => b.owed)),
      // The export's "Not paid from an account": no account, no card, no supplier's document.
      noAccount: tally(oneOffs.filter((e) => !e.paidByOwner && !isSupplierDocument(e)).map((e) => e.amount + (e.vat ?? 0))),
    }
  }

  const spent = outs.filter((r) => !isDeposit(r))
  return {
    in: cashIn,
    out: cashOut,
    net: round2(cashIn - cashOut),
    transfers: sum(rows.filter((r) => r.kind === "transfer").map((r) => r.delta)),
    months,
    start: startDay && opening ? { day: startDay, balances: new Map(scope.map((a) => [a.id, opening.get(a.id) ?? null])) } : null,
    spending: groups(spent, cashOut, typeLabel),
    income: groups(ins.filter((r) => !isDeposit(r)), cashIn, typeLabel),
    depositsOut: groups(outs.filter(isDeposit), cashOut, typeLabel),
    depositsIn: groups(ins.filter(isDeposit), cashIn, typeLabel),
    byAccount: scope
      .map((a) => {
        const mine = rows.filter((r) => r.accountId === a.id)
        const moved = mine.filter((r) => r.kind === "transfer")
        return {
          accountId: a.id,
          out: sum(mine.filter((r) => r.kind !== "transfer" && r.delta < 0).map((r) => -r.delta)),
          transfersOut: sum(moved.filter((r) => r.delta < 0).map((r) => -r.delta)),
          transfersIn: sum(moved.filter((r) => r.delta > 0).map((r) => r.delta)),
        }
      })
      .filter((a) => a.out > 0 || a.transfersOut > 0 || a.transfersIn > 0),
    offBank,
    costCentres: groups(spent, sum(spent.map((r) => -r.delta)), (r) => r.project?.trim() || bill(r)?.project?.trim() || UNTAGGED).map(
      (g) => ({ name: g.label, amount: g.amount, share: g.share }),
    ),
    // ponytail: top five by name; costs carry no supplier field, so one supplier under two descriptions shows twice.
    topCosts: tallyBy(
      spent.filter((r) => r.kind === "cost" || r.kind === "supplier_payment"),
      (r) => {
        const b = bill(r)
        return r.counterparty?.trim() || (b ? `${b.description.trim()}${b.documentRef ? ` (${b.documentRef.trim()})` : ""}` : r.description.trim())
      },
    ).slice(0, 5),
  }
}
