"use client"

import { format, parseISO } from "date-fns"
import { useEffect, useRef } from "react"

import { notSetLine, roomPart } from "../details"
import { monthOf } from "../rent"
import { monthLabel } from "./form-kit"
import { fullMonth } from "./payment-dialog"
import { StatusBadge, money, statusNotes, statusWord } from "./status-badge"

import type { Cell, Grid, GridRow } from "../rent"

export interface Figures {
  income: number
  costs: number
  result: number
}

interface Common {
  grid: Grid
  year: number
  today: string
  nameOf: (row: GridRow) => string
  /** What the row still lacks (room, tax ID, residence), for its amber line; empty when complete. */
  notSetOf: (row: GridRow) => string[]
  /** Opens a month: record a payment or set an agreed amount. */
  onCell: (row: GridRow, month: string) => void
  /** Opens the lease: edit, renew or end it. */
  onLease: (row: GridRow) => void
}

/** The amber line under a row that lacks something; it opens the lease, like the name. Words, not colour alone. */
function NotSet({ name, items, onClick, className }: { name: string; items: string[]; onClick: () => void; className?: string }) {
  if (!items.length) return null
  return (
    <button type="button" className={`block rounded-sm text-left text-meta text-warning-soft-foreground underline decoration-dotted underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-11 ${className ?? ""}`} aria-label={`${name}: ${notSetLine(items)}`} onClick={onClick}>
      {notSetLine(items)}
    </button>
  )
}

const shortMonth = (m: string) => format(parseISO(`${m}-01`), "MMM")
const monthName = (m: string) => format(parseISO(`${m}-01`), "MMMM")

/** "Elena Ivanova, September: paid, not invoiced": what a screen reader hears for a cell. */
function cellName(name: string, month: string, c: Cell) {
  const extras = [c.agreed && `agreed ${c.agreed.amount} euro`, c.offset > 0 && `including a ${c.offset} euro offset`, c.status === "paid" && !c.invoiced && "not invoiced"].filter(Boolean)
  return `${name}, ${monthName(month)}: ${[statusWord(c).toLowerCase(), ...extras].join(", ")}`
}

const cellButton =
  "flex w-full min-w-[5.5rem] flex-col items-start gap-0.5 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-11"

