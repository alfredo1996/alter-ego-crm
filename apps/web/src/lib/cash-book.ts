/**
 * The company cash book (docs/plans/prima-nota.md). A read-time union of
 * invoices, costs, shareholder loans and movements: balances are never stored.
 * Pure, no I/O.
 *
 * Every cash fact becomes one CashRow on one account (a transfer, two). Days are
 * "yyyy-MM-dd" strings, compared as strings, so a stored time of day never
 * moves a row. A cost the owner paid, or a supplier invoice not paid yet, is no
 * cash row: it is in the cost centres, in what the company owes, and the export.
 */

import { isoDate } from "@alter-ego/kernel/dates"
import { addDays, addMonths, format, parse } from "date-fns"

import { CSV_BOM, escapeCsvValue } from "@/lib/export"
import { invoiceClientId, invoiceTotal, outstanding } from "@/lib/invoices"

import type {
  Client,
  CompanyAccount,
  CompanyExpense,
  CompanyExpenseCategory,
  CompanyLoan,
  CompanyMovement,
  CompanyMovementKind,
  Engagement,
  Invoice,
} from "@/types"

/** deleteCompanyAccount refuses while a movement, a cost, a loan or a paid invoice names the account. */
export const ACCOUNT_HAS_ENTRIES =
  "This account has movements, costs, loans or payments recorded on it: delete or move them before deleting the account."

/**
 * While Supplier Invoice Payments point at a supplier invoice, deleteCompanyExpense
 * refuses it, and updateCompanyExpense refuses to make it anything else
 * (leavesSupplierDocument): its cash would count twice and its payments name nothing.
 */
export const BILL_HAS_PAYMENTS =
  "This supplier invoice has payments recorded against it in the Cash Book: delete those payments first."

/** deleteClient refuses while one of its invoices is paid into a company account. */
export const CLIENT_HAS_CASH =
  "This client has invoices paid into a company account, so deleting it would change your Cash Book balances. To delete it anyway, mark those invoices unpaid first."

/**
 * The paidAccountId of an invoice closed against its credit note with no money
 * moving ("Offset, No Bank Payment"). Never a cash row, never chased: unlike
 * null, which means "not known". An auto-generated account id never matches it.
 */
export const NON_CASH = "non-cash"

/** Every invoice's money counts under this cost centre. */
export const INVOICE_PROJECT = "Consulting"

/** A row with no cost centre. */
export const UNTAGGED = "Untagged"

/** The cost centres in use, Consulting first: offered as one is typed. */
export function costCentresOf(...lists: { project: string | null }[][]): string[] {
  const used = new Set(lists.flat().map((x) => x.project?.trim()).filter((p): p is string => !!p))
  return [INVOICE_PROJECT, ...[...used].filter((p) => p !== INVOICE_PROJECT).sort()]
}

/** One source for the Costs form, the Costs table, the sheet and the CSV. */
export const COST_CATEGORY_LABELS: Record<CompanyExpenseCategory, string> = {
  rent: "Rent / Office",
  software: "Software & Tools",
  accountant: "Accountant",
  insurance: "Insurance",
  office_supplies: "Office Supplies",
  travel: "Travel & Transport",
  marketing: "Marketing",
  legal: "Legal",
  bank_fees: "Bank Fees",
  collaborators: "Collaborators",
  other: "Other",
}

/** Mark Paid books a shortfall up to this as a bank fee; more is a partial payment. */
export const MAX_BANK_FEE = 50

export type CashKind = CompanyMovementKind | "invoice" | "cost" | "loan"

export type CashRow = {
  /** Unique per row: a transfer's two legs share sourceId. */
  key: string
  source: "invoice" | "expense" | "loan" | "movement"
  sourceId: string
  /** "yyyy-MM-dd". */
  day: string
  accountId: string
  /** + into the account, − out of it. */
  delta: number
  kind: CashKind
  /** A transfer leg: the account on the other side. */
  otherAccountId: string | null
  description: string
  documentRef: string | null
  project: string | null
  counterparty: string | null
  notes: string | null
  /** The VAT inside delta: an invoice's or a cost's, else 0. */
  vat: number
  /** A cost's category; null on every other row. */
  category: CompanyExpenseCategory | null
  dateEstimated: boolean
  /** The workbook row it came from ("2026:Luglio!12"): orders a day's imported rows as the sheets did. */
  importRef: string | null
  createdAt: Date
}

/** The workbook's month sheets, January first: the names the import reads and its row order. */
export const MONTH_SHEETS = [
  "Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno",
  "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre",
] as const

/**
 * "2026:Luglio!12b" → [year × 12 + month, row, part], so "!2" sorts before
 * "!12" (the string would not). null when the ref is not a workbook row.
 */
export function importOrder(ref: string | null): [number, number, string] | null {
  const m = ref ? /^(\d{4}):([^!]+)!(\d+)([a-z]*)$/.exec(ref) : null
  const month = m ? MONTH_SHEETS.findIndex((s) => s.toLowerCase() === m[2].toLowerCase()) : -1
  return m && month >= 0 ? [Number(m[1]) * 12 + month, Number(m[3]), m[4]] : null
}

/** A day's rows: the imported ones first, in sheet order, then the rest by creation. */
function sameDayOrder(a: CashRow, b: CashRow): number {
  const x = importOrder(a.importRef)
  const y = importOrder(b.importRef)
  if (x && y) return x[0] - y[0] || x[1] - y[1] || x[2].localeCompare(y[2]) || a.createdAt.getTime() - b.createdAt.getTime()
  if (x || y) return x ? -1 : 1
  return a.createdAt.getTime() - b.createdAt.getTime()
}

/** `+ 0` turns -0 into 0, which Intl prints as "-€0.00". */
export function round2(n: number): number {
  return Math.round(n * 100) / 100 + 0
}

const sum = (values: number[]) => round2(values.reduce((s, v) => s + v, 0))
const toDay = (day: string) => parse(day, "yyyy-MM-dd", new Date())

