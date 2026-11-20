"use client"

import { formatDate, isoDate } from "@alter-ego/kernel/dates"
import { DataTableCard } from "@alter-ego/ui/page/data-table-card"
import { SignedAmount } from "@alter-ego/ui/page/signed-amount"
import { StatusPill, TagList } from "@alter-ego/ui/page/status-pill"
import { Checkbox } from "@alter-ego/ui/ui/checkbox"
import { cn } from "@alter-ego/ui/utils"
import { isToday, isYesterday } from "date-fns"
import { ArrowLeftRight } from "lucide-react"

import { SwipeableRow } from "./swipeable-row"
import { txDelta } from "../../lib/account-ledger"
import { CategoryChip } from "../categories/category-chip"


import type { Transaction, Account, Category, Currency, Tag } from "../../types"
import type { ComponentProps, ReactNode } from "react"

interface TransactionListProps {
  transactions: Transaction[]
  accounts: Account[]
  /** Colour dot and name per row; without them every row reads Uncategorized. */
  categories?: Category[]
  tags?: Tag[]
  format: (amount: number, currency?: Currency) => string
  /** The phone's swipe left. A row has no trash: Delete is in the dialog it opens. */
  onDelete: (transaction: Transaction) => void
  onView?: (transaction: Transaction) => void
  selectedIds?: Set<string>
  onToggleSelect?: (id: string) => void
  onToggleSelectAll?: () => void
  /** An account's own page: amounts signed from that account's side, no Account column. */
  accountId?: string
  /** False inside a card that is already there. */
  frame?: boolean
  /** Pagination or totals, under the rows and inside the card. */
  footer?: ReactNode
}

type Amount = Pick<ComponentProps<typeof SignedAmount>, "amount" | "kind" | "counterpart">

/**
 * What a row's amount reads as. Everywhere: the type decides, a transfer is unsigned.
 * On an account's page: the sign is that account's (`txDelta`), and a transfer names the
 * account at its other end, so a transfer in reads "← Main Checking", one out "→ Reserve".
 */
export function rowAmount(tx: Transaction, accountId: string | undefined, nameOf: (id: string) => string): Amount {
  const kind = tx.type === "income" ? "in" : tx.type === "expense" ? "out" : "transfer"
  if (!accountId) return { amount: tx.amount, kind }
  const amount = txDelta(tx, accountId)
  if (kind !== "transfer") return { amount, kind }
  return { amount, kind, counterpart: nameOf(amount > 0 ? tx.accountId : (tx.transferToAccountId ?? "")) }
}

function groupByDay(transactions: Transaction[]) {
  const days: { key: string; date: Date; rows: Transaction[] }[] = []
  for (const tx of transactions) {
    const key = isoDate(tx.date)
    const last = days.at(-1)
    if (last?.key === key) last.rows.push(tx)
    else days.push({ key, date: tx.date, rows: [tx] })
  }
  return days
}

function DayLabel({ date }: { date: Date }) {
  const relative = isToday(date) ? "Today" : isYesterday(date) ? "Yesterday" : null
  return (
    <>
      {relative && (
        <>
          <span className="text-foreground">{relative}</span>
          <span aria-hidden className="text-subtle-foreground">
            {" · "}
          </span>
          <span className="sr-only">, </span>
        </>
      )}
      {formatDate(date, "EEE d MMM")}
    </>
  )
}

/** Money in and out of the day, when it has more than one line to add up (a transfer is neither). */
function DayNet({ rows, format }: { rows: Transaction[]; format: TransactionListProps["format"] }) {
  const currency = rows[0].currency
  if (rows.length < 2 || rows.every((t) => t.type === "transfer") || rows.some((t) => t.currency !== currency)) return null
  const net = rows.reduce((sum, t) => sum + (t.type === "income" ? t.amount : t.type === "expense" ? -t.amount : 0), 0)
  return (
    <span className="text-[13px] text-muted-foreground">
      Net <SignedAmount amount={net} format={(n) => format(n, currency)} />
    </span>
  )
}

function TransferChip() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2 py-[3px] text-[12.5px] leading-4 text-subtle-foreground">
      <ArrowLeftRight aria-hidden className="size-3" />
      Transfer
    </span>
  )
}

const nameButton =
  "min-w-0 truncate rounded-sm text-left font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring"

