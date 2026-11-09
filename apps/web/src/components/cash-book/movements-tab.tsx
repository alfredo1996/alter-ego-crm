"use client"

import { formatYearMonth } from "@alter-ego/kernel/dates"
import { DataTableCard } from "@alter-ego/ui/page/data-table-card"
import { FilterSelect } from "@alter-ego/ui/page/filter-bar"
import { SectionHeader } from "@alter-ego/ui/page/section-header"
import { SignedAmount } from "@alter-ego/ui/page/signed-amount"
import { TagChip } from "@alter-ego/ui/page/status-pill"
import { Button } from "@alter-ego/ui/ui/button"
import { Checkbox } from "@alter-ego/ui/ui/checkbox"
import { Label } from "@alter-ego/ui/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@alter-ego/ui/ui/popover"
import { cn } from "@alter-ego/ui/utils"
import { format, parseISO } from "date-fns"
import { SlidersHorizontal } from "lucide-react"

import { dayLabel, monthEnd, rowTypeLabel } from "@/lib/cash-book"
import { eurCents } from "@/lib/invoices"

import type { CashRow, MonthSheet, SheetLine } from "@/lib/cash-book"
import type { CompanyAccount } from "@/types"
import type { ReactNode } from "react"

export const IN_TONE = "text-green-700 dark:text-green-400"

/** The ledger's filters. The page holds them: a phone sets them in the toolbar's Filters sheet. */
export type MovementFilters = { query: string; type: string | null; project: string | null; noDocument: boolean; estimated: boolean }
export const NO_FILTERS: MovementFilters = { query: "", type: null, project: null, noDocument: false, estimated: false }
/** The "Filters (n)" count: the search is its own field. */
export const filterCount = (f: MovementFilters) => [f.type !== null, f.project !== null, f.noDocument, f.estimated].filter(Boolean).length

const UNTAGGED = "__untagged__"

function matches(row: CashRow, f: MovementFilters): boolean {
  if (f.type !== null && rowTypeLabel(row) !== f.type) return false
  if (f.project === UNTAGGED ? row.project !== null : f.project !== null && row.project !== f.project) return false
  if (f.noDocument && (row.documentRef !== null || row.kind === "transfer")) return false
  if (f.estimated && !row.dateEstimated) return false
  const q = f.query.trim().toLowerCase()
  return !q || [row.description, row.counterparty, row.documentRef, row.notes, row.project].some((t) => t?.toLowerCase().includes(q))
}

/** Type, Cost Centre and the two flags: in a popover from sm up, in the toolbar's Filters sheet on a phone. */
export function MovementFilterFields({
  sheet,
  filters,
  onChange,
}: {
  sheet: MonthSheet
  filters: MovementFilters
  onChange: (filters: MovementFilters) => void
}) {
  const types = [...new Set(sheet.lines.map((l) => rowTypeLabel(l.row)))].sort()
  const projects = [...new Set(sheet.lines.map((l) => l.row.project).filter((p): p is string => !!p))].sort()
  return (
    <div className="flex flex-col gap-3">
      <FilterSelect
        label="Type"
        allLabel="All types"
        value={filters.type}
        options={types.map((t) => ({ value: t, label: t }))}
        onValueChange={(type) => onChange({ ...filters, type })}
        className="sm:w-full sm:max-w-none"
      />
      <FilterSelect
        label="Cost Centre"
        allLabel="All cost centres"
        value={filters.project}
        options={[...projects.map((p) => ({ value: p, label: p })), { value: UNTAGGED, label: "Untagged" }]}
        onValueChange={(project) => onChange({ ...filters, project })}
        className="sm:w-full sm:max-w-none"
      />
      {/* Wrapped, not tied by id: the phone's sheet renders a second copy. */}
      <Label className="flex items-center gap-2 font-normal pointer-coarse:min-h-11">
        <Checkbox checked={filters.noDocument} onCheckedChange={(on) => onChange({ ...filters, noDocument: on === true })} />
        No Document
      </Label>
      <Label className="flex items-center gap-2 font-normal pointer-coarse:min-h-11">
        <Checkbox checked={filters.estimated} onCheckedChange={(on) => onChange({ ...filters, estimated: on === true })} />
        Date Estimated
      </Label>
    </div>
  )
}

/** "07/10": the month is in the toolbar. */
const dayMonth = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}`
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`
const NONE = <span className="text-muted-foreground">—</span>

/**
 * The month as a sheet of the old Excel, made easier to read (CashBook.dc): the
 * opening balance first, each day under its own heading, each row once with its
 * signed amount, the balance at the end of each day, then the month's totals.
 * One table at every width: a card under 896 px (a phone, an iPad, a laptop with the sidebar
 * open) folds each row into two lines of its first cell. A click opens the row where it lives.
 */