/** The day before "yyyy-MM-dd". */
function prevDay(day: string): string {
  return isoDate(addDays(toDay(day), -1))
}

/** The last day of "yyyy-MM". */
export function monthEnd(ym: string): string {
  return prevDay(isoDate(addMonths(toDay(`${ym}-01`), 1)))
}

/** dd/mm/yyyy: the cash book's day, like the Excel it replaces. */
export function dayLabel(day: string): string {
  return format(toDay(day), "dd/MM/yyyy")
}

/** Paid into a real account: the only invoices that are cash. */
export function invoicePaidInto(i: Invoice): string | null {
  return i.paidDate && i.paidAccountId && i.paidAccountId !== NON_CASH ? i.paidAccountId : null
}

/**
 * One row per euro fact. Invoice: paid into an account → its total (a credit
 * note is negative). Cost: a one-off paid from an account → −(amount + VAT), a
 * refund +. Loan through an account: lent to the company +, repaid −. Movement:
 * in +, out −; a transfer gives two legs. Sorted by day, then the workbook's
 * row order for imported rows, then creation.
 */
export function cashRows(input: {
  invoices: Invoice[]
  expenses: CompanyExpense[]
  loans: CompanyLoan[]
  movements: CompanyMovement[]
  /** "Invoice 15/2026 · Acme": the customer, when known. */
  customerName?: (invoice: Invoice) => string | null
}): CashRow[] {
  const rows: CashRow[] = []
  const paid = input.invoices.filter((i) => invoicePaidInto(i) && i.paidDate)
  for (const i of paid) {
    const accountId = invoicePaidInto(i)!
    const day = isoDate(i.paidDate!)
    const customer = input.customerName?.(i)
    // Settled with an invoice of its customer, same day and account: deducted from that payment, not refunded.
    // No names, no customer to compare: never said.
    const from =
      i.amount < 0 && input.customerName
        ? paid.find(
            (p) => p.amount > 0 && p.paidAccountId === accountId && isoDate(p.paidDate!) === day && input.customerName?.(p) === customer,
          )
        : undefined
    rows.push({
      key: `invoice:${i.id}`,
      source: "invoice",
      sourceId: i.id,
      day,
      accountId,
      delta: invoiceTotal(i),
      kind: "invoice",
      otherAccountId: null,
      description: `${i.amount < 0 ? "Credit note" : "Invoice"} ${i.number}${customer ? ` · ${customer}` : ""}${
        from ? `, deducted from invoice ${from.number}` : ""
      }`,
      documentRef: i.number,
      project: INVOICE_PROJECT,
      counterparty: null,
      notes: null,
      vat: i.vat,
      category: null,
      dateEstimated: false,
      importRef: null,
      createdAt: i.createdAt,
    })
  }
  for (const e of input.expenses) {
    if (e.isRecurring || !e.accountId) continue
    rows.push({
      key: `expense:${e.id}`,
      source: "expense",
      sourceId: e.id,
      day: isoDate(e.date),
      accountId: e.accountId,
      delta: round2(-(e.amount + (e.vat ?? 0))),
      kind: "cost",
      otherAccountId: null,
      description: e.description,
      documentRef: e.documentRef,
      project: e.project,
      counterparty: null,
      notes: e.notes,
      vat: e.vat ?? 0,
      category: e.category,
      dateEstimated: e.dateEstimated,
      importRef: e.importRef,
      createdAt: e.createdAt,
    })
  }
  for (const l of input.loans) {
    if (!l.accountId) continue
    rows.push({
      key: `loan:${l.id}`,
      source: "loan",
      sourceId: l.id,
      day: isoDate(l.date),
      accountId: l.accountId,
      delta: l.direction === "to_company" ? l.amount : -l.amount,
      kind: "loan",
      otherAccountId: null,
      description: l.description,
      documentRef: null,
      project: null,
      counterparty: null,
      notes: l.notes,
      vat: 0,
      category: null,
      dateEstimated: l.dateEstimated,
      importRef: l.importRef,
      createdAt: l.createdAt,
    })
  }
  for (const m of input.movements) {
    const base = {
      source: "movement" as const,
      sourceId: m.id,
      day: isoDate(m.date),
      kind: m.kind,
      description: m.description,
      documentRef: m.documentRef,
      project: m.project,
      counterparty: m.counterparty,
      notes: m.notes,
      vat: 0,
      category: null,
      dateEstimated: m.dateEstimated,
      importRef: m.importRef,
      createdAt: m.createdAt,
    }
    if (m.kind === "transfer" && m.toAccountId) {
      rows.push({ ...base, key: `movement:${m.id}:out`, accountId: m.accountId, delta: -m.amount, otherAccountId: m.toAccountId })
      rows.push({ ...base, key: `movement:${m.id}:in`, accountId: m.toAccountId, delta: m.amount, otherAccountId: m.accountId })
    } else {
      rows.push({
        ...base,
        key: `movement:${m.id}`,
        accountId: m.accountId,
        delta: m.direction === "in" ? m.amount : -m.amount,
        otherAccountId: null,
      })
    }
  }
  return rows.sort((a, b) => a.day.localeCompare(b.day) || sameDayOrder(a, b))
}

/**
 * The Cash Book page's rows: every source, each invoice with its customer's
 * name, and those that reach a balance. One builder for the page, Month End and
 * every tool, so no reply lists a row differently from the page: without the
 * names, a credit note reads as deducted from another customer's invoice.
 */
export function bookRows(book: {
  accounts: CompanyAccount[]
  invoices: Invoice[]
  expenses: CompanyExpense[]
  loans: CompanyLoan[]
  movements: CompanyMovement[]
  clients: Pick<Client, "id" | "name">[]
  engagements: Pick<Engagement, "id" | "clientId">[]
}): { rows: CashRow[]; counted: CashRow[] } {
  const rows = cashRows({
    ...book,
    customerName: (i) => book.clients.find((c) => c.id === invoiceClientId(i, book.engagements))?.name ?? null,
  })
  return { rows, counted: splitRows(book.accounts, rows).counted }
}