export function TransactionList({
  transactions,
  accounts,
  categories = [],
  tags = [],
  format,
  onDelete,
  onView,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
  accountId,
  frame = true,
  footer,
}: TransactionListProps) {
  if (transactions.length === 0) {
    return (
      <div className="py-12 text-center">
        <p className="text-muted-foreground">No transactions found.</p>
      </div>
    )
  }

  const nameOf = (id: string) => accounts.find((a) => a.id === id)?.name ?? "Unknown"
  const hasSelection = !!selectedIds && !!onToggleSelect
  const anySelected = hasSelection && selectedIds.size > 0
  const allSelected = hasSelection && transactions.every((tx) => selectedIds.has(tx.id))
  const someSelected = hasSelection && !allSelected && transactions.some((tx) => selectedIds.has(tx.id))
  const days = groupByDay(transactions)
  const columns = 3 + (hasSelection ? 1 : 0) + (accountId ? 0 : 1)

  const categoryOf = (tx: Transaction) => categories.find((c) => c.id === tx.categoryId) ?? null
  const tagNames = (tx: Transaction) => tags.filter((t) => tx.tagIds.includes(t.id)).map((t) => t.name)

  const accountText = (tx: Transaction) =>
    tx.type !== "transfer" ? (
      nameOf(tx.accountId)
    ) : (
      <>
        {nameOf(tx.accountId)}
        <span aria-hidden> → </span>
        <span className="sr-only"> to </span>
        {nameOf(tx.transferToAccountId ?? "")}
      </>
    )

  const amountOf = (tx: Transaction, className?: string) => (
    <SignedAmount {...rowAmount(tx, accountId, nameOf)} format={(n) => format(n, tx.currency)} className={className} />
  )

  const selectBox = (tx: Transaction, className?: string | false) =>
    hasSelection && (
      <Checkbox
        aria-label={`Select ${tx.description}, ${formatDate(tx.date, "EEE d MMM")}`}
        checked={selectedIds.has(tx.id)}
        onCheckedChange={() => onToggleSelect(tx.id)}
        onClick={(e) => e.stopPropagation()}
        className={className || undefined}
      />
    )

  const rowCategory = (tx: Transaction) =>
    tx.type === "transfer" ? (
      <TransferChip />
    ) : tx.splits.length > 0 ? (
      <span className="text-[12.5px] text-muted-foreground">{tx.splits.length} categories</span>
    ) : (
      <CategoryChip category={categoryOf(tx)} />
    )

  const pills = (tx: Transaction) => (
    <>
      {tx.status === "pending" && <StatusPill className="shrink-0">Pending</StatusPill>}
      {tx.splits.length > 0 && <StatusPill className="shrink-0">Split</StatusPill>}
    </>
  )

  const content = (
    <>
      {/* Phone: a card per day, a swipe left deletes. The first line is the description and the
          amount, which never wraps; the second the category and the account. */}
      <div className="space-y-[18px] md:hidden">
        {days.map((day) => (
          <section key={day.key} aria-labelledby={`day-${day.key}`}>
            <div className="flex items-baseline justify-between gap-3 px-1 pb-2">
              <h2 id={`day-${day.key}`} className="text-[13px] font-semibold text-foreground/80">
                <DayLabel date={day.date} />
              </h2>
              <DayNet rows={day.rows} format={format} />
            </div>
            <ul className="overflow-hidden rounded-xl border bg-card shadow-xs">
              {day.rows.map((tx) => (
                <li key={tx.id} className="border-t border-hairline first:border-t-0">
                  <SwipeableRow onDelete={() => onDelete(tx)}>
                    <div
                      className={cn(
                        "relative flex min-h-16 flex-col justify-center gap-1.5 bg-card px-3.5 py-3",
                        selectedIds?.has(tx.id) && "bg-muted",
                      )}
                    >
                      <div className="flex items-baseline justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-2">
                          {onView ? (
                            <button
                              type="button"
                              aria-haspopup="dialog"
                              onClick={() => onView(tx)}
                              className={cn(nameButton, "text-[15px] after:absolute after:inset-0")}
                            >
                              {tx.description}
                            </button>
                          ) : (
                            <span className="min-w-0 truncate text-[15px] font-medium">{tx.description}</span>
                          )}
                          {pills(tx)}
                        </div>
                        {/* Proportional figures: one amount per card, not a column. Geist's tabular ones are
                            5 px wider, and on CI's Linux Chrome they left the description short of mobile.spec's 150 px. */}
                        <span className="shrink-0 text-[15px]">{amountOf(tx, "proportional-nums")}</span>
                      </div>
                      <div className="flex min-w-0 items-center gap-2 text-[13px] text-muted-foreground">
                        {rowCategory(tx)}
                        {!accountId && (
                          <span className="min-w-0 truncate">
                            {accountText(tx)}
                          </span>
                        )}
                        {selectBox(tx, "relative z-10 ml-auto")}
                      </div>
                    </div>
                  </SwipeableRow>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      {/* Desktop: one table, a heading row per day. */}
      <div className="hidden overflow-x-auto md:block">
        <table aria-label="Transactions" className="w-full min-w-[720px] table-fixed text-sm">
          <colgroup>
            {hasSelection && <col className="w-14" />}
            <col />
            <col className="w-[170px]" />
            {!accountId && <col className="w-[200px]" />}
            <col className="w-[140px]" />
          </colgroup>
          <thead>
            <tr className="h-10 text-left text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">
              {hasSelection && (
                <th scope="col" className="font-normal">
                  <Checkbox
                    aria-label="Select all on this page"
                    checked={allSelected ? true : someSelected ? "indeterminate" : false}
                    onCheckedChange={() => onToggleSelectAll?.()}
                  />
                </th>
              )}
              <th scope="col" className={cn("px-2 font-semibold", !hasSelection && "pl-[22px]")}>Description</th>
              <th scope="col" className="px-2 font-semibold">Category</th>
              {!accountId && <th scope="col" className="px-2 font-semibold">Account</th>}
              <th scope="col" className="px-2 text-right font-semibold">Amount</th>
            </tr>
          </thead>
          {days.map((day) => (
            <tbody key={day.key}>
              <tr>
                <th scope="rowgroup" colSpan={columns} className="border-t border-hairline bg-surface-subtle p-0 text-left font-normal">
                  <div className="flex min-h-9 items-center justify-between gap-3" style={{ paddingLeft: (frame ? 0 : 22) + (hasSelection ? 42 : 0) }}>
                    <span className="text-[13px] font-semibold text-foreground/80">
                      <DayLabel date={day.date} />
                    </span>
                    <DayNet rows={day.rows} format={format} />
                  </div>
                </th>
              </tr>
              {day.rows.map((tx) => (
                <tr
                  key={tx.id}
                  className={cn(
                    "group border-t border-hairline hover:bg-muted/40 focus-within:bg-muted/40",
                    onView && "cursor-pointer",
                    selectedIds?.has(tx.id) && "bg-muted/50",
                  )}
                  onClick={onView ? () => onView(tx) : undefined}
                >
                  {hasSelection && (
                    <td>
                      {/* On hover or focus, or once anything is selected: a column of boxes is noise otherwise. */}
                      {selectBox(
                        tx,
                        !anySelected && "opacity-0 focus-visible:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100",
                      )}
                    </td>
                  )}
                  <td className={cn("min-w-0 px-2 py-2.5", !hasSelection && "pl-[22px]")}>
                    <div className="flex min-w-0 items-center gap-2">
                      {onView ? (
                        <button type="button" aria-haspopup="dialog" className={nameButton}>
                          {tx.description}
                        </button>
                      ) : (
                        <span className="min-w-0 truncate font-medium">{tx.description}</span>
                      )}
                      {pills(tx)}
                    </div>
                    {(tx.notes || tx.tagIds.length > 0) && (
                      <div className="mt-[3px] flex min-w-0 items-center gap-2 text-[13px] text-muted-foreground">
                        {tx.notes && <span className="min-w-0 truncate">{tx.notes}</span>}
                        <TagList items={tagNames(tx)} max={2} className="shrink-0 flex-nowrap" />
                      </div>
                    )}
                  </td>
                  <td className="px-2">{rowCategory(tx)}</td>
                  {!accountId && (
                    <td className="truncate px-2 text-foreground/80">{accountText(tx)}</td>
                  )}
                  <td className="px-2 text-right">
                    {amountOf(tx)}
                  </td>
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>

      {footer && <div className="border-t border-hairline max-md:mt-4 max-md:border-0 max-md:px-1">{footer}</div>}
    </>
  )

  // The card's frame is the desktop's; on a phone each day is its own card.
  return frame ? (
    <DataTableCard className="max-md:overflow-visible max-md:rounded-none max-md:border-0 max-md:bg-transparent max-md:shadow-none">
      {content}
    </DataTableCard>
  ) : (
    content
  )
}
