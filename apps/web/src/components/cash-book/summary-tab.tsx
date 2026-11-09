"use client"

import { formatYearMonth, isoDate, parseYearMonth } from "@alter-ego/kernel/dates"
import { ContentCard } from "@alter-ego/ui/page/content-card"
import { DataTableCard } from "@alter-ego/ui/page/data-table-card"
import { SectionHeader } from "@alter-ego/ui/page/section-header"
import { SignedAmount } from "@alter-ego/ui/page/signed-amount"
import { StatCard, StatStrip } from "@alter-ego/ui/page/stat-card"
import { Button } from "@alter-ego/ui/ui/button"
import { Input } from "@alter-ego/ui/ui/input"
import { Label } from "@alter-ego/ui/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@alter-ego/ui/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@alter-ego/ui/ui/table"
import { cn } from "@alter-ego/ui/utils"
import { addMonths, format } from "date-fns"
import { ChevronRight } from "lucide-react"
import { useId, useState } from "react"

import { IN_TONE } from "@/components/cash-book/movements-tab"
import { BalancesChart, InOutChart, seriesOf, shortMonths } from "@/components/cash-book/summary-charts"
import { dayLabel, monthEnd, monthEnds, round2, UNTAGGED } from "@/lib/cash-book"
import { cashFlowSummary } from "@/lib/cash-flow-summary"
import { eurCents } from "@/lib/invoices"

import type { BalancePoint } from "@/components/cash-book/summary-charts"
import type { CashRow } from "@/lib/cash-book"
import type { FlowGroup } from "@/lib/cash-flow-summary"
import type { CompanyAccount, CompanyExpense, CompanyLoan, CompanyMovement, Invoice } from "@/types"
import type { ReactNode } from "react"

type Period = "this_month" | "month" | "this_year" | "year" | "range"
const PERIODS: { value: Period; label: string }[] = [
  { value: "this_month", label: "This Month" },
  { value: "month", label: "A Month" },
  { value: "this_year", label: "This Year" },
  { value: "year", label: "A Year" },
  { value: "range", label: "A Date Range" },
]
const MONEY = "text-right tabular-nums whitespace-nowrap"
const percent = new Intl.NumberFormat("en-IE", { style: "percent", maximumFractionDigits: 0 })
const share = (n: number) => (n > 0 && n < 0.005 ? "<1%" : percent.format(n))
const sumOf = (balances: Map<string, number | null>) => round2([...balances.values()].reduce<number>((t, v) => t + (v ?? 0), 0))
const shift = (ym: string, months: number) => format(addMonths(parseYearMonth(ym), months), "yyyy-MM")
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const balanceCell = (v: number | null | undefined) => (v === null || v === undefined ? "Not open yet" : eurCents(v))

/**
 * The company's cash flow at a glance: what came in and went out, month by
 * month, where it went, where it came from, how it was paid and how the
 * balances moved, then the year month by month (the old Months tab, CashBook.dc
 * has five views). Every figure is the Movements and Cost Centres tabs' own. No
 * tax figure: an F24 paid is money out like any other.
 */