/**
 * Which rows reach a balance: those on a known account dated from its opening
 * day. The rest are listed in To Chase, never counted.
 */
export function splitRows(accounts: CompanyAccount[], rows: CashRow[]) {
  const opening = new Map(accounts.map((a) => [a.id, isoDate(a.openingDate)]))
  const counted: CashRow[] = []
  const beforeOpening: CashRow[] = []
  const unassigned: CashRow[] = []
  for (const r of rows) {
    const from = opening.get(r.accountId)
    if (from === undefined) unassigned.push(r)
    else if (r.day < from) beforeOpening.push(r)
    else counted.push(r)
  }
  return { counted, beforeOpening, unassigned }
}

/**
 * Each account open by `asOf` ("yyyy-MM-dd") and its balance at the end of that
 * day, over counted rows. The opening balance is the one at the start of the
 * opening day: that day's rows add to it. An account not open yet is absent.
 */
export function balancesAt(accounts: CompanyAccount[], counted: CashRow[], asOf: string): Map<string, number> {
  const out = new Map(accounts.filter((a) => isoDate(a.openingDate) <= asOf).map((a) => [a.id, a.openingBalance]))
  for (const r of counted) {
    if (r.day <= asOf && out.has(r.accountId)) out.set(r.accountId, out.get(r.accountId)! + r.delta)
  }
  for (const [id, v] of out) out.set(id, round2(v))
  return out
}

export type StatementCheck =
  | { status: "not_checked" }
  | {
      status: "matches" | "missing_in" | "missing_out"
      /** "yyyy-MM-dd". */
      day: string
      bank: number
      book: number
      /** bank − book: > 0 an IN is missing from the book, < 0 an OUT. */
      difference: number
    }

/** A bank balance against the book at the end of `day`: Check Balance's live answer. */
export function checkAgainst(
  account: CompanyAccount,
  counted: CashRow[],
  bank: number,
  day: string,
): Exclude<StatementCheck, { status: "not_checked" }> {
  const book = balancesAt([account], counted, day).get(account.id) ?? account.openingBalance
  const difference = round2(bank - book)
  const status = difference === 0 ? "matches" : difference > 0 ? "missing_in" : "missing_out"
  return { status, day, bank, book, difference }
}

/** The account's last bank statement against the book on the same day. */
export function statementCheck(account: CompanyAccount, counted: CashRow[]): StatementCheck {
  if (account.statementBalance === null || account.statementDate === null) return { status: "not_checked" }
  return checkAgainst(account, counted, account.statementBalance, isoDate(account.statementDate))
}

/** "Matches the bank on 07/10/2026", "Missing OUT of €25.00 on 07/10/2026", "Not checked". */
export function statementLabel(check: StatementCheck, money: (n: number) => string): string {
  if (check.status === "not_checked") return "Not checked"
  const on = dayLabel(check.day)
  if (check.status === "matches") return `Matches the bank on ${on}`
  return `Missing ${check.status === "missing_in" ? "IN" : "OUT"} of ${money(Math.abs(check.difference))} on ${on}`
}

/** What a difference means, in words: null when the bank and the book agree. */
export function checkDetail(check: StatementCheck, money: (n: number) => string): string | null {
  if (check.status === "missing_in") {
    return `The bank has ${money(check.difference)} more: money came in that the Cash Book doesn't have.`
  }
  if (check.status === "missing_out") {
    return `The bank has ${money(-check.difference)} less: money went out that the Cash Book doesn't have.`
  }
  return null
}

/**
 * The rows to look through when a bank balance differs from the book on `day`:
 * those after the account's last check when it is earlier, else from the 1st of
 * the day's month; with no check yet, every row since the account opened.
 * `since` says which, for the list's heading.
 */
export function rowsSinceCheck(account: CompanyAccount, counted: CashRow[], day: string): { rows: CashRow[]; since: string } {
  const last = account.statementDate ? isoDate(account.statementDate) : null
  const afterLast = last !== null && last < day
  const from = last === null ? null : afterLast ? last : `${day.slice(0, 7)}-01`
  return {
    rows: counted.filter(
      (r) => r.accountId === account.id && (from === null || (afterLast ? r.day > from : r.day >= from)) && r.day <= day,
    ),
    since:
      from === null
        ? "since the account opened"
        : afterLast
          ? `since the last check (${dayLabel(from)})`
          : `from ${dayLabel(from)} to ${dayLabel(day)}`,
  }
}

export type SheetLine = {
  row: CashRow
  /** The scope's balance at the end of the row's day, on the day's last line only. */
  endOfDay: number | null
  /** A transfer with both legs in the sheet: one line, its out leg, that moves no total. */
  moved: boolean
}

export type MonthSheet = {
  /** The scope's balance at the start of the month's first day: accounts open by then. */
  opening: number
  /** The same, per account. */
  openingByAccount: Map<string, number>
  /** Accounts opening after the 1st: in the closing, not in the opening. */
  opened: { accountId: string; day: string; balance: number }[]
  lines: SheetLine[]
  /** Transfers excluded, like the Excel's In/Out columns. */
  in: number
  out: number
  net: number
  /** Transfers in − out of the one account; 0 for every account together. */
  transfers: number
  closing: number
  closingByAccount: Map<string, number>
}

/**
 * The month as one Excel sheet, for one account or all of them. Balances are
 * per day, never per line: same-day rows have no real order, so a line-by-line
 * balance would invent figures the bank never showed. Under every account a
 * transfer is one line (its out leg) and moves no total.
 */