export function MovementsTab({
  accounts,
  sheet,
  ym,
  today,
  accountId,
  filters,
  onFilters,
  onOpen,
}: {
  accounts: CompanyAccount[]
  /** The month's sheet for the scope (monthSheet). */
  sheet: MonthSheet
  ym: string
  /** "yyyy-MM-dd": a month not ended yet shows its balance so far. */
  today: string
  /** One account, or null for every account. */
  accountId: string | null
  filters: MovementFilters
  onFilters: (filters: MovementFilters) => void
  onOpen: (row: CashRow) => void
}) {
  const name = (id: string) => accounts.find((a) => a.id === id)?.name ?? "Unknown account"
  const all = accountId === null
  const month = formatYearMonth(ym)
  // ponytail: movements and payments can't be dated after today, so the month-end figure is today's balance.
  const soFar = ym >= today.slice(0, 7)
  const columns = all ? 6 : 5

  const lines = sheet.lines.filter(({ row }) => matches(row, filters))
  const count = filterCount(filters)
  const filtered = count > 0 || filters.query.trim() !== ""
  // The balance shows on each day's last line still in view.
  const lastShown = new Map(lines.map((l) => [l.row.day, l.row.key]))
  const balanceOf = (day: string) => sheet.lines.findLast((l) => l.row.day === day && l.endOfDay !== null)?.endOfDay ?? null
  const days: { day: string; lines: SheetLine[] }[] = []
  for (const line of lines) {
    const last = days.at(-1)
    if (last?.day === line.row.day) last.lines.push(line)
    else days.push({ day: line.row.day, lines: [line] })
  }
  const transfers = sheet.lines.filter((l) => l.row.kind === "transfer").length
  const openings = all && accounts.length > 1 ? [...sheet.openingByAccount] : []
  const head = "px-4 py-2.5 text-left text-[12.5px] font-medium text-muted-foreground"

  return (
    <DataTableCard>
      {/* A phone's card starts at the table: the tab names it, and its filters sit in the toolbar. */}
      <SectionHeader
        variant="card"
        title="Movements"
        description={`${plural(sheet.lines.length, "movement")}${transfers ? ` · ${plural(transfers, "transfer")}` : ""}`}
        className="py-3.5 pr-4 pl-[22px] max-sm:hidden"
        actions={
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="lg" className="px-3.5 text-subtle-foreground">
                <SlidersHorizontal aria-hidden />
                {count > 0 ? `Filters (${count})` : "Filters"}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80">
              <MovementFilterFields sheet={sheet} filters={filters} onChange={onFilters} />
            </PopoverContent>
          </Popover>
        }
      />
      {filtered && (
        <p className="border-t border-hairline px-3.5 py-2 text-sm text-muted-foreground sm:px-[22px]">
          Showing {lines.length} of {sheet.lines.length} rows.{" "}
          <Button type="button" variant="link" className="h-auto p-0" onClick={() => onFilters(NO_FILTERS)}>
            Clear Filters
          </Button>
        </p>
      )}

      {/* The fold goes by the card's width, not the screen's: the sidebar takes 240 px of a laptop.
          ponytail: one threshold, set by the six columns of every account (~800 px); a long account or
          cost-centre name can still push the table past it, and then the card scrolls sideways. */}
      <div className="@container overflow-x-auto">
        <table className="w-full border-collapse text-sm tabular-nums">
          <caption className="sr-only">
            Movements, {month}, {all ? "all accounts" : name(accountId)}
          </caption>
          <thead className="@max-4xl:sr-only">
            <tr className="border-y border-t-hairline">
              <th scope="col" className={head}>
                Description
              </th>
              <th scope="col" className={cn(head, "w-[120px] @max-4xl:hidden")}>
                Cost Centre
              </th>
              {all && (
                <th scope="col" className={cn(head, "w-[130px] @max-4xl:hidden")}>
                  Account
                </th>
              )}
              <th scope="col" className={cn(head, "w-[100px] @max-4xl:hidden")}>
                Document
              </th>
              <th scope="col" className={cn(head, "w-[140px] text-right @max-4xl:hidden")}>
                Amount
              </th>
              <th scope="col" className={cn(head, "w-[130px] text-right @max-4xl:hidden")}>
                Balance
              </th>
            </tr>
          </thead>
          <tbody>
            <tr className="bg-surface-subtle">
              <td colSpan={columns - 1} className="px-3.5 py-2.5 sm:@max-4xl:pr-[22px] @4xl:py-3.5">
                <div className="flex items-baseline justify-between gap-3 @4xl:flex-wrap @4xl:justify-start @4xl:gap-x-3.5 @4xl:gap-y-1.5">
                  <span className="flex flex-row-reverse items-baseline justify-end gap-2 @4xl:contents">
                    <span className="font-mono text-xs text-muted-foreground @4xl:text-meta">01/{ym.slice(5, 7)}</span>
                    <span className="text-[14.5px] font-medium @4xl:order-1 @4xl:text-sm">Opening balance</span>
                  </span>
                  {openings.length > 0 && (
                    <span className="text-meta text-muted-foreground @max-4xl:hidden @4xl:order-2">
                      {openings.map(([id, v]) => `${name(id)} ${eurCents(v)}`).join(" · ")}
                    </span>
                  )}
                  <span className="text-[15px] font-semibold whitespace-nowrap @4xl:hidden">{eurCents(sheet.opening)}</span>
                </div>
              </td>
              <td className="px-4 py-3.5 text-right font-semibold whitespace-nowrap @max-4xl:hidden">{eurCents(sheet.opening)}</td>
            </tr>
          </tbody>
          {days.map(({ day, lines: dayLines }) => (
            <tbody key={day}>
              <tr>
                <th
                  scope="rowgroup"
                  colSpan={columns}
                  className="border-t border-hairline bg-sidebar px-3.5 py-1.5 text-left text-[12.5px] font-normal text-muted-foreground sm:py-2 sm:text-meta"
                >
                  <span className="font-mono text-subtle-foreground">{dayMonth(day)}</span> {format(parseISO(day), "EEEE")}
                </th>
              </tr>
              {dayLines.map((line) => (
                <MovementRow
                  key={line.row.key}
                  row={line.row}
                  all={all}
                  name={name}
                  balance={lastShown.get(day) === line.row.key ? balanceOf(day) : null}
                  onOpen={onOpen}
                />
              ))}
            </tbody>
          ))}
          {lines.length === 0 && (
            <tbody>
              <tr className="border-t border-hairline">
                <td colSpan={columns} className="px-3.5 py-4 text-sm text-muted-foreground sm:px-[22px]">
                  {sheet.lines.length === 0
                    ? `No movements in ${month}. Add one with Add Movement, or mark an invoice paid into an account.`
                    : "No movement matches these filters."}
                </td>
              </tr>
            </tbody>
          )}
        </table>
      </div>
      {lines.some((l) => l.row.dateEstimated) && (
        <p className="border-t border-hairline px-3.5 py-2 text-xs text-muted-foreground sm:px-[22px]">
          ~ Date estimated: set the real day from the bank (To Chase lists them).
        </p>
      )}

      <section
        aria-label={`${month} totals`}
        className="flex flex-col gap-3.5 border-t bg-sidebar px-3.5 pt-4 pb-[18px] sm:px-[22px] sm:pt-[18px] sm:pb-5"
      >
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:flex sm:flex-wrap sm:items-end sm:gap-x-11 sm:gap-y-4">
          <h3 className="col-span-2 text-[15px] font-semibold sm:flex-[1_1_180px] sm:self-center">{month} Totals</h3>
          <Figure label="In">
            <SignedAmount amount={sheet.in} kind="in" format={eurCents} className="font-semibold" />
          </Figure>
          <Figure label="Out">
            <SignedAmount amount={sheet.out} kind="out" format={eurCents} className="font-semibold" />
          </Figure>
          <Figure label="Net">
            <SignedAmount amount={sheet.net} format={eurCents} className="font-semibold" />
          </Figure>
          <Figure label="Transfers (net)">
            <span className="text-muted-foreground">{eurCents(sheet.transfers)}</span>
          </Figure>
          <div className="col-span-2 flex items-baseline justify-between gap-3 border-t pt-3 sm:flex-col sm:items-end sm:gap-0.5 sm:border-0 sm:pt-0">
            <p className="text-meta text-subtle-foreground sm:text-muted-foreground">
              {soFar ? `Balance so far, ${dayLabel(today)}` : `Closing balance, ${dayLabel(monthEnd(ym))}`}
            </p>
            <p className="text-xl font-semibold tracking-[-0.01em] whitespace-nowrap">{eurCents(sheet.closing)}</p>
          </div>
        </div>
        {(sheet.closingByAccount.size > 1 || sheet.opened.length > 0) && (
          <ul className="flex flex-col gap-1.5 text-[13.5px] text-subtle-foreground sm:flex-row sm:flex-wrap sm:justify-end sm:gap-x-8 sm:border-t sm:pt-3.5 sm:text-meta">
            {sheet.closingByAccount.size > 1 &&
              [...sheet.closingByAccount].map(([id, v]) => (
                <li key={id} className="flex justify-between gap-3 sm:gap-2">
                  <span>
                    {name(id)}, {soFar ? "so far" : "closing balance"}
                  </span>
                  <span className="font-medium whitespace-nowrap text-foreground">{eurCents(v)}</span>
                </li>
              ))}
            {sheet.opened.map((o) => (
              <li key={o.accountId} className="text-muted-foreground sm:basis-full sm:text-right">
                {name(o.accountId)} opened on {dayLabel(o.day)} with {eurCents(o.balance)}: in the balances from that day, not in
                the opening balance.
              </li>
            ))}
          </ul>
        )}
      </section>
    </DataTableCard>
  )
}