export function GridTable({ grid, year, today, nameOf, notSetOf, onCell, onLease }: Common) {
  const now = monthOf(today)
  // Twelve months do not fit beside the tenant: open with the current month in the middle.
  const box = useRef<HTMLDivElement>(null)
  const nowHead = useRef<HTMLTableCellElement>(null)
  useEffect(() => {
    if (box.current && nowHead.current) box.current.scrollLeft = nowHead.current.offsetLeft - box.current.clientWidth / 2
  }, [grid.months.length, year])
  return (
    <div ref={box} className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">Rent by tenant and month, {year}</caption>
        <thead>
          <tr className="border-b text-left text-meta text-muted-foreground">
            <th scope="col" className="sticky left-0 z-10 bg-background px-4 py-2 font-medium">Tenant</th>
            {grid.months.map((m) => (
              <th key={m} ref={m === now ? nowHead : undefined} scope="col" className={`px-2 py-2 font-medium ${m === now ? "text-foreground" : ""}`}>
                {shortMonth(m)}
                {m === now && " · now"}
              </th>
            ))}
            <th scope="col" className="sticky right-0 z-10 bg-background px-4 py-2 text-right font-medium">Owed</th>
          </tr>
        </thead>
        <tbody>
          {grid.rows.map((r) => (
            <tr key={r.key} className="border-b align-top last:border-b-0">
              <th scope="row" className="sticky left-0 z-10 min-w-56 bg-background px-4 py-3 text-left font-normal">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    aria-label={`Edit lease of ${nameOf(r)}${roomPart(r.room, ", ")}`}
                    className="rounded-sm font-semibold underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-11"
                    onClick={() => onLease(r)}
                  >
                    {nameOf(r)}
                  </button>
                  {r.room && <span className="rounded-full bg-muted px-2 py-px text-xs text-subtle-foreground">{r.room}</span>}
                </div>
                <p className="text-meta text-muted-foreground tabular-nums">
                  {money(r.lease.rent)}
                  {r.lease.contribution != null && ` + ${money(r.lease.contribution)} contribution`}
                  {r.lease.paidBy && ` · paid by ${r.lease.paidBy}`}
                </p>
                <p className="text-meta text-muted-foreground">
                  {monthLabel(r.lease.startDate)} – {monthLabel(r.lease.endDate)}
                  {r.deposit != null && ` · deposit ${money(r.deposit)}`}
                </p>
                <NotSet name={nameOf(r)} items={notSetOf(r)} onClick={() => onLease(r)} />
              </th>
              {grid.months.map((m) => {
                const c = r.cells[m]
                if (!c || c.status === "outside") return <td key={m} className="px-2 py-2" />
                return (
                  <td key={m} className={`px-1 py-1.5 ${m === now ? "bg-muted/50" : ""}`}>
                    <button type="button" aria-label={cellName(nameOf(r), m, c)} className={cellButton} onClick={() => onCell(r, m)}>
                      {c.status === "due-later" ? <span className="text-muted-foreground tabular-nums">{money(c.due)}</span> : <StatusBadge cell={c} />}
                      {c.status !== "due-later" && statusNotes(c).map((n) => (
                        <span key={n} className="text-xs text-muted-foreground">{n}</span>
                      ))}
                    </button>
                  </td>
                )
              })}
              <td className="sticky right-0 z-10 bg-background px-4 py-3 text-right font-semibold tabular-nums">{money(r.owed)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          {(["Due", "Paid", "Owed"] as const).map((label) => (
            <tr key={label} className="border-t bg-muted text-meta">
              <th scope="row" className="sticky left-0 z-10 bg-muted px-4 py-1.5 text-left font-medium">{label}</th>
              {grid.months.map((m) => {
                const f = grid.footer[m]
                const future = m > now
                const text =
                  label === "Due" ? money(f.due) : future ? "—" : label === "Paid" ? money(f.paid) : m === now ? `${money(f.notYet)} not yet` : money(f.owed)
                return <td key={m} className="whitespace-nowrap px-2 py-1.5 tabular-nums">{text}</td>
              })}
              <td className="sticky right-0 z-10 bg-muted px-4 py-1.5 text-right font-semibold tabular-nums">{label === "Owed" ? money(grid.owed) : ""}</td>
            </tr>
          ))}
        </tfoot>
      </table>
    </div>
  )
}

/** The phone: one month, each tenant with their status. */
export function MonthList({ grid, nameOf, notSetOf, onCell, onLease, month }: Common & { month: string }) {
  const earlier = grid.rows.flatMap((r) => r.missed.filter((x) => x.month < month).map((x) => ({ who: nameOf(r), m: x.month, owed: x.owed })))
  return (
    <div>
      <ul>
        {grid.rows.map((r) => {
          const c = r.cells[month]
          if (!c || c.status === "outside") return null
          const notes = c.status === "paid" ? [money(c.paid), ...statusNotes(c)] : c.status === "due-later" ? [`${money(c.due)} due`] : statusNotes(c)
          return (
            <li key={r.key} className="border-b last:border-b-0">
              <button
                type="button"
                aria-label={`Edit lease of ${nameOf(r)}${roomPart(r.room, ", ")}`}
                className="min-h-11 px-4 pt-1 text-left font-semibold underline decoration-muted-foreground/50 underline-offset-4 hover:decoration-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => onLease(r)}
              >
                {nameOf(r)}
              </button>
              <button
                type="button"
                aria-label={cellName(nameOf(r), month, c)}
                className="flex min-h-11 w-full items-center justify-between gap-3 px-4 pb-3 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => onCell(r, month)}
              >
                <span className="block text-meta text-muted-foreground">{[r.room, ...notes].filter(Boolean).join(" · ")}</span>
                <StatusBadge cell={c} />
              </button>
              <NotSet name={nameOf(r)} items={notSetOf(r)} onClick={() => onLease(r)} className="px-4 pb-3" />
            </li>
          )
        })}
      </ul>
      {earlier.length > 0 && (
        <p className="border-t px-4 py-3 text-meta text-muted-foreground">
          Owed from earlier months: <b>{money(earlier.reduce((s, e) => s + e.owed, 0))}</b>, {earlier.map((e) => `${e.who} for ${fullMonth(e.m).split(" ")[0]}`).join("; ")}.
        </p>
      )}
    </div>
  )
}