export function monthSheet(
  accounts: CompanyAccount[],
  counted: CashRow[],
  ym: string,
  accountId: string | null,
): MonthSheet {
  const scope = accountId === null ? accounts : accounts.filter((a) => a.id === accountId)
  const ids = new Set(scope.map((a) => a.id))
  const first = `${ym}-01`
  const last = monthEnd(ym)
  // Start of the 1st: an account opening that day is in, with its opening balance.
  const openingByAccount = balancesAt(scope, counted.filter((r) => r.day < first), first)
  const opening = sum([...openingByAccount.values()])
  const opened = scope
    .map((a) => ({ accountId: a.id, day: isoDate(a.openingDate), balance: a.openingBalance }))
    .filter((o) => o.day > first && o.day <= last)
  const openedBy = (day: string) => sum(opened.filter((o) => o.day <= day).map((o) => o.balance))
  const inMonth = counted.filter((r) => ids.has(r.accountId) && r.day >= first && r.day <= last)
  // Both legs here: one line. One leg alone (the other account not open yet, or out of scope) is money in or out.
  const legs = new Map<string, number>()
  for (const r of inMonth) if (r.kind === "transfer") legs.set(r.sourceId, (legs.get(r.sourceId) ?? 0) + 1)

  const lines: SheetLine[] = []
  let running = 0
  inMonth.forEach((r, k) => {
    running += r.delta
    const moved = r.kind === "transfer" && legs.get(r.sourceId) === 2
    if (!(moved && r.delta > 0)) lines.push({ row: r, endOfDay: null, moved })
    const dayEnds = k === inMonth.length - 1 || inMonth[k + 1].day !== r.day
    // The day's last shown line carries it: a day may end on a hidden transfer leg.
    const carrier = dayEnds ? lines.findLast((l) => l.row.day === r.day) : undefined
    if (carrier) carrier.endOfDay = round2(opening + openedBy(r.day) + running)
  })
  const plain = inMonth.filter((r) => r.kind !== "transfer")
  const inTotal = sum(plain.filter((r) => r.delta > 0).map((r) => r.delta))
  const outTotal = sum(plain.filter((r) => r.delta < 0).map((r) => -r.delta))
  const closingByAccount = balancesAt(scope, counted, last)
  return {
    opening,
    openingByAccount,
    opened,
    lines,
    in: inTotal,
    out: outTotal,
    net: round2(inTotal - outTotal),
    transfers: sum(inMonth.filter((r) => r.kind === "transfer").map((r) => r.delta)),
    closing: sum([...closingByAccount.values()]),
    closingByAccount,
  }
}

export type MonthEndRow = {
  ym: string
  in: number
  out: number
  net: number
  /** null while the account was not open yet. */
  ends: Map<string, number | null>
  total: number
}

/**
 * The Verifica sheet: per calendar month of `year`, from the first account's
 * opening up to `lastYm`, In / Out / Net (transfers excluded) and each account's
 * end balance. A row whose bank date falls in another month counts in that month.
 */
export function monthEnds(
  accounts: CompanyAccount[],
  counted: CashRow[],
  year: number,
  lastYm: string,
  accountId: string | null,
): MonthEndRow[] {
  const scope = accountId === null ? accounts : accounts.filter((a) => a.id === accountId)
  const firstOpen = scope.map((a) => isoDate(a.openingDate).slice(0, 7)).sort()[0]
  if (firstOpen === undefined) return []
  const out: MonthEndRow[] = []
  for (let m = 1; m <= 12; m++) {
    const ym = `${year}-${String(m).padStart(2, "0")}`
    if (ym < firstOpen || ym > lastYm) continue
    const sheet = monthSheet(scope, counted, ym, null)
    const end = monthEnd(ym)
    const ends = new Map<string, number | null>(
      scope.map((a) => [a.id, isoDate(a.openingDate) <= end ? (sheet.closingByAccount.get(a.id) ?? null) : null]),
    )
    out.push({ ym, in: sheet.in, out: sheet.out, net: sheet.net, ends, total: sum([...ends.values()].map((v) => v ?? 0)) })
  }
  return out
}

/** The first day each account's end-of-day balance goes below zero: a bank can't, so a row is wrong or missing. */
export function negativeDays(
  accounts: CompanyAccount[],
  counted: CashRow[],
): { accountId: string; day: string; balance: number }[] {
  const out: { accountId: string; day: string; balance: number }[] = []
  for (const a of accounts) {
    const mine = counted.filter((r) => r.accountId === a.id)
    let running = a.openingBalance
    for (let k = 0; k < mine.length; k++) {
      running += mine[k].delta
      const dayEnds = k === mine.length - 1 || mine[k + 1].day !== mine[k].day
      if (dayEnds && round2(running) < 0) {
        out.push({ accountId: a.id, day: mine[k].day, balance: round2(running) })
        break
      }
    }
  }
  return out
}

export type Deposit = { kind: "deposit_held" | "deposit_paid"; counterparty: string; amount: number }

/**
 * Deposits by who they belong to: held = tenants' deposits to give back (in − out),
 * paid = deposits the company paid, to get back (out − in). Settled ones (0) are
 * dropped, and so is one given back with no receipt in the book (below 0).
 * Add Movement warns when that happens.
 */
export function deposits(movements: CompanyMovement[]): Deposit[] {
  const byKey = new Map<string, Deposit>()
  for (const m of movements) {
    if (m.kind !== "deposit_held" && m.kind !== "deposit_paid") continue
    const name = m.counterparty?.trim() || "Unnamed"
    const key = `${m.kind}|${name.toLowerCase()}`
    const d = byKey.get(key) ?? { kind: m.kind, counterparty: name, amount: 0 }
    const toward = m.kind === "deposit_held" ? m.direction === "in" : m.direction === "out"
    d.amount = round2(d.amount + (toward ? m.amount : -m.amount))
    byKey.set(key, d)
  }
  return [...byKey.values()].filter((d) => d.amount > 0)
}

/** What each customer owes, incl. VAT (outstanding), the ones owing nothing left out. */
export function clientsOweBy(
  invoices: Invoice[],
  engagements: Pick<Engagement, "id" | "clientId">[],
): { clientId: string | null; amount: number }[] {
  const byClient = new Map<string, Invoice[]>()
  for (const i of invoices) {
    const key = invoiceClientId(i, engagements) ?? ""
    byClient.set(key, [...(byClient.get(key) ?? []), i])
  }
  return [...byClient]
    .map(([clientId, list]) => ({ clientId: clientId || null, amount: round2(outstanding(list)) }))
    .filter((c) => c.amount > 0)
}