export function SummaryTab({
  accounts,
  counted,
  data,
  today,
  ym,
  onMonth,
  onShowMonth,
  accountId,
}: {
  accounts: CompanyAccount[]
  /** Rows that reach a balance (splitRows). */
  counted: CashRow[]
  data: { invoices: Invoice[]; expenses: CompanyExpense[]; loans: CompanyLoan[]; movements: CompanyMovement[] }
  /** "yyyy-MM-dd". */
  today: string
  /** The page's month: A Month shows it, so the arrows above move it. */
  ym: string
  onMonth: (ym: string) => void
  /** A month opened from the Months card: its Movements. */
  onShowMonth: (ym: string) => void
  /** One account, or null for every account. */
  accountId: string | null
}) {
  const thisMonth = today.slice(0, 7)
  const thisYear = today.slice(0, 4)
  // As the Export dialog: from the book's first month (or the page's, if earlier) to this one,
  // or to the page's month if the arrows went past it, so the select always names it.
  const first = [...accounts.map((a) => isoDate(a.openingDate).slice(0, 7)), ...counted.map((r) => r.day.slice(0, 7)), ym].sort()[0]
  const months: string[] = []
  for (let m = [thisMonth, ym].sort()[1]; m >= first && months.length < 240; m = shift(m, -1)) months.push(m)
  const years = [...new Set(months.map((m) => m.slice(0, 4)))]

  const [mode, setMode] = useState<"month" | "year" | "range">("month")
  const [year, setYear] = useState(ym.slice(0, 4))
  const [from, setFrom] = useState(`${thisMonth}-01`)
  const [to, setTo] = useState(today)
  // The arrows above the tabs move the page's month: the Summary follows them into A Month, never ignores them.
  const [shownYm, setShownYm] = useState(ym)
  if (ym !== shownYm) {
    setShownYm(ym)
    setMode("month")
  }
  const period: Period =
    mode === "month" ? (ym === thisMonth ? "this_month" : "month") : mode === "year" ? (year === thisYear ? "this_year" : "year") : "range"
  const choose = (p: Period) => {
    // "A Month" from this month opens on the last one, as the Export dialog does; "A Year" likewise.
    if (p === "this_month") onMonth(thisMonth)
    if (p === "month" && ym === thisMonth) onMonth(months.find((m) => m < thisMonth) ?? thisMonth)
    if (p === "this_year") setYear(thisYear)
    if (p === "year" && year === thisYear) setYear(years.find((y) => y < thisYear) ?? thisYear)
    setMode(p === "this_month" || p === "month" ? "month" : p === "range" ? "range" : "year")
  }

  const range =
    mode === "month"
      ? { from: `${ym}-01`, to: monthEnd(ym) }
      : mode === "year"
        ? { from: `${year}-01-01`, to: `${year}-12-31` }
        : { from, to }
  const valid = Boolean(range.from && range.to && range.from <= range.to)
  const s = valid ? cashFlowSummary({ accounts, counted, ...data }, { ...range, accountId }, today) : null
  const accountName = accounts.find((a) => a.id === accountId)?.name ?? null
  const scope = accountId === null ? accounts : accounts.filter((a) => a.id === accountId)
  // Colour follows the account, never its place in the filter.
  const series = scope.map((a) => ({ id: a.id, name: a.name, series: seriesOf(accounts.indexOf(a)) }))
  const name = (id: string) => accounts.find((a) => a.id === id)?.name ?? "Unknown account"
  const soFar = range.to >= today && range.from <= today
  const monthName = (m: string) => `${formatYearMonth(m)}${m === thisMonth ? " (so far)" : ""}`
  const short = shortMonths((s?.months ?? []).map((m) => m.ym))
  const points: BalancePoint[] = s?.start
    ? [
        { key: "start", label: "Start", name: `Start, ${dayLabel(s.start.day)}`, ends: s.start.balances },
        ...s.months.map((m, i) => ({
          key: m.ym,
          label: short[i],
          // A range ending mid-month: the balance is that day's, and says so.
          name: range.to < monthEnd(m.ym) ? `End, ${dayLabel(range.to)}` : `End of ${monthName(m.ym)}`,
          ends: m.ends,
        })),
      ]
    : []

  const net =
    s && s.net > 0
      ? `${eurCents(s.net)} more came in than went out.`
      : s && s.net < 0
        ? `${eurCents(-s.net)} more went out than came in.`
        : "As much came in as went out."

  return (
    <div className="flex flex-col gap-5 sm:gap-6">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Period" id="summary-period">
            <Select value={period} onValueChange={(p) => p && choose(p as Period)}>
              <SelectTrigger id="summary-period" className="h-11 w-full text-sm sm:w-64">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PERIODS.map((p) => (
                  <SelectItem key={p.value} value={p.value}>
                    {p.value === "this_month" ? `This Month (${formatYearMonth(thisMonth)})` : p.value === "this_year" ? `This Year (${thisYear})` : p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {period === "month" && (
            <Field label="Month" id="summary-month">
              <Select value={ym} onValueChange={(m) => m && onMonth(m)}>
                <SelectTrigger id="summary-month" className="h-11 w-full text-sm sm:w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {months.map((m) => (
                    <SelectItem key={m} value={m}>
                      {formatYearMonth(m)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
          {period === "year" && (
            <Field label="Year" id="summary-year">
              <Select value={year} onValueChange={(y) => y && setYear(y)}>
                <SelectTrigger id="summary-year" className="h-11 w-full text-sm sm:w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {years.map((y) => (
                    <SelectItem key={y} value={y}>
                      {y}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
          {period === "range" && (
            <>
              <Field label="From" id="summary-from">
                <Input id="summary-from" type="date" className="h-11" value={from} onChange={(e) => setFrom(e.target.value)} />
              </Field>
              <Field label="To" id="summary-to">
                <Input id="summary-to" type="date" className="h-11" value={to} onChange={(e) => setTo(e.target.value)} />
              </Field>
            </>
          )}
        </div>
        {s ? (
          <p className="text-meta text-subtle-foreground">
            {accountName ?? "Every account"}, {dayLabel(range.from)} to {dayLabel(range.to)}
            {soFar ? " (so far)" : ""}
          </p>
        ) : (
          <p role="status" className="text-sm text-muted-foreground">
            Pick a start date on or before the end date.
          </p>
        )}
      </div>

      {s &&
        (s.months.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {range.from > today
              ? "This period has not started yet: nothing to sum up."
              : `No account was open from ${dayLabel(range.from)} to ${dayLabel(range.to)}: nothing to sum up.`}
          </p>
        ) : (
          <>
            <StatStrip aria-label="Period totals">
              <StatCard
                label="Money In"
                value={<SignedAmount amount={s.in} kind="in" format={eurCents} className="font-semibold" />}
                detail={`Into ${accountName ?? "your accounts"}, deposits included.`}
              />
              <StatCard
                label="Money Out"
                value={<SignedAmount amount={s.out} kind="out" format={eurCents} className="font-semibold" />}
                detail={`Out of ${accountName ?? "your accounts"}, deposits included.`}
              />
              <StatCard label="Net" value={<SignedAmount amount={s.net} format={eurCents} className="font-semibold" />} detail={net} />
              {s.transfers !== 0 && (
                <StatCard
                  label="Transfers (Net)"
                  value={<span className="text-muted-foreground">{eurCents(s.transfers)}</span>}
                  detail={`${s.transfers > 0 ? "Moved in from" : "Moved out to"} your other accounts: neither income nor spending, yet in the balance.`}
                />
              )}
            </StatStrip>

            <ChartCard
              title="Money In and Out by Month"
              chart={<InOutChart months={s.months} />}
              table={
                // Smaller type, and a first column that wraps, on a phone: the Net column sat out of view in the table's scroll.
                <Table className="text-xs sm:text-sm">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Month</TableHead>
                      <TableHead className="text-right">In</TableHead>
                      <TableHead className="text-right">Out</TableHead>
                      <TableHead className="text-right">Net</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {s.months.map((m) => (
                      <TableRow key={m.ym}>
                        <TableCell className="sm:whitespace-nowrap">{monthName(m.ym)}</TableCell>
                        <TableCell className={cn(MONEY, m.in > 0 && IN_TONE)}>{eurCents(m.in)}</TableCell>
                        <TableCell className={MONEY}>{eurCents(m.out)}</TableCell>
                        <TableCell className={MONEY}>
                          <SignedAmount amount={m.net} format={eurCents} className="font-normal" />
                        </TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="font-medium">
                      <TableCell>Total</TableCell>
                      <TableCell className={cn(MONEY, s.in > 0 && IN_TONE)}>{eurCents(s.in)}</TableCell>
                      <TableCell className={MONEY}>{eurCents(s.out)}</TableCell>
                      <TableCell className={MONEY}>
                        <SignedAmount amount={s.net} format={eurCents} />
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              }
            />

            <ChartCard
              title="Balances Over Time"
              chart={<BalancesChart points={points} accounts={series} />}
              table={
                <Table className="text-xs sm:text-sm">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Day</TableHead>
                      {scope.map((a) => (
                        <TableHead key={a.id} className="text-right">
                          {a.name}
                        </TableHead>
                      ))}
                      {scope.length > 1 && <TableHead className="text-right">Total</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {points.map((p) => (
                      <TableRow key={p.key}>
                        <TableCell className="sm:whitespace-nowrap">{p.name}</TableCell>
                        {scope.map((a) => (
                          <TableCell key={a.id} className={MONEY}>
                            {balanceCell(p.ends.get(a.id))}
                          </TableCell>
                        ))}
                        {scope.length > 1 && <TableCell className={cn(MONEY, "font-medium")}>{eurCents(sumOf(p.ends))}</TableCell>}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              }
            />

            <div className="grid gap-5 lg:grid-cols-2">
              <Section title="Where the Money Went">
                <Groups groups={s.spending} empty="Nothing went out." bar="bg-foreground" />
                {s.depositsOut.length > 0 && (
                  <Apart title="Deposits, Apart" help="Money paid or given back as a deposit: held for someone, not spending.">
                    <Groups groups={s.depositsOut} bar="bg-border-strong" />
                  </Apart>
                )}
                <TotalLine label="Money Out" value={s.out} />
              </Section>

              <Section title="Where It Came From">
                <Groups groups={s.income} empty="Nothing came in." bar="bg-success" />
                {s.depositsIn.length > 0 && (
                  <Apart title="Deposits, Apart" help="Deposits received or paid back to you: money held, not income.">
                    <Groups groups={s.depositsIn} bar="bg-border-strong" />
                  </Apart>
                )}
                <TotalLine label="Money In" value={s.in} />
              </Section>

              <Section title="How It Was Paid">
                <h3 className="text-meta font-medium text-subtle-foreground">Moved Money</h3>
                {s.byAccount.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No money left the accounts.</p>
                ) : (
                  <ul className="space-y-2 text-sm">
                    {s.byAccount.map((a) => (
                      <li key={a.accountId}>
                        <Line label={`Out of ${name(a.accountId)}`} value={eurCents(a.out)} />
                        {a.transfersOut > 0 && (
                          <p className="text-meta text-muted-foreground">Also moved {eurCents(a.transfersOut)} to your other accounts: not spending.</p>
                        )}
                        {a.transfersIn > 0 && (
                          <p className="text-meta text-muted-foreground">Received {eurCents(a.transfersIn)} from your other accounts: not income.</p>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                <h3 className="border-t border-hairline pt-3 text-meta font-medium text-subtle-foreground">Moved No Company Money</h3>
                {s.offBank ? (
                  <ul className="space-y-2 text-sm">
                    <li>
                      <Line label="Your personal card" value={eurCents(s.offBank.ownerCard.amount)} />
                      <p className="text-meta text-muted-foreground">
                        {s.offBank.ownerCard.count === 0
                          ? "No cost paid with your own card."
                          : `${plural(s.offBank.ownerCard.count, "cost")} you paid with your own card, dated in the period. What the SRL still owes you is on the Owed & Held tab.`}
                      </p>
                    </li>
                    <li>
                      <Line label="Supplier invoices not paid yet" value={eurCents(s.offBank.supplierOwed.amount)} />
                      <p className="text-meta text-muted-foreground">
                        {s.offBank.supplierOwed.count === 0
                          ? "Every supplier invoice dated in the period was paid by its end."
                          : `Still owed ${range.to >= today ? "today" : `on ${dayLabel(range.to)}`} on ${plural(s.offBank.supplierOwed.count, "supplier invoice")} dated in the period.`}
                      </p>
                    </li>
                    {s.offBank.noAccount.count > 0 && (
                      <li>
                        <Line label="Not paid from an account" value={eurCents(s.offBank.noAccount.amount)} />
                        <p className="text-meta text-muted-foreground">
                          {plural(s.offBank.noAccount.count, "cost")} dated in the period with no account, card or supplier invoice:
                          recorded, no money moved.
                        </p>
                      </li>
                    )}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Costs paid with your own card and supplier invoices go through no account: choose All Accounts to see them.
                  </p>
                )}
              </Section>

              <Section title="Money Out by Cost Centre">
                {s.costCentres.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nothing went out.</p>
                ) : (
                  <Groups
                    groups={s.costCentres.map((c) => ({ label: c.name, amount: c.amount, share: c.share, count: null }))}
                    bar="bg-foreground"
                  />
                )}
              </Section>
            </div>

            <Section title="Biggest Costs">
              {s.topCosts.length === 0 ? (
                <p className="text-sm text-muted-foreground">No cost was paid from the accounts.</p>
              ) : (
                <ol className="divide-y divide-hairline text-sm">
                  {s.topCosts.map((p) => (
                    <li key={p.name} className="py-2 first:pt-0 last:pb-0">
                      <Line label={`${p.name} · ${plural(p.count, "payment")}`} value={eurCents(p.amount)} />
                    </li>
                  ))}
                </ol>
              )}
            </Section>
          </>
        ))}

      {/* The year the period ends in, as the totals above: A Year's own, a range's last day's, the page month's. */}
      <MonthsCard
        accounts={accounts}
        counted={counted}
        year={Number((range.to || ym).slice(0, 4))}
        today={today}
        accountId={accountId}
        onMonth={onShowMonth}
      />

      {/* The help each card used to carry, in one place: the cards keep only their figures. */}
      <details className="group rounded-xl border border-hairline bg-sidebar px-[18px] py-1 text-sm sm:px-[22px]">
        <summary className="-mx-1 flex min-h-11 cursor-pointer list-none items-center gap-1.5 rounded-md px-1 font-medium text-subtle-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none [&::-webkit-details-marker]:hidden">
          <ChevronRight aria-hidden className="size-4 transition-transform group-open:rotate-90 motion-reduce:transition-none" />
          How this is counted
        </summary>
        <ul className="flex max-w-[68ch] list-disc flex-col gap-1.5 pb-3.5 pl-5 text-subtle-foreground">
          <li>
            In and Out leave out transfers between your own accounts: they move a balance, so they show apart as Transfers
            (Net). Deposits count in both, and show apart in each list.
          </li>
          <li>Taxes are your accountant&apos;s job: an F24 you paid shows here as money out, nothing more.</li>
          <li>Money In and Out by Month: each month&apos;s money in and out of the accounts; the dashed line across each month is the net.</li>
          <li>
            Balances Over Time: each account&apos;s balance at the start, then on every month&apos;s last day (or a range&apos;s last
            day); this month&apos;s is today&apos;s.
          </li>
          <li>
            Where the Money Went and Where It Came From: every euro that left or came into the accounts, by type, with the names
            the Movements tab uses. Shares are of all money out, or all money in.
          </li>
          <li>How It Was Paid: what moved money out of the accounts, and what was spent without moving any.</li>
          <li>
            Money Out by Cost Centre: the money out, deposits aside, by cost centre, so it adds up to the same total. A supplier
            invoice payment takes its invoice&apos;s; rows with none, such as a loan paid back, are {UNTAGGED}. The Cost Centres
            tab counts costs at their document date instead.
          </li>
          <li>
            Biggest Costs: the costs and supplier invoices that took the most money out, by name: the cost&apos;s description, or
            the supplier invoice paid. Loans, taxes and deposits are left out.
          </li>
          <li>
            Months: each balance is the one at the month&apos;s last day, or today&apos;s for this month. It lists the year the
            period ends in. Open a month to see its movements.
          </li>
        </ul>
      </details>
    </div>
  )
}

function Field({ label, id, children }: { label: string; id: string; children: ReactNode }) {
  return (
    <div className="w-full space-y-2 sm:w-auto">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  )
}

/** A card of figures: its title names the region. */
function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = useId()
  return (
    <ContentCard as="section" labelledBy={id} className="flex min-w-0 flex-col gap-3">
      <SectionHeader variant="card" id={id} title={title} />
      {children}
    </ContentCard>
  )
}

/** A chart with its figures one click away, as a table. */
function ChartCard({ title, chart, table }: { title: string; chart: ReactNode; table: ReactNode }) {
  const id = useId()
  const [asTable, setAsTable] = useState(false)
  return (
    <ContentCard as="section" labelledBy={id} className="flex min-w-0 flex-col gap-4">
      <SectionHeader
        variant="card"
        id={id}
        title={title}
        actions={
          <Button variant="outline" size="sm" onClick={() => setAsTable(!asTable)}>
            {asTable ? "Show as Chart" : "Show as Table"}
          </Button>
        }
      />
      {asTable ? table : chart}
    </ContentCard>
  )
}

function Groups({ groups, empty, bar }: { groups: (Omit<FlowGroup, "count"> & { count: number | null })[]; empty?: string; bar: string }) {
  if (groups.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>
  return (
    <ul className="space-y-2">
      {groups.map((g) => (
        <li key={g.label} className="text-sm">
          <Line
            label={
              <>
                {g.label}
                {g.count !== null && <span className="text-muted-foreground"> · {plural(g.count, "row")}</span>}
              </>
            }
            value={
              <>
                {eurCents(g.amount)} <span className="inline-block w-9 text-muted-foreground">{share(g.share)}</span>
              </>
            }
          />
          <div aria-hidden className="mt-1.5 h-1.5 rounded-[3px] bg-muted">
            <div className={cn("h-full rounded-[3px]", bar)} style={{ width: `${Math.max(0, Math.min(100, g.share * 100))}%` }} />
          </div>
        </li>
      ))}
    </ul>
  )
}

function Line({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="min-w-0 [overflow-wrap:anywhere]">{label}</span>
      <span className="shrink-0 text-right tabular-nums">{value}</span>
    </div>
  )
}

function Apart({ title, help, children }: { title: string; help: string; children: ReactNode }) {
  return (
    <div className="space-y-2 border-t border-hairline pt-3">
      <h3 className="text-meta font-medium text-subtle-foreground">{title}</h3>
      <p className="text-meta text-muted-foreground">{help}</p>
      {children}
    </div>
  )
}

function TotalLine({ label, value }: { label: string; value: number }) {
  return (
    <div className="mt-auto border-t pt-2.5 text-sm font-medium">
      <Line label={label} value={eurCents(value)} />
    </div>
  )
}

/** The Verifica sheet, the old Months tab: each month of the year's In, Out, Net and every account's end balance. */
function MonthsCard({
  accounts,
  counted,
  year,
  today,
  accountId,
  onMonth,
}: {
  accounts: CompanyAccount[]
  counted: CashRow[]
  year: number
  today: string
  accountId: string | null
  onMonth: (ym: string) => void
}) {
  const id = useId()
  const scope = accountId === null ? accounts : accounts.filter((a) => a.id === accountId)
  const months = monthEnds(accounts, counted, year, today.slice(0, 7), accountId)
  // This month has not ended: its balances are today's.
  const monthName = (ym: string) => `${formatYearMonth(ym, "MMMM")}${ym === today.slice(0, 7) ? " (so far)" : ""}`
  const endDay = (ym: string) => dayLabel(ym === today.slice(0, 7) ? today : monthEnd(ym)).slice(0, 5)
  return (
    <DataTableCard role="region" aria-labelledby={id}>
      <SectionHeader
        variant="card"
        id={id}
        title="Months"
        description={`${year}, each balance on the month's last day`}
        className="px-[18px] py-3.5 sm:px-[22px]"
      />
      {months.length === 0 ? (
        <p className="border-t border-hairline px-[18px] py-4 text-sm text-muted-foreground sm:px-[22px]">
          No month of {year} has an open account yet.
        </p>
      ) : (
        <>
          {/* A phone gets one row per month that names every balance: the balances, which the check is about, never go off screen. */}
          <ul className="divide-y divide-hairline border-t border-hairline sm:hidden">
            {months.map((m) => (
              <li key={m.ym}>
                <button
                  type="button"
                  className="flex w-full flex-col gap-1 px-[18px] py-3 text-left text-sm transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring motion-reduce:transition-none"
                  onClick={() => onMonth(m.ym)}
                >
                  <span className="flex justify-between gap-3 font-medium">
                    <span>{monthName(m.ym)}</span>
                    <span className="tabular-nums">
                      Net <SignedAmount amount={m.net} format={eurCents} />
                    </span>
                  </span>
                  <span className="block text-meta text-muted-foreground tabular-nums">
                    In {eurCents(m.in)} · Out {eurCents(m.out)}
                  </span>
                  {scope.map((a) => {
                    const end = m.ends.get(a.id)
                    return (
                      <span key={a.id} className="flex justify-between gap-3 text-subtle-foreground">
                        <span className="min-w-0">
                          {a.name}, {endDay(m.ym)}
                        </span>
                        <span className="shrink-0 tabular-nums">{end === null || end === undefined ? "Not open yet" : eurCents(end)}</span>
                      </span>
                    )
                  })}
                  {scope.length > 1 && (
                    <span className="flex justify-between gap-3 border-t border-hairline pt-1 font-medium">
                      <span>Total</span>
                      <span className="tabular-nums">{eurCents(m.total)}</span>
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
          <Table className="max-sm:hidden">
            <TableHeader>
              <TableRow className="border-t border-t-hairline">
                <TableHead>Month</TableHead>
                <TableHead className="text-right">In</TableHead>
                <TableHead className="text-right">Out</TableHead>
                <TableHead className="text-right">Net</TableHead>
                {scope.map((a) => (
                  <TableHead key={a.id} className="text-right">
                    {a.name}
                  </TableHead>
                ))}
                {scope.length > 1 && <TableHead className="text-right">Total</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {months.map((m) => (
                <TableRow key={m.ym} className="cursor-pointer" onClick={() => onMonth(m.ym)}>
                  <TableCell className="whitespace-nowrap">
                    {/* No handler of its own: Enter clicks it and the click reaches the row. */}
                    <button type="button" className="font-medium underline-offset-4 hover:underline">
                      {monthName(m.ym)}
                    </button>
                  </TableCell>
                  <TableCell className={cn(MONEY, m.in > 0 && IN_TONE)}>{eurCents(m.in)}</TableCell>
                  <TableCell className={MONEY}>{eurCents(m.out)}</TableCell>
                  <TableCell className={MONEY}>
                    <SignedAmount amount={m.net} format={eurCents} className="font-normal" />
                  </TableCell>
                  {scope.map((a) => {
                    const end = m.ends.get(a.id)
                    return (
                      <TableCell key={a.id} className={MONEY}>
                        {end === null || end === undefined ? "—" : eurCents(end)}
                      </TableCell>
                    )
                  })}
                  {scope.length > 1 && <TableCell className={cn(MONEY, "font-medium")}>{eurCents(m.total)}</TableCell>}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </>
      )}
    </DataTableCard>
  )
}
