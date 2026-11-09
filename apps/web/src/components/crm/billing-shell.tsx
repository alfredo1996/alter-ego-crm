"use client"

import { eur } from "@alter-ego/kernel/currency"
import { formatYearMonth, isoDate } from "@alter-ego/kernel/dates"
import { ContentCard } from "@alter-ego/ui/page/content-card"
import { EmptyPrompt } from "@alter-ego/ui/page/empty-prompt"
import { FilterBar, FilterSelect } from "@alter-ego/ui/page/filter-bar"
import { PageHeader } from "@alter-ego/ui/page/page-header"
import { pageState } from "@alter-ego/ui/page/page-state"
import { SectionHeader } from "@alter-ego/ui/page/section-header"
import { StatCard, StatStrip } from "@alter-ego/ui/page/stat-card"
import { StatusTabs } from "@alter-ego/ui/page/status-tabs"
import { badgeVariants } from "@alter-ego/ui/ui/badge"
import { Button } from "@alter-ego/ui/ui/button"
import { cn } from "@alter-ego/ui/utils"
import { format, subMonths } from "date-fns"
import { ChevronRight, Plus } from "lucide-react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useEffect, useId, useMemo, useState } from "react"

import { InvoiceSheet, type InvoiceSheetState } from "@/components/crm/invoice-sheet"
import { InvoiceTable } from "@/components/crm/invoice-table"
import { useAuth } from "@/hooks/use-auth"
import { useClients } from "@/hooks/use-clients"
import { useEngagements } from "@/hooks/use-engagements"
import { useInvoices } from "@/hooks/use-invoices"
import { useOpenFromQuery } from "@/hooks/use-open-from-query"
import { useTimecards } from "@/hooks/use-timecards"
import { monthsFrom } from "@/lib/engagement-burndown"
import { engagementLabel } from "@/lib/engagements"
import {
  clientBilling,
  eurCents,
  invoiceClientId,
  invoicedByMonth,
  invoicePeriodLabel,
  invoiceSuggestions,
  isInvoiceOverdue,
  outstanding,
} from "@/lib/invoices"


import type { ClientBilling } from "@/lib/invoices"
import type { Client, Engagement, Invoice } from "@/types"
import type { ReactNode } from "react"

/**
 * Bar labels between md and lg: "€11K". Twelve columns beside the sidebar are too narrow for
 * "€10,580" (eur), which every other width and the client page's six take.
 */
const eurCompact = new Intl.NumberFormat("en-IE", {
  style: "currency",
  currency: "EUR",
  notation: "compact",
}).format

/** Invoices bill the customer: the balance, and what it owes, are the client's. */
type ClientRow = {
  client: Client
  billing: ClientBilling
  /** Unpaid incl. VAT, clamped at 0 per client (see outstanding). */
  owed: number
}

/** The Status tabs; `?status=` holds all but All. Unpaid counts the overdue ones and open credit notes. */
const TABS = { all: "All", unpaid: "Unpaid", overdue: "Overdue", paid: "Paid" } as const
type Tab = keyof typeof TABS
const TAB_KEYS = Object.keys(TABS) as Tab[]
const IN_TAB: Record<Tab, (invoice: Invoice) => boolean> = {
  all: () => true,
  unpaid: (i) => !i.paidDate,
  overdue: (i) => isInvoiceOverdue(i),
  paid: (i) => !!i.paidDate,
}