/** What clients owe, incl. VAT: outstanding per customer, so it matches the Invoices page. */
export function clientsOwe(invoices: Invoice[], engagements: Pick<Engagement, "id" | "clientId">[]): number {
  return sum(clientsOweBy(invoices, engagements).map((c) => c.amount))
}

/**
 * What the company owes the owner: shareholder loans lent and the costs the
 * owner paid by card (amount + VAT), less what it paid back. A repayment says
 * nothing of what it repays, so it stays a line of its own, never netted against
 * the loans. Below zero, the company has paid the owner more than it owed: the
 * pages warn.
 */
export function ownerLoanBalance(loans: CompanyLoan[], expenses: CompanyExpense[]) {
  const lent = sum(loans.filter((l) => l.direction === "to_company").map((l) => l.amount))
  const repaid = sum(loans.filter((l) => l.direction === "from_company").map((l) => l.amount))
  const card = sum(expenses.filter((e) => e.paidByOwner && !e.isRecurring).map((e) => e.amount + (e.vat ?? 0)))
  return { lent, card, repaid, total: round2(lent + card - repaid) }
}

export type OwnerLedgerEntry = { key: string; date: Date; delta: number; balance: number } & (
  | { kind: "loan"; loan: CompanyLoan }
  | { kind: "card"; expense: CompanyExpense }
)

/**
 * What ownerLoanBalance sums, entry by entry, newest first: each loan, repayment and cost paid with the
 * owner's card, with what the SRL owed the owner right after it. The first entry's balance is the total.
 */
export function ownerLoanLedger(loans: CompanyLoan[], expenses: CompanyExpense[]): OwnerLedgerEntry[] {
  const rows = [
    ...loans.map((loan) => ({
      kind: "loan" as const, key: `loan-${loan.id}`, loan, date: loan.date, at: loan.createdAt.getTime(),
      delta: loan.direction === "to_company" ? loan.amount : -loan.amount,
    })),
    ...expenses
      .filter((e) => e.paidByOwner && !e.isRecurring)
      .map((expense) => ({
        kind: "card" as const, key: `card-${expense.id}`, expense, date: expense.date, at: expense.createdAt.getTime(),
        delta: round2(expense.amount + (expense.vat ?? 0)),
      })),
  ].sort((a, b) => a.date.getTime() - b.date.getTime() || a.at - b.at || a.key.localeCompare(b.key))
  let balance = 0
  return rows
    .map(({ at: _at, ...row }): OwnerLedgerEntry => ({ ...row, balance: (balance = round2(balance + row.delta)) }))
    .reverse()
}

/** A one-off not paid from an account nor by the owner, with the supplier's document: paid by Supplier Invoice Payments. */
export function isSupplierDocument(e: CompanyExpense): boolean {
  return !e.isRecurring && e.accountId === null && !e.paidByOwner && e.documentRef !== null && e.amount > 0
}

/**
 * Whether an update makes a cost stop being a supplier invoice: an account, the
 * owner's card, no document, an estimate, a refund. Refused with
 * BILL_HAS_PAYMENTS while payments point at it.
 */
export function leavesSupplierDocument(
  u: Partial<Pick<CompanyExpense, "accountId" | "paidByOwner" | "documentRef" | "isRecurring" | "amount">>,
): boolean {
  return (
    u.accountId != null ||
    u.paidByOwner === true ||
    (u.documentRef !== undefined && !u.documentRef?.trim()) ||
    u.isRecurring === true ||
    (u.amount !== undefined && u.amount <= 0)
  )
}

export type SupplierDocument = { expense: CompanyExpense; total: number; paid: number; owed: number }

/**
 * Each supplier invoice with what was paid on it (Supplier Invoice Payments,
 * out − in) and what is still owed (never below 0); plus payments naming no
 * supplier invoice, which only the cash book shows.
 */
export function supplierDocuments(expenses: CompanyExpense[], movements: CompanyMovement[]) {
  const payments = movements.filter((m) => m.kind === "supplier_payment")
  const docs = expenses.filter(isSupplierDocument).map((expense): SupplierDocument => {
    const total = round2(expense.amount + (expense.vat ?? 0))
    const paid = sum(payments.filter((m) => m.expenseId === expense.id).map((m) => (m.direction === "out" ? m.amount : -m.amount)))
    return { expense, total, paid, owed: Math.max(0, round2(total - paid)) }
  })
  const ids = new Set(docs.map((d) => d.expense.id))
  return { docs, owed: sum(docs.map((d) => d.owed)), dangling: payments.filter((m) => !m.expenseId || !ids.has(m.expenseId)) }
}

export type CostCentreTotal = {
  name: string
  /** Rent and other income, client payments without invoice, and paid invoices net of VAT (Consulting). */
  income: number
  /** One-off costs at their own date, net of recoverable VAT: paid, by the owner's card, or supplier invoices. */
  costs: number
  /** income − costs: a gain above 0, a loss below. */
  result: number
  /** Tenants' deposits received less given back: apart, never in result. */
  depositsHeld: number
  /** Deposits the company paid less those refunded: apart, never in result. */
  depositsPaid: number
}

/**
 * Income, costs and the result per cost centre between `from` and `to`
 * ("yyyy-MM-dd", both included), with the deposits beside it, never inside it.
 * With an account, only what went through it: a cost the owner paid or a
 * supplier invoice belongs to no account. Shareholder loans have no cost centre
 * and are returned apart. Transfers, VAT, taxes, administrator pay, share
 * capital and supplier payments (the invoice is the cost) are in no result.
 */
