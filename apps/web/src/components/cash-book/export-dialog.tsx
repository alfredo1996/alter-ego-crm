"use client"

import { formatYearMonth, parseYearMonth } from "@alter-ego/kernel/dates"
import { Button } from "@alter-ego/ui/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@alter-ego/ui/ui/dialog"
import { Input } from "@alter-ego/ui/ui/input"
import { Label } from "@alter-ego/ui/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@alter-ego/ui/ui/select"
import { toast } from "@alter-ego/ui/use-toast"
import { cn } from "@alter-ego/ui/utils"
import { addMonths, format, parseISO } from "date-fns"
import { useState } from "react"

import { downloadInvoiceFile, saveBlob } from "@/hooks/use-company-files"
import { buildPackage, packageFileName, packageSummary, plural, quarterBounds } from "@/lib/accountant-package"
import { UNTAGGED, dayLabel, exportCsv, exportFileName, monthEnd } from "@/lib/cash-book"
import { downloadCsv } from "@/lib/export"

import type { CashRow, ExportSelection } from "@/lib/cash-book"
import type { CompanyAccount, CompanyExpense, CompanyLoan, CompanyMovement, Invoice } from "@/types"
import type { ReactNode } from "react"

const ALL = "all"
type Period = "this_month" | "month" | "quarter" | "year" | "range"
type Mode = "csv" | "package"
const PERIODS: { value: Period; label: string }[] = [
  { value: "this_month", label: "This Month" },
  { value: "month", label: "A Month" },
  { value: "quarter", label: "A Quarter" },
  { value: "year", label: "A Year" },
  { value: "range", label: "A Date Range" },
]
/** The package is whole months: no date range, so costs (by day) and invoices (by month) cover the same span. */
const PACKAGE_PERIODS = PERIODS.filter((p) => p.value !== "range")
const CSV_PERIODS = PERIODS.filter((p) => p.value !== "quarter")

/**
 * The prima nota for the accountant: a period, an account (or all), a cost
 * centre (or all). The file holds the rows, then each account's balances and
 * each cost centre's gain or loss, and its name says the selection.
 */