const sum = (values: number[]) => values.reduce((total, v) => total + v, 0)
const count = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`
const LINK =
  "rounded-sm text-subtle-foreground underline underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:-my-3 pointer-coarse:inline-block pointer-coarse:py-3"

/**
 * The company's /invoices page: what logged hours are worth against what was
 * invoiced, over every client, and the invoices themselves. Each change goes
 * through the one InvoiceSheet, opened from a Ready card, Create Invoice or an
 * invoice row. Every figure comes from lib/invoices, so this page, a client's
 * page (client-page.tsx, which reuses the chart) and get_unbilled agree to the cent.
 */
export function BillingShell() {
  const { user } = useAuth()
  const clientsQuery = useClients(user?.id)
  const engagementsQuery = useEngagements(user?.id)
  const invoicesQuery = useInvoices(user?.id)
  const timecardsQuery = useTimecards(user?.id)
  const { data: clients = [] } = clientsQuery
  const { data: engagements = [] } = engagementsQuery
  const { data: invoices = [] } = invoicesQuery
  const { data: timecards = [] } = timecardsQuery
  const router = useRouter()
  const params = useSearchParams()
  // The one editor: every entry point sets this, nothing edits inline.
  const [sheet, setSheet] = useState<InvoiceSheetState | null>(null)
  // Back from an invoice's file lands on that invoice.
  useOpenFromQuery(invoicesQuery.isSuccess, (id) => {
    if (invoices.some((i) => i.id === id)) setSheet({ kind: "edit", invoiceId: id })
  })
  const [search, setSearch] = useState("")

  // Hours after today are scheduled: they count from their day on.
  const today = isoDate(new Date())
  const currentMonth = today.slice(0, 7)
  const rows = useMemo(
    () =>
      clients
        .map(
          (client): ClientRow => ({
            client,
            billing: clientBilling({ clientId: client.id, engagements, timecards, invoices, today }),
            owed: outstanding(invoices.filter((i) => invoiceClientId(i, engagements) === client.id)),
          }),
        )
        // A client with nothing logged, invoiced or owed and no active contract has nothing to say.
        .filter(
          (r) =>
            r.billing.months.length > 0 ||
            r.owed !== 0 ||
            engagements.some((e) => e.clientId === r.client.id && e.isActive),
        ),
    [clients, engagements, timecards, invoices, today],
  )
  const ready = useMemo(() => readyItems({ rows, engagements, currentMonth, open: setSheet }), [rows, engagements, currentMonth])

  const gate = pageState([clientsQuery, engagementsQuery, invoicesQuery, timecardsQuery])
  const loaded = gate === null
  useEffect(() => {
    // Next scrolls to #invoices once, on arrival, while the spinner still stands
    // in for the cards: scroll again once they exist.
    if (loaded && location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView()
  }, [loaded])
  if (gate) return gate

  const go = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString())
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value)
      else next.delete(key)
    }
    const query = next.toString()
    router.replace(query ? `/invoices?${query}` : "/invoices", { scroll: false })
  }
  const statusParam = params.get("status")
  const tab = TAB_KEYS.find((t) => t !== "all" && t === statusParam) ?? "all"
  const customer = params.get("customer")

  // Resolved to a live client, so an invoice whose customer is gone is never listed or counted overdue.
  const nameById = new Map(clients.map((c) => [c.id, c.name]))
  const customerOf = (i: Invoice) => invoiceClientId(i, engagements) ?? ""
  const scopedInvoices = invoices.filter((i) => nameById.has(customerOf(i)))
  const q = search.trim().toLowerCase()
  const match = (i: Invoice) =>
    (!customer || customerOf(i) === customer) &&
    (!q || i.number.toLowerCase().includes(q) || (nameById.get(customerOf(i)) ?? "").toLowerCase().includes(q))
  const matching = scopedInvoices.filter(match)
  const customerOptions = clients
    .filter((c) => scopedInvoices.some((i) => customerOf(i) === c.id))
    .map((c) => ({ value: c.id, label: c.name }))
    .sort((a, b) => a.label.localeCompare(b.label))
  const showAll = () => {
    setSearch("")
    go({ status: null, customer: null })
  }

  // The chart's first month is also where older months and paid invoices fold away.
  const firstMonth = format(subMonths(new Date(), 11), "yyyy-MM")

  return (
    <div className="flex flex-col gap-6 sm:gap-7">
      <PageHeader
        title="Invoices"
        subtitle="Record what you invoice and mark it paid when the money arrives."
        actions={
          <Button size="lg" aria-haspopup="dialog" onClick={() => setSheet({ kind: "record", clientId: null })}>
            <Plus aria-hidden />
            Create Invoice
          </Button>
        }
      />
      <Summary
        rows={rows}
        invoices={scopedInvoices}
        currentMonth={currentMonth}
        readyFrom={ready.from}
        // The link sets the Overdue tab and drops the customer; the search is state, so it goes here.
        onOverdue={() => setSearch("")}
      />

      <section id="ready" aria-labelledby="ready-title" className="flex scroll-mt-20 flex-col gap-4">
        <SectionHeader
          id="ready-title"
          title="Ready to Invoice"
          description={
            ready.from === "ended"
              ? "Ended months, net · from your logged hours"
              : ready.from === "month"
                ? `${formatYearMonth(currentMonth, "MMMM")} so far, net · ended months are all invoiced`
                : undefined
          }
        />
        {ready.items.length === 0 ? (
          <EmptyPrompt variant="inline" title="Nothing to invoice: every ended month with hours is invoiced." />
        ) : (
          <ReadyCards items={ready.items} />
        )}
      </section>

      {/* tabIndex: where the invoice sheet hands focus back when what opened it is gone. */}
      <section
        id="invoices"
        tabIndex={-1}
        aria-labelledby="invoices-title"
        className="flex scroll-mt-20 flex-col gap-4 outline-none"
      >
        <SectionHeader
          id="invoices-title"
          title="Invoices"
          description={
            <>
              {scopedInvoices.length}
              <span className="max-sm:hidden"> · open one to edit it or issue a credit note</span>
              <span className="sm:hidden"> · tap one to edit it</span>
            </>
          }
        />
        {scopedInvoices.length === 0 ? (
          <EmptyPrompt variant="inline" title="No invoices recorded yet." />
        ) : (
          <StatusTabs
            aria-label="Status"
            value={tab}
            onValueChange={(t) => go({ status: t === "all" ? null : t })}
            items={TAB_KEYS.map((t) => ({ value: t, label: TABS[t], count: matching.filter(IN_TAB[t]).length }))}
            toolbar={
              // On a phone the customer select folds into the Filters sheet; the search stays.
              <FilterBar
                className="sm:ml-auto sm:flex-[0_1_28rem]"
                search={{ label: "Search invoices", placeholder: "Number or customer…", value: search, onChange: setSearch }}
                sheet={{ active: customer ? 1 : 0 }}
              >
                <FilterSelect
                  label="Customer"
                  allLabel="All customers"
                  value={customer}
                  options={customerOptions}
                  onValueChange={(c) => go({ customer: c })}
                />
              </FilterBar>
            }
          >
            <InvoiceTable
              // A new tab is a new table: a row paid under Unpaid stays only until the tab changes.
              key={tab}
              userId={user?.id}
              invoices={scopedInvoices}
              engagements={engagements}
              customers={clients}
              firstMonth={firstMonth}
              onOpen={(invoiceId) => setSheet({ kind: "edit", invoiceId })}
              tab={IN_TAB[tab]}
              match={match}
              empty={
                <EmptyPrompt
                  variant="inline"
                  title="No invoices match these filters."
                  action={
                    <Button variant="outline" onClick={showAll}>
                      Show All
                    </Button>
                  }
                />
              }
            />
          </StatusTabs>
        )}
      </section>

      <InvoicedChart
        // The months' own figures, so the bars draw exactly what the rows reconcile.
        invoiced={rows.flatMap((r) => invoicedMonths(r.billing))}
        currentMonth={currentMonth}
        firstMonth={firstMonth}
        logged={sum(rows.map((r) => r.billing.thisMonth ?? 0))}
      />
      <InvoiceSheet userId={user?.id} state={sheet} onStateChange={setSheet} />
    </div>
  )
}

/** A client's net invoiced per month worked, for the chart: the months' own shares of each invoice. */
export function invoicedMonths(billing: ClientBilling): { yearMonth: string; amount: number }[] {
  return billing.months.filter((m) => m.invoices.length > 0).map((m) => ({ yearMonth: m.yearMonth, amount: m.invoiced }))
}

/** A soft red pill that is a link: "1 overdue", to the invoices. Drawn 20 px tall, 44 to a finger. */
const OVERDUE_PILL = cn(
  badgeVariants({ variant: "danger" }),
  "relative whitespace-nowrap px-[9px] after:absolute after:-inset-x-1 after:-inset-y-3 hover:underline focus-visible:ring-2 focus-visible:ring-ring",
)

/** The three figures over the page: what to invoice, the month being worked, what is owed. */
function Summary({
  rows,
  invoices,
  currentMonth,
  readyFrom,
  onOverdue,
}: {
  rows: ClientRow[]
  invoices: Invoice[]
  currentMonth: string
  /** What the Ready cards below hold: its figure says "See below". */
  readyFrom: ReadyFrom
  /** Clears the search, so the Overdue tab the link opens lists every overdue invoice. */
  onOverdue: () => void
}) {
  // Clients with hours logged: the only ones with a balance to speak of.
  const tracked = rows.map((r) => r.billing).filter((b) => b.toInvoice !== null)
  const toInvoice = sum(tracked.map((b) => Math.max(0, b.toInvoice ?? 0)))
  const hours = sum(tracked.map((b) => b.thisMonthHours ?? 0))
  const working = tracked.filter((b) => (b.thisMonthHours ?? 0) > 0).length
  const overdue = invoices.filter((i) => isInvoiceOverdue(i)).length
  const open = invoices.filter((i) => !i.paidDate && i.amount > 0).length
  const seeBelow = (
    <>
      {" · "}
      <a href="#ready" className={LINK}>
        See below
      </a>
    </>
  )
  // To the Overdue tab, whatever tab, customer or search the table was on.
  const overdueLink = (className?: string) => (
    <Link href="/invoices?status=overdue#invoices" onClick={onOverdue} className={cn(OVERDUE_PILL, className)}>
      {overdue} overdue
    </Link>
  )

  return (
    <StatStrip>
      <StatCard
        label="To invoice"
        value={tracked.length ? eurCents(toInvoice) : "—"}
        detail={
          tracked.length === 0 ? (
            "no hours logged yet"
          ) : !tracked.some((b) => (b.loggedSince ?? currentMonth) < currentMonth) ? (
            "no ended month logged yet"
          ) : toInvoice > 0 ? (
            <>net · from hours in ended months{readyFrom === "ended" && seeBelow}</>
          ) : (
            "net · ended months are all invoiced"
          )
        }
      />
      <StatCard
        label={`Logged in ${formatYearMonth(currentMonth, "MMMM")}`}
        value={
          tracked.length ? (
            <>
              {/* A phone's row has no detail line: the hours lead the value there. */}
              <span className="text-meta font-normal tracking-normal text-subtle-foreground sm:hidden">{hours} h · </span>
              {eurCents(sum(tracked.map((b) => b.thisMonth ?? 0)))}
            </>
          ) : (
            "—"
          )
        }
        detail={
          hours > 0 ? (
            <>
              net · {hours} h across {count(working, "customer")}
              {readyFrom === "month" && seeBelow}
            </>
          ) : (
            "net · no hours yet"
          )
        }
      />
      <StatCard
        label="Unpaid"
        value={
          <span className="inline-flex items-center gap-2">
            {/* A phone's row has no detail line: the overdue pill moves beside the figure. */}
            {overdue > 0 && overdueLink("tracking-normal sm:hidden")}
            {eurCents(sum(rows.map((r) => r.owed)))}
          </span>
        }
        detail={
          <>
            incl. VAT · {open === 0 ? "nothing owed" : count(open, "invoice")}
            {overdue > 0 && <> {overdueLink()}</>}
          </>
        }
      />
    </StatStrip>
  )
}

/** Ended months the hours propose; with those all invoiced, the month being worked; or nothing. */
type ReadyFrom = "ended" | "month" | null

type ReadyItem = {
  key: string
  name: string
  amount: number
  vat: boolean
  /** "Oct 2026", "Jul–Sep 2026". */
  period: string
  /** "October 2026": the button's name says which. */
  periodLong: string
  hours: number
  contracts: string[]
  open: () => void
}

/** The Ready cards: invoiceSuggestions across clients, largest first, or else each client's month so far. */
function readyItems({
  rows,
  engagements,
  currentMonth,
  open,
}: {
  rows: ClientRow[]
  engagements: Engagement[]
  currentMonth: string
  open: (state: InvoiceSheetState) => void
}): { from: ReadyFrom; items: ReadyItem[] } {
  const contractsIn = (billing: ClientBilling, months: string[]) =>
    [...new Set(billing.months.filter((m) => months.includes(m.yearMonth)).flatMap((m) => m.contracts.map((l) => l.engagementId)))]
      .map((id) => engagements.find((e) => e.id === id))
      .filter((e) => e !== undefined)
      .map(engagementLabel)
  const ended = rows
    .flatMap((r) =>
      invoiceSuggestions(r.billing).map(
        (s): ReadyItem => ({
          key: `${s.clientId}-${s.yearMonth}`,
          name: r.client.name,
          amount: s.amount,
          vat: s.vat > 0,
          period: invoicePeriodLabel(s),
          periodLong: s.fromMonth ? invoicePeriodLabel(s) : formatYearMonth(s.yearMonth, "MMMM yyyy"),
          hours: s.hours,
          contracts: contractsIn(r.billing, s.months),
          open: () => open({ kind: "record", clientId: s.clientId, from: s.fromMonth ?? s.yearMonth, to: s.yearMonth }),
        }),
      ),
    )
    // Largest first; they add up to the To invoice figure.
    .sort((a, b) => b.amount - a.amount)
  if (ended.length) return { from: "ended", items: ended }
  const month = rows
    .flatMap((r) => {
      const m = r.billing.months.find((b) => b.yearMonth === currentMonth)
      const logged = m?.logged ?? 0
      // An invoice in advance already covers the month, as the chart reads it: nothing to offer until it ends.
      return m && logged > 0 && m.invoices.length === 0 ? [{ r, m, logged }] : []
    })
    .sort((a, b) => b.logged - a.logged)
    .map(
      ({ r, m, logged }): ReadyItem => ({
        key: `${r.client.id}-${currentMonth}`,
        name: r.client.name,
        amount: logged,
        vat: m.vatShare > 0,
        period: formatYearMonth(currentMonth, "MMM yyyy"),
        periodLong: formatYearMonth(currentMonth, "MMMM yyyy"),
        hours: m.hours ?? 0,
        contracts: contractsIn(r.billing, [currentMonth]),
        open: () => open({ kind: "record", clientId: r.client.id, from: currentMonth, to: currentMonth }),
      }),
    )
  return { from: month.length ? "month" : null, items: month }
}

/**
 * One card per invoice to create. On a phone one card of rows, as Invoices-phone.dc draws it: the
 * whole row is the button, a chevron where the desktop's Create Invoice is.
 */
function ReadyCards({ items }: { items: ReadyItem[] }) {
  return (
    <ul className="overflow-hidden rounded-xl border bg-card shadow-xs max-sm:divide-y max-sm:divide-hairline sm:grid sm:grid-cols-[repeat(auto-fill,minmax(300px,1fr))] sm:gap-5 sm:overflow-visible sm:rounded-none sm:border-0 sm:bg-transparent sm:shadow-none">
      {items.map((item) => (
        <li key={item.key}>
          <ReadyCard item={item} />
        </li>
      ))}
    </ul>
  )
}

function ReadyCard({ item }: { item: ReadyItem }) {
  const id = useId()
  return (
    <ContentCard
      labelledBy={id}
      // A phone's row: the name over its meta, then the amount, then the chevron.
      className="grid h-full grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3 gap-y-0.5 max-sm:min-h-16 max-sm:rounded-none max-sm:border-0 max-sm:py-2.5 max-sm:pr-3 max-sm:pl-4 max-sm:shadow-none sm:flex sm:flex-col sm:items-start sm:gap-2"
    >
      <h3 id={id} className="truncate text-[15px] font-medium sm:text-sm sm:text-subtle-foreground">
        {item.name}
      </h3>
      <p className="col-start-2 row-span-2 row-start-1 text-[15px] font-semibold whitespace-nowrap tabular-nums sm:text-2xl sm:tracking-[-0.02em]">
        {eurCents(item.amount)}
        {item.vat && <span className="text-meta font-normal tracking-normal text-muted-foreground max-sm:hidden"> + VAT</span>}
      </p>
      <p className="truncate text-meta text-muted-foreground tabular-nums sm:text-subtle-foreground">
        {[item.period, `${item.hours} h`, ...item.contracts].join(" · ")}
      </p>
      <Button
        variant="outline"
        aria-haspopup="dialog"
        aria-label={`Create Invoice for ${item.name}, ${item.periodLong}`}
        className="col-start-3 row-span-2 row-start-1 max-sm:size-auto max-sm:border-0 max-sm:bg-transparent max-sm:p-0 max-sm:shadow-none max-sm:after:absolute max-sm:after:inset-0 sm:mt-auto"
        onClick={item.open}
      >
        <Plus aria-hidden className="max-sm:hidden" />
        <span className="max-sm:hidden">Create Invoice</span>
        <ChevronRight aria-hidden className="text-muted-foreground sm:hidden" />
      </Button>
    </ContentCard>
  )
}

/** One of the chart's totals, in its header. */
function Figure({ term, value }: { term: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground sm:text-[12.5px]">{term}</dt>
      <dd className="text-[15px] font-semibold tabular-nums sm:text-base">{value}</dd>
    </div>
  )
}

/**
 * Plain CSS bars: twelve months worked, net of VAT, in neutral fills. A month being worked that has no
 * invoice yet draws its logged hours' value, light; a month with nothing invoiced, a short dash. On
 * /invoices a phone shows the last six. On a client's page (`compact`) six months inside its Billing
 * card, unframed.
 */
export function InvoicedChart({
  invoiced,
  currentMonth,
  firstMonth,
  logged = 0,
  compact,
  className,
}: {
  /** Net invoiced per client and month worked, from the billing months. */
  invoiced: { yearMonth: string; amount: number }[]
  currentMonth: string
  firstMonth: string
  /** The current month's logged value so far. */
  logged?: number
  /** The client page's chart. */
  compact?: boolean
  className?: string
}) {
  const count = compact ? 6 : 12
  const months = monthsFrom(firstMonth, count)
  const bars = invoicedByMonth(invoiced, months)
  // Logged, not invoiced: the month being worked, until an invoice covers it.
  const pending = (yearMonth: string, amount: number) =>
    yearMonth === currentMonth && amount === 0 && logged > 0 ? logged : 0
  const total = sum(bars.map((b) => b.amount))
  const max = Math.max(0, ...bars.map((b) => Math.max(b.amount, pending(b.yearMonth, b.amount))))
  const year = currentMonth.slice(0, 4)
  const yearSoFar = sum(
    invoiced.filter((i) => i.yearMonth.startsWith(year) && i.yearMonth <= currentMonth).map((i) => i.amount),
  )
  const empty = !invoiced.some((i) => months.includes(i.yearMonth)) && !bars.some((b) => pending(b.yearMonth, b.amount) > 0)
  // Twelve columns do not fit a phone: /invoices keeps the last six there, as the client page does.
  const phoneHidden = (i: number) => !compact && i < count - 6 && "max-sm:hidden"
  const gap = compact ? "gap-2" : "gap-1.5 sm:gap-3"

  const body = empty ? (
    <p className="text-sm text-muted-foreground">No invoices in the last {count} months.</p>
  ) : (
    <div>
      <div className={cn("flex border-b", gap, compact ? "h-24" : "h-36")}>
        {bars.map(({ yearMonth, amount }, i) => {
          const loggedHere = pending(yearMonth, amount)
          const label = loggedHere
            ? `${formatYearMonth(yearMonth, "MMM yyyy")}: ${eurCents(loggedHere)} logged, not invoiced`
            : `${formatYearMonth(yearMonth, "MMM yyyy")}: ${eurCents(amount)}`
          const shown = loggedHere || amount
          return (
            // pt-4 keeps room for the label above a full-height bar.
            <div
              key={yearMonth}
              role="img"
              aria-label={label}
              title={label}
              // min-w-0: a label wider than its column must not widen it off the tick row.
              className={cn("flex h-full min-w-0 flex-1 flex-col items-center justify-end pt-4", phoneHidden(i))}
            >
              <span
                className={cn(
                  // flex centres a label wider than its column ("-€500" on a phone) instead of wrapping it.
                  "flex justify-center whitespace-nowrap text-[11px] leading-4 tabular-nums",
                  loggedHere ? "text-muted-foreground" : "text-subtle-foreground",
                  amount < 0 && "text-danger-soft-foreground",
                )}
              >
                {shown !== 0 &&
                  (compact ? (
                    eur(shown)
                  ) : (
                    <>
                      <span className="md:max-lg:hidden">{eur(shown)}</span>
                      <span className="max-md:hidden lg:hidden">{eurCompact(shown)}</span>
                    </>
                  ))}
              </span>
              {/* A month netted negative by a credit note draws no bar, only its red label. */}
              {shown > 0 && (
                <div
                  // shrink-0: a full bar rises into pt-4 instead of squeezing to the label's leftover.
                  className={cn(
                    "w-full shrink-0 rounded-t-[3px]",
                    compact ? "max-w-7" : "max-w-10",
                    loggedHere ? "bg-border-strong" : "bg-primary",
                  )}
                  style={{ height: `${(shown / max) * 100}%`, minHeight: 2 }}
                />
              )}
              {/* Nothing invoiced: a dash on the baseline, so the month reads empty, not missing. */}
              {shown === 0 && <span aria-hidden className="mb-px h-0.5 w-3 shrink-0 rounded-full bg-muted-foreground/50" />}
            </div>
          )
        })}
      </div>
      <div aria-hidden className={cn("mt-2 flex text-center font-mono text-[11px] text-muted-foreground", gap)}>
        {months.map((yearMonth, i) => (
          <div
            key={yearMonth}
            className={cn("min-w-0 flex-1", phoneHidden(i), yearMonth === currentMonth && "font-medium text-foreground")}
          >
            {formatYearMonth(yearMonth, "MMM")}
            {!compact && (i === 0 || yearMonth.endsWith("-01")) && (
              <span className="block font-normal text-muted-foreground">{yearMonth.slice(0, 4)}</span>
            )}
          </div>
        ))}
      </div>
      <p aria-hidden className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-subtle-foreground">
        <Key swatch="size-2.5 rounded-[2px] bg-primary">Invoiced</Key>
        <Key swatch="size-2.5 rounded-[2px] bg-border-strong">Logged, not invoiced</Key>
        {!compact && (
          <Key swatch="h-0.5 w-3 rounded-full bg-muted-foreground/50" className="max-sm:hidden">
            Nothing invoiced
          </Key>
        )}
      </p>
    </div>
  )

  if (compact) return <div className={className}>{body}</div>
  return (
    <ContentCard as="section" labelledBy="chart-title" className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="flex flex-col gap-1">
          <h2 id="chart-title" className="text-[17px] font-semibold tracking-tight">
            Invoiced by Month
          </h2>
          <p className="text-meta text-muted-foreground">Net, by the month you worked</p>
        </div>
        {!empty && (
          // Three columns on a phone, as Invoices-phone.dc draws them; a wrapping row from sm up.
          <dl className="grid w-full grid-cols-3 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:gap-x-8">
            <Figure term="Last 12 months" value={eurCents(total)} />
            <Figure term="Average a month" value={eurCents(total / 12)} />
            <Figure term={`${year} so far`} value={eurCents(yearSoFar)} />
          </dl>
        )}
      </div>
      {body}
    </ContentCard>
  )
}

function Key({ swatch, className, children }: { swatch: string; className?: string; children: ReactNode }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <span className={swatch} />
      {children}
    </span>
  )
}