export function costCentreTotals(
  data: { invoices: Invoice[]; expenses: CompanyExpense[]; loans: CompanyLoan[]; movements: CompanyMovement[] },
  from: string,
  to: string,
  accountId: string | null = null,
) {
  const within = (d: Date) => {
    const day = isoDate(d)
    return day >= from && day <= to
  }
  const onAccount = (id: string | null) => accountId === null || id === accountId
  const byName = new Map<string, CostCentreTotal>()
  const add = (project: string | null, field: "income" | "costs" | "depositsHeld" | "depositsPaid", amount: number) => {
    const name = project?.trim() || UNTAGGED
    const t = byName.get(name) ?? { name, income: 0, costs: 0, result: 0, depositsHeld: 0, depositsPaid: 0 }
    t[field] = round2(t[field] + amount)
    t.result = round2(t.income - t.costs)
    byName.set(name, t)
  }
  for (const i of data.invoices) {
    if (i.paidDate && within(i.paidDate) && (accountId === null || invoicePaidInto(i) === accountId)) add(INVOICE_PROJECT, "income", i.amount)
  }
  for (const e of data.expenses) {
    if (!e.isRecurring && within(e.date) && onAccount(e.accountId)) add(e.project, "costs", e.amount)
  }
  for (const m of data.movements) {
    if (!within(m.date) || !onAccount(m.accountId)) continue
    const signed = m.direction === "in" ? m.amount : -m.amount
    if (m.kind === "income" || m.kind === "client_income") add(m.project, "income", signed)
    else if (m.kind === "deposit_held") add(m.project, "depositsHeld", signed)
    else if (m.kind === "deposit_paid") add(m.project, "depositsPaid", -signed)
  }
  // Named cost centres A–Z, Untagged last.
  const centres = [...byName.values()].sort((a, b) => Number(a.name === UNTAGGED) - Number(b.name === UNTAGGED) || a.name.localeCompare(b.name))
  const total = (field: keyof Omit<CostCentreTotal, "name">) => sum(centres.map((c) => c[field]))
  const loans = data.loans.filter((l) => within(l.date) && onAccount(l.accountId))
  return {
    centres,
    total: {
      name: "Total",
      income: total("income"),
      costs: total("costs"),
      result: total("result"),
      depositsHeld: total("depositsHeld"),
      depositsPaid: total("depositsPaid"),
    } satisfies CostCentreTotal,
    loans: {
      lent: sum(loans.filter((l) => l.direction === "to_company").map((l) => l.amount)),
      repaid: sum(loans.filter((l) => l.direction === "from_company").map((l) => l.amount)),
    },
  }
}

/** "Gain €1,240.00", "Loss €3,100.00", or the amount alone at 0: a result that says which. */
export function resultLabel(result: number, money: (n: number) => string): string {
  if (result === 0) return money(0)
  return `${result > 0 ? "Gain" : "Loss"} ${money(Math.abs(result))}`
}

/**
 * The recurring estimate a payment stands for, as the Costs form and Add
 * Movement suggest it. The candidates are the estimates of its category; the
 * only one, when its first word (3+ letters) is in the description, is picked.
 * Any other case asks: an unrelated software purchase must never silently
 * replace the software estimate.
 */
export function pickEstimate(
  cost: { category: CompanyExpenseCategory; description: string },
  expenses: CompanyExpense[],
): { picked: CompanyExpense | null; candidates: CompanyExpense[] } {
  const candidates = expenses.filter((e) => e.isRecurring && e.category === cost.category)
  const only = candidates.length === 1 ? candidates[0] : null
  const word = only?.description.toLowerCase().match(/\p{L}{3,}/u)?.[0]
  return { picked: only && word && cost.description.toLowerCase().includes(word) ? only : null, candidates }
}

export type ChaseItem =
  | { kind: "negative"; accountId: string; day: string; balance: number }
  | { kind: "no_account"; invoice: Invoice }
  | { kind: "no_document"; expense: CompanyExpense }
  | { kind: "estimated"; row: CashRow }
  | { kind: "before_opening"; row: CashRow }
  | { kind: "unassigned"; row: CashRow }

/**
 * What to fix: balances below zero, invoices paid since the book began with no
 * account, costs paid with no document (a bank fee needs none), estimated dates,
 * rows dated before their account opened or naming an account that is gone. An
 * offset (NON_CASH) is deliberate and never listed, nor is a deposit dated
 * before the opening: that is how a deposit already held when the book began is
 * recorded (counted as held, already in the balance).
 */
export function toChase(input: {
  accounts: CompanyAccount[]
  rows: CashRow[]
  invoices: Invoice[]
  expenses: CompanyExpense[]
  /** false when the deployment leaves Invoicing out: an invoice with no account is then not for the owner to fix here. */
  invoicing?: boolean
}): ChaseItem[] {
  const { accounts, rows, invoices, expenses, invoicing = true } = input
  const { counted, beforeOpening, unassigned } = splitRows(accounts, rows)
  const bookStart = accounts.map((a) => isoDate(a.openingDate)).sort()[0]
  // A transfer's two legs are one movement: listed once, by its out leg when both are in the list.
  const once = (list: CashRow[]) =>
    list.filter((r) => !(r.kind === "transfer" && r.delta > 0 && list.some((o) => o.sourceId === r.sourceId && o.delta < 0)))
  const deposit = (r: CashRow) => r.kind === "deposit_held" || r.kind === "deposit_paid"
  return [
    ...negativeDays(accounts, counted).map((n) => ({ kind: "negative" as const, ...n })),
    ...invoices
      .filter((i) => invoicing && i.paidDate && i.paidAccountId === null && bookStart && isoDate(i.paidDate) >= bookStart)
      .map((invoice) => ({ kind: "no_account" as const, invoice })),
    ...expenses
      .filter((e) => (e.accountId || e.paidByOwner) && !e.isRecurring && e.amount > 0 && !e.documentRef && e.category !== "bank_fees")
      .map((expense) => ({ kind: "no_document" as const, expense })),
    ...once(counted.filter((r) => r.dateEstimated)).map((row) => ({ kind: "estimated" as const, row })),
    ...once(beforeOpening.filter((r) => !deposit(r))).map((row) => ({ kind: "before_opening" as const, row })),
    ...unassigned.map((row) => ({ kind: "unassigned" as const, row })),
  ]
}