/** Label, then value: siblings, as tests and screen readers read them. */
function Figure({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <p className="text-[12.5px] text-muted-foreground sm:text-meta">{label}</p>
      <p className="text-base">{children}</p>
    </div>
  )
}

/**
 * One movement: its description over its type, then cost centre, account, document, the signed
 * amount and the day's balance. In a narrow card the first cell holds it all in two lines (CashBook-phone.dc).
 */
function MovementRow({
  row,
  all,
  name,
  balance,
  onOpen,
}: {
  row: CashRow
  all: boolean
  name: (id: string) => string
  /** The day's closing balance, on its last line in view; null on the others. */
  balance: number | null
  onOpen: (row: CashRow) => void
}) {
  const transfer = row.kind === "transfer"
  const other = row.otherAccountId ? name(row.otherAccountId) : undefined
  const meta = transfer
    ? row.delta < 0
      ? `${name(row.accountId)} → ${other}`
      : `${other} → ${name(row.accountId)}`
    : [all && name(row.accountId), row.project].filter(Boolean).join(" · ")
  const cell = "px-4 py-3 align-middle @max-4xl:hidden"
  return (
    <tr
      className="cursor-pointer border-t border-hairline transition-colors hover:bg-muted/50 motion-reduce:transition-none"
      onClick={() => onOpen(row)}
    >
      <td className="px-3.5 py-2.5 align-middle sm:@max-4xl:pr-[22px] @4xl:py-3">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-1 @4xl:flex @4xl:flex-col @4xl:items-start @4xl:gap-1.5">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 @4xl:flex-col @4xl:items-start @4xl:gap-1.5">
            {/* No handler of its own: Enter clicks it and the click reaches the row. */}
            <button
              type="button"
              className={cn(
                "text-left text-[14.5px] font-medium underline-offset-4 hover:underline pointer-coarse:-my-3 pointer-coarse:min-w-11 pointer-coarse:py-3",
                transfer && "text-subtle-foreground",
              )}
            >
              {row.description}
            </button>
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <TagChip mono={false} className="@max-4xl:py-px">
                {rowTypeLabel(row)}
              </TagChip>
              {row.counterparty && <span className="text-meta text-muted-foreground">{row.counterparty}</span>}
              {row.dateEstimated && (
                <span className="text-meta text-warning-soft-foreground">
                  <span aria-hidden>~ </span>Date estimated
                </span>
              )}
            </span>
          </div>
          <span className="text-right text-[15px] @4xl:hidden">
            <SignedAmount amount={row.delta} kind={transfer ? "transfer" : undefined} format={eurCents} />
          </span>
          <span className="text-meta text-muted-foreground @4xl:hidden">
            {meta}
            {!transfer && (
              <>
                {meta && " · "}
                {row.documentRef ? <span className="font-mono text-xs">{row.documentRef}</span> : "No document"}
              </>
            )}
          </span>
          <span className="text-right text-[12.5px] whitespace-nowrap text-muted-foreground @4xl:hidden">
            {balance !== null && `Bal. ${eurCents(balance)}`}
          </span>
        </div>
      </td>
      <td className={cell}>
        {row.project ? (
          <span className="inline-block rounded-full border px-[9px] py-0.5 text-xs whitespace-nowrap text-subtle-foreground">
            {row.project}
          </span>
        ) : (
          NONE
        )}
      </td>
      {all && <td className={cn(cell, "whitespace-nowrap text-subtle-foreground")}>{name(row.accountId)}</td>}
      <td className={cell}>{row.documentRef ? <TagChip>{row.documentRef}</TagChip> : NONE}</td>
      <td className={cn(cell, "text-right text-[14.5px]")}>
        <SignedAmount amount={row.delta} kind={transfer ? "transfer" : undefined} counterpart={other} format={eurCents} />
      </td>
      <td className={cn(cell, "text-right font-medium whitespace-nowrap")}>{balance !== null ? eurCents(balance) : ""}</td>
    </tr>
  )
}