export function ExportDialog({
  open,
  onOpenChange,
  onCloseAutoFocus,
  data,
  costCentres,
  today,
  accountId,
  month,
  mode,
  customerOf,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCloseAutoFocus?: (event: Event) => void
  data: {
    accounts: CompanyAccount[]
    rows: CashRow[]
    invoices: Invoice[]
    expenses: CompanyExpense[]
    loans: CompanyLoan[]
    movements: CompanyMovement[]
    collaborators?: { id: string; name: string }[]
  }
  /** The cost centres in use. */
  costCentres: string[]
  /** "yyyy-MM-dd". */
  today: string
  /** The account chip on the page: the default. */
  accountId: string | null
  /** "yyyy-MM" to open on as A Month, instead of This Month: Month End's month. */
  month?: string
  /** What the switch opens on: the prima nota CSV (default) or the accountant's package. */
  mode?: Mode
  /** An invoice's customer, for the names of its file in the package. */
  customerOf: (invoice: Invoice) => string
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" onCloseAutoFocus={onCloseAutoFocus}>
        {open && (
          <ExportForm
            data={data}
            costCentres={costCentres}
            today={today}
            accountId={accountId}
            initialMonth={month}
            initialMode={mode ?? "csv"}
            customerOf={customerOf}
            onClose={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function ExportForm({
  data,
  costCentres,
  today,
  accountId,
  initialMonth,
  initialMode,
  customerOf,
  onClose,
}: {
  data: Parameters<typeof ExportDialog>[0]["data"]
  costCentres: string[]
  today: string
  accountId: string | null
  initialMonth: string | undefined
  initialMode: Mode
  customerOf: (invoice: Invoice) => string
  onClose: () => void
}) {
  const thisMonth = today.slice(0, 7)
  // From the first account's opening, or the first row, to this month.
  const first = [...data.accounts.map((a) => format(a.openingDate, "yyyy-MM")), ...data.rows.map((r) => r.day.slice(0, 7))].sort()[0] ?? thisMonth
  const months: string[] = []
  for (let ym = thisMonth; ym >= first && months.length < 240; ym = format(addMonths(parseYearMonth(ym), -1), "yyyy-MM")) months.push(ym)
  const years = [...new Set(months.map((m) => m.slice(0, 4)))]

  // A month before the book began is not on the list: This Month, as with none asked.
  const asked = initialMonth && months.includes(initialMonth) ? initialMonth : null
  const [mode, setMode] = useState<Mode>(initialMode)
  const [busy, setBusy] = useState(false)
  const [period, setPeriod] = useState<Period>(asked ? "month" : "this_month")
  const [month, setMonth] = useState(asked ?? months[1] ?? thisMonth)
  const [year, setYear] = useState(years[0])
  const quarters = years
    .flatMap((y) => [4, 3, 2, 1].map((q) => ({ y, q })))
    .filter(({ y, q }) => quarterBounds(y, q).from.slice(0, 7) <= thisMonth && quarterBounds(y, q).to.slice(0, 7) >= first)
  // "yyyy-q": this month's quarter.
  const [quarter, setQuarter] = useState(`${thisMonth.slice(0, 4)}-${Math.ceil(Number(thisMonth.slice(5)) / 3)}`)
  const [from, setFrom] = useState(`${thisMonth}-01`)
  const [to, setTo] = useState(today)
  const [account, setAccount] = useState(accountId ?? ALL)
  const [centre, setCentre] = useState(ALL)

  const isPackage = mode === "package"
  const shown = isPackage ? PACKAGE_PERIODS : CSV_PERIODS
  // The other mode may not list the chosen period: This Month stands in.
  const current = shown.some((p) => p.value === period) ? period : "this_month"
  const range =
    current === "this_month"
      ? { from: `${thisMonth}-01`, to: monthEnd(thisMonth) }
      : current === "month"
        ? { from: `${month}-01`, to: monthEnd(month) }
        : current === "quarter"
          ? quarterBounds(quarter.slice(0, 4), Number(quarter.slice(5)))
          : current === "year"
            ? { from: `${year}-01-01`, to: `${year}-12-31` }
            : { from, to }
  const valid = Boolean(range.from && range.to && range.from <= range.to)
  const sel: ExportSelection = {
    ...range,
    accountId: account === ALL ? null : account,
    costCentre: centre === ALL ? null : centre,
  }
  const result = valid && !isPackage ? exportCsv(data, sel) : null
  const summary = valid && isPackage ? packageSummary(data, { ...range, accountId: sel.accountId }, customerOf) : null
  const packageFile = packageFileName(range)
  const file = exportFileName(sel, data.accounts)
  // "5 costs and 1 invoice": the side with none is left out.
  const missing = summary
    ? (() => {
        const parts = [
          summary.costsWithout && plural(summary.costsWithout, "cost"),
          summary.invoicesWithout && plural(summary.invoicesWithout, "invoice"),
        ].filter(Boolean)
        return parts.length
          ? {
              list: parts.join(" and "),
              total: summary.costsWithout + summary.invoicesWithout,
            }
          : null
      })()
    : null
  const periodName =
    current === "quarter"
      ? `Q${quarter.slice(5)} ${quarter.slice(0, 4)}`
      : current === "year"
        ? year
        : formatYearMonth(current === "month" ? month : thisMonth)
  const oneAccount = sel.accountId ? (
    <p>One account: the invoice files are every account&apos;s, and its cost centres leave out supplier invoices and costs paid with your card.</p>
  ) : null
  const accountName = data.accounts.find((a) => a.id === sel.accountId)?.name

  const downloadZip = async () => {
    setBusy(true)
    try {
      const out = await buildPackage(
        data,
        { ...range, accountId: sel.accountId },
        customerOf,
        async (f) => new Uint8Array(await (await downloadInvoiceFile(f)).arrayBuffer()),
      )
      saveBlob(new Blob([out.bytes as BlobPart], { type: "application/zip" }), out.name)
      toast({
        title: `Saved ${out.name}`,
        description: `${plural(out.rows, "row")}, ${plural(out.payments, "payment")}, ${plural(out.files, "file")}.`,
      })
      onClose()
    } catch (err) {
      toast({
        variant: "destructive",
        title: "The package could not be saved",
        description: err instanceof Error ? err.message : "Unknown error",
      })
    } finally {
      setBusy(false)
    }
  }

  const download = () => {
    if (!result) return
    downloadCsv(result.csv, file)
    toast({
      title: `Exported ${result.rows} ${result.rows === 1 ? "row" : "rows"}, ${dayLabel(sel.from)} to ${dayLabel(sel.to)}, ${accountName ?? "every account"}, ${sel.costCentre ?? "every cost centre"}.`,
    })
    onClose()
  }

  const subField = (
    <>
      {current === "month" && (
        <Field label="Month" id="export-month">
          <Select value={month} onValueChange={(m) => m && setMonth(m)}>
            <SelectTrigger id="export-month">
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
      {current === "quarter" && (
        <Field label="Quarter" id="export-quarter">
          <Select value={quarter} onValueChange={(v) => v && setQuarter(v)}>
            <SelectTrigger id="export-quarter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {quarters.map(({ y, q }) => (
                <SelectItem key={`${y}-${q}`} value={`${y}-${q}`}>
                  {`Q${q} ${y} · ${format(new Date(Number(y), (q - 1) * 3), "MMM")} – ${format(new Date(Number(y), q * 3 - 1), "MMM")}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      )}
      {current === "year" && (
        <Field label="Year" id="export-year">
          <Select value={year} onValueChange={(y) => y && setYear(y)}>
            <SelectTrigger id="export-year">
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
    </>
  )
  const accountField = (
    <Field label="Account" id="export-account">
      <Select value={account} onValueChange={(a) => a && setAccount(a)}>
        <SelectTrigger id="export-account">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All Accounts</SelectItem>
          {data.accounts.map((a) => (
            <SelectItem key={a.id} value={a.id}>
              {a.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  )

  return (
    <>
      <DialogHeader>
        <DialogTitle>Export</DialogTitle>
        <DialogDescription>
          {isPackage
            ? "For your accountant: one zip with the period's prima nota, the company's payments and the invoice files. Whole months only, so costs and invoices cover the same span."
            : "For your accountant: a CSV that Italian Excel opens as is. The rows of the period, then each account's balance at the start and the end with what came in and went out, and each cost centre's gain or loss. A management record, not a statutory book."}
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <div role="radiogroup" aria-label="What to export" className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
          {(
            [
              ["csv", "Prima Nota CSV"],
              ["package", "Accountant's Package"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={mode === value}
              onClick={() => setMode(value)}
              className={cn(
                "min-h-11 rounded-md px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-9",
                mode === value ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <Field label="Period" id="export-period">
          <Select value={current} onValueChange={(p) => p && setPeriod(p as Period)}>
            <SelectTrigger id="export-period">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {shown.map((p) => (
                <SelectItem key={p.value} value={p.value}>
                  {p.value === "this_month" ? `This Month (${formatYearMonth(thisMonth)})` : p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        {!isPackage && subField}
        {current === "range" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="From" id="export-from">
              <Input id="export-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </Field>
            <Field label="To" id="export-to">
              <Input id="export-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </Field>
          </div>
        )}
        {isPackage ? (
          <div className="grid gap-4 sm:grid-cols-2">
            {subField}
            {accountField}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {accountField}
            <Field label="Cost Centre" id="export-centre">
              <Select value={centre} onValueChange={(c) => c && setCentre(c)}>
                <SelectTrigger id="export-centre">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All Cost Centres</SelectItem>
                  {costCentres.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                  <SelectItem value={UNTAGGED}>{UNTAGGED}</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>
        )}
        <div role="status" className="rounded-md bg-muted px-3 py-2 text-sm [overflow-wrap:anywhere]">
          {summary ? (
            <>
              <div className="hidden space-y-1.5 sm:block">
                <p className="font-medium">
                  {periodName}, {format(parseISO(range.from), "d MMMM")} to {format(parseISO(range.to), "d MMMM")}
                </p>
                <ol className="space-y-1">
                  <li>1. Prima nota: {plural(summary.rows, "row")}, then the summaries</li>
                  <li>2. Payments: {plural(summary.payments, "money-out row")}, transfers between your accounts left out</li>
                  <li>
                    3. Invoice files: {summary.files}
                    {missing ? ` (${missing.list} ${missing.total === 1 ? "has" : "have"} none)` : ""}
                  </li>
                </ol>
                {oneAccount}
                <p>File: {packageFile}</p>
              </div>
              <div className="space-y-1.5 sm:hidden">
                <p className="font-medium">{periodName}</p>
                <p>
                  {plural(summary.rows, "row")} · {plural(summary.payments, "payment")} · {plural(summary.files, "invoice file")}
                </p>
                {missing && (
                  <p>
                    {missing.list} {missing.total === 1 ? "has" : "have"} no file.
                  </p>
                )}
                {oneAccount}
                <p>File: {packageFile}</p>
              </div>
            </>
          ) : valid && result ? (
            `${plural(result.rows, "row")} from ${dayLabel(sel.from)} to ${dayLabel(sel.to)}, then the summaries.${
              sel.accountId ? " One account: its cost centres leave out supplier invoices and costs paid with your card." : ""
            } File: ${file}`
          ) : (
            "Pick a start date on or before the end date."
          )}
        </div>
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        {isPackage ? (
          <Button type="button" disabled={!valid || busy} onClick={() => void downloadZip()}>
            Download Package
          </Button>
        ) : (
          <Button type="button" disabled={!valid} onClick={download}>
            Download CSV
          </Button>
        )}
      </DialogFooter>
    </>
  )
}

function Field({ label, id, children }: { label: string; id: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  )
}