/** The day a To Chase item is about: Month End holds it against every month ending on or after it. */
export function chaseDay(item: ChaseItem): string {
  switch (item.kind) {
    case "negative":
      return item.day
    case "no_account":
      // toChase lists only invoices with a paidDate.
      return isoDate(item.invoice.paidDate!)
    case "no_document":
      return isoDate(item.expense.date)
    default:
      return item.row.day
  }
}

/** Whether deleting the account would orphan a row: the backend guard, for the button. */
export function accountInUse(
  accountId: string,
  data: { invoices: Invoice[]; expenses: CompanyExpense[]; loans: CompanyLoan[]; movements: CompanyMovement[] },
): boolean {
  return (
    data.movements.some((m) => m.accountId === accountId || m.toAccountId === accountId) ||
    data.expenses.some((e) => e.accountId === accountId) ||
    data.loans.some((l) => l.accountId === accountId) ||
    data.invoices.some((i) => i.paidDate && i.paidAccountId === accountId)
  )
}

const KIND_LABELS: Record<CompanyMovementKind, { in: string; out: string }> = {
  transfer: { in: "Transfer", out: "Transfer" },
  income: { in: "Rent & Other Income", out: "Income Reversed" },
  client_income: { in: "Client Payment Without Invoice", out: "Client Payment Returned" },
  deposit_held: { in: "Deposit Received", out: "Deposit Returned" },
  deposit_paid: { in: "Deposit Refunded", out: "Deposit Paid" },
  capital: { in: "Share Capital", out: "Share Capital Returned" },
  vat: { in: "VAT Refund", out: "VAT (F24)" },
  tax: { in: "Tax Refund", out: "Tax (F24)" },
  compensation: { in: "Administrator Pay Returned", out: "Administrator Pay" },
  supplier_payment: { in: "Supplier Refund", out: "Supplier Invoice Payment" },
}

/** The one name of a movement's type: the dialog, the sheet and the CSV. */
export function kindLabel(kind: CompanyMovementKind, direction: "in" | "out"): string {
  return KIND_LABELS[kind][direction]
}

/** A row's type, as the sheet and the CSV name it: a cost with its category. */
export function rowTypeLabel(row: CashRow): string {
  // A credit note may be refunded or deducted from a payment: the description says which.
  if (row.kind === "invoice") return row.delta < 0 ? "Credit Note" : "Client Invoice Payment"
  if (row.kind === "cost") {
    return `${row.delta < 0 ? "Cost" : "Refund"}${row.category ? `: ${COST_CATEGORY_LABELS[row.category]}` : ""}`
  }
  if (row.kind === "loan") return row.delta > 0 ? "Shareholder Loan" : "Shareholder Loan Repayment"
  return kindLabel(row.kind, row.delta > 0 ? "in" : "out")
}

/** The CSV's closing line: what the file is, and is not. */
export const CSV_NOTICE =
  "Management record kept by the company: not a statutory accounting book or VAT register."

/** Decimal comma, no thousands separator: what Italian Excel reads as a number. */
const csvNumber = (n: number) => (n === 0 ? "" : n.toFixed(2).replace(".", ","))

/** A text cell. Numbers and dates go as they are: "-22,00" must stay a number. */
const csvCell = escapeCsvValue

export type ExportSelection = {
  /** "yyyy-MM-dd", both included. */
  from: string
  to: string
  /** One account, or null for every account. */
  accountId: string | null
  /** One cost centre (UNTAGGED for rows with none), or null for all. */
  costCentre: string | null
}

const slug = (s: string) => s.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-").replaceAll(/^-|-$/g, "")

/** "cash-book_2026-10_main-bank_flat-rental.csv": the file says what it holds. */
export function exportFileName(sel: ExportSelection, accounts: CompanyAccount[]): string {
  const wholeYear = sel.from.slice(5) === "01-01" && sel.to.slice(5) === "12-31" && sel.from.slice(0, 4) === sel.to.slice(0, 4)
  const wholeMonth = sel.from.slice(8) === "01" && sel.to === monthEnd(sel.from.slice(0, 7))
  const period = wholeYear ? sel.from.slice(0, 4) : wholeMonth ? sel.from.slice(0, 7) : `${sel.from}_${sel.to}`
  const account = accounts.find((a) => a.id === sel.accountId)
  return ["cash-book", period, account ? slug(account.name) : "all-accounts", sel.costCentre ? slug(sel.costCentre) : "all-cost-centres"].join("_") + ".csv"
}

/**
 * The prima nota for the accountant, opened by Italian Excel as is: UTF-8 BOM,
 * ";", decimal comma, dd/mm/yyyy, formula-safe text. The selected period's rows
 * (a transfer, one line per account), then summary blocks: per account the
 * balance at the start, In, Out (transfers included) and the balance at the end;
 * per cost centre income, costs and the gain or loss; and the costs that moved
 * no company account (the owner's card, supplier invoices). The notice last.
 */
export function exportCsv(
  data: {
    accounts: CompanyAccount[]
    rows: CashRow[]
    invoices: Invoice[]
    expenses: CompanyExpense[]
    loans: CompanyLoan[]
    movements: CompanyMovement[]
  },
  sel: ExportSelection,
): { csv: string; rows: number } {
  const { accounts, rows } = data
  const name = new Map(accounts.map((a) => [a.id, a.name]))
  const { counted, beforeOpening, unassigned } = splitRows(accounts, rows)
  const early = new Set(beforeOpening.map((r) => r.key))
  const unknown = new Set(unassigned.map((r) => r.key))
  const inCentre = (project: string | null) =>
    sel.costCentre === null || (project?.trim() || UNTAGGED) === sel.costCentre
  const picked = rows.filter(
    (r) =>
      r.day >= sel.from &&
      r.day <= sel.to &&
      (sel.accountId === null || r.accountId === sel.accountId) &&
      // A transfer belongs to no cost centre.
      (sel.costCentre === null || (r.kind !== "transfer" && inCentre(r.project))),
  )
  const line = (cells: string[]) => cells.join(";")
  const header = ["Date", "Account", "Type", "Description", "Document", "Cost Centre", "Counterparty", "In", "Out", "VAT", "Notes", "Flags"]
  const body = picked.map((r) => {
    const flags = [
      r.dateEstimated && "Date estimated",
      early.has(r.key) && "Before the account opened",
      unknown.has(r.key) && "Unknown account",
    ].filter(Boolean)
    const other = r.kind === "transfer" && r.otherAccountId ? (name.get(r.otherAccountId) ?? "unknown account") : null
    // "Transfer to Second Bank" already says where: no "(to Second Bank)" after it.
    const description = other && !r.description.includes(other) ? `${r.description} (${r.delta < 0 ? "to" : "from"} ${other})` : r.description
    return line([
      dayLabel(r.day),
      csvCell(name.get(r.accountId) ?? "Unknown account"),
      csvCell(rowTypeLabel(r)),
      csvCell(description),
      csvCell(r.documentRef ?? ""),
      csvCell(r.project ?? ""),
      csvCell(r.counterparty ?? ""),
      csvNumber(r.delta > 0 ? r.delta : 0),
      csvNumber(r.delta < 0 ? -r.delta : 0),
      csvNumber(r.vat),
      csvCell(r.notes ?? ""),
      csvCell(flags.join(", ")),
    ])
  })

  // Every account in scope, whatever the cost centre: a bank balance has none.
  const scope = accounts.filter((a) => sel.accountId === null || a.id === sel.accountId)
  const startOf = (a: CompanyAccount) => {
    const opening = isoDate(a.openingDate)
    return opening >= sel.from ? a.openingBalance : (balancesAt([a], counted, prevDay(sel.from)).get(a.id) ?? a.openingBalance)
  }
  const accountLines = scope
    .filter((a) => isoDate(a.openingDate) <= sel.to)
    .map((a) => {
      const mine = counted.filter((r) => r.accountId === a.id && r.day >= sel.from && r.day <= sel.to)
      const start = startOf(a)
      const inTotal = sum(mine.filter((r) => r.delta > 0).map((r) => r.delta))
      const outTotal = sum(mine.filter((r) => r.delta < 0).map((r) => -r.delta))
      return line([csvCell(a.name), csvAmount(start), csvAmount(inTotal), csvAmount(outTotal), csvAmount(round2(start + inTotal - outTotal))])
    })

  const totals = costCentreTotals(data, sel.from, sel.to, sel.accountId)
  const centres = totals.centres.filter((c) => sel.costCentre === null || c.name === sel.costCentre)
  const centreLine = (c: CostCentreTotal) =>
    line([csvCell(c.name), csvAmount(c.income), csvAmount(c.costs), csvAmount(c.result), c.result > 0 ? "Gain" : c.result < 0 ? "Loss" : "", csvAmount(c.depositsHeld), csvAmount(c.depositsPaid)])

  // Costs with no cash row: only under every account, where they belong.
  // A supplier invoice says what was paid on it by the period's last day, and what was still owed.
  const bills = new Map(
    supplierDocuments(data.expenses, data.movements.filter((m) => isoDate(m.date) <= sel.to)).docs.map((d) => [d.expense.id, d]),
  )
  const offBank =
    sel.accountId === null
      ? data.expenses
          .filter((e) => !e.isRecurring && e.accountId === null && within(e.date, sel) && inCentre(e.project))
          .sort((a, b) => a.date.getTime() - b.date.getTime())
          .map((e) => {
            const bill = bills.get(e.id)
            return line([
              dayLabel(isoDate(e.date)),
              e.paidByOwner ? "Owner's personal card" : bill ? "Supplier invoice" : "Not paid from an account",
              csvCell(COST_CATEGORY_LABELS[e.category]),
              csvCell(e.description),
              csvCell(e.documentRef ?? ""),
              csvCell(e.project ?? ""),
              csvAmount(e.amount),
              csvNumber(e.vat ?? 0),
              bill ? csvAmount(bill.paid) : "",
              bill ? csvAmount(bill.owed) : "",
              csvCell(e.notes ?? ""),
              e.dateEstimated ? "Date estimated" : "",
            ])
          })
      : []
  const through = name.get(sel.accountId ?? "")

  const blocks = [
    line(header),
    ...body,
    "",
    csvCell(`Accounts from ${dayLabel(sel.from)} to ${dayLabel(sel.to)}: every row whatever the cost centre, transfers included in In and Out`),
    line(["Account", "Balance at Start", "In", "Out", "Balance at End"]),
    ...accountLines,
    "",
    csvCell(
      "Cost Centres, net of VAT: income less costs is the result, a gain or a loss. Deposits are apart and never in it. Loans, transfers, VAT and taxes paid, administrator pay and supplier invoice payments are in none." +
        (through
          ? ` Through ${through} only: supplier invoices and costs paid with the owner's card went through no account, so they are left out. Export All Accounts to see them.`
          : ""),
    ),
    line(["Cost Centre", "Income", "Costs", "Result", "Gain or Loss", "Tenant Deposits, Net (apart)", "Deposits Paid, Net (apart)"]),
    ...centres.map(centreLine),
    ...(sel.costCentre === null && centres.length > 1 ? [centreLine(totals.total)] : []),
    ...(offBank.length > 0
      ? [
          "",
          csvCell(
            "Costs Paid by No Company Account, at their document date and counted in the cost centres above: the owner's card, and supplier invoices, whose payments are Supplier Invoice Payment rows",
          ),
          line(["Date", "Paid By", "Category", "Description", "Document", "Cost Centre", "Amount", "VAT", `Paid by ${dayLabel(sel.to)}`, `Owed on ${dayLabel(sel.to)}`, "Notes", "Flags"]),
          ...offBank,
        ]
      : []),
    "",
    csvCell(CSV_NOTICE),
  ]
  return { csv: `${CSV_BOM}${blocks.join("\r\n")}\r\n`, rows: picked.length }
}

const within = (d: Date, sel: ExportSelection) => {
  const day = isoDate(d)
  return day >= sel.from && day <= sel.to
}

/** A summary amount: 0 written out, so an empty cell never reads as missing. */
const csvAmount = (n: number) => csvNumber(n) || "0,00"
