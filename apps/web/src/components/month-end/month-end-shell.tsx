"use client"

import { formatYearMonth, isoDate, parseYearMonth } from "@alter-ego/kernel/dates"
import { ContentCard } from "@alter-ego/ui/page/content-card"
import { EmptyPrompt } from "@alter-ego/ui/page/empty-prompt"
import { StatusDot } from "@alter-ego/ui/page/meta-row"
import { MonthStepper } from "@alter-ego/ui/page/month-stepper"
import { OnThisPage } from "@alter-ego/ui/page/on-this-page"
import { PageHeader } from "@alter-ego/ui/page/page-header"
import { pageState } from "@alter-ego/ui/page/page-state"
import { SegmentedProgress } from "@alter-ego/ui/page/progress"
import { StatusPill } from "@alter-ego/ui/page/status-pill"
import { Button } from "@alter-ego/ui/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@alter-ego/ui/ui/dropdown-menu"
import { ToastAction } from "@alter-ego/ui/ui/toast"
import { toast } from "@alter-ego/ui/use-toast"
import { cn } from "@alter-ego/ui/utils"
import { addMonths, format, parseISO, startOfMonth } from "date-fns"
import { AlertCircle, AlertTriangle, CheckCircle2, ChevronDown, Download, FileArchive, MoreHorizontal, Paperclip } from "lucide-react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react"

import { CheckBalanceDialog } from "@/components/cash-book/check-balance-dialog"
import { ExportDialog } from "@/components/cash-book/export-dialog"
import { CompanyExpenseFormDialog, type CostDialogState } from "@/components/company-expenses/company-expense-form-dialog"
import { InvoiceSheet, type InvoiceSheetState } from "@/components/crm/invoice-sheet"
import { MarkPaid } from "@/components/crm/invoice-table"
import { useAllocations, useApplyHours } from "@/hooks/use-allocations"
import { useAuth } from "@/hooks/use-auth"
import { useClients } from "@/hooks/use-clients"
import { useCollaborators } from "@/hooks/use-collaborators"
import { useCompanyAccounts } from "@/hooks/use-company-accounts"
import { useCompanyDeadlines, useUpdateCompanyDeadline } from "@/hooks/use-company-deadlines"
import { useCompanyExpenses, useUpdateCompanyExpense } from "@/hooks/use-company-expenses"
import { downloadInvoiceFile, FileUploadError, saveBlob, writeWithInvoiceFile } from "@/hooks/use-company-files"
import { useCompanyLoans } from "@/hooks/use-company-loans"
import { useCompanyMovements } from "@/hooks/use-company-movements"
import { useEngagements } from "@/hooks/use-engagements"
import { useInvoices, useUpdateInvoice } from "@/hooks/use-invoices"
import { useTimecards } from "@/hooks/use-timecards"
import { buildPackage, plural } from "@/lib/accountant-package"
import { bookRows, costCentresOf, dayLabel, exportCsv, exportFileName, monthEnd } from "@/lib/cash-book"
import { contractUnit, countIn, engagementLabel, formatContractQuantity } from "@/lib/engagements"
import { downloadCsv } from "@/lib/export"
import { checkInvoiceFile } from "@/lib/invoice-files"
import { invoiceClientId } from "@/lib/invoices"
import { NOT_NEEDED, STEP_INFO, monthEndChecklist, monthEndFloor, openMonths, stepsOn } from "@/lib/month-end"
import { shiftDays, weekMonday } from "@/lib/timecards"
import { isModuleOn } from "@/modules"

import type { ExportSelection } from "@/lib/cash-book"
import type { ItemStatus, MonthEndItem, MonthEndStep, StepKey, StepStatus } from "@/lib/month-end"
import type { Invoice } from "@/types"

const shift = (ym: string, n: number) => format(addMonths(parseYearMonth(ym), n), "yyyy-MM")
const YEAR_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/

/** The Plan's ?week= for a month: its first Monday, so the week shown is the month's own. */
const firstMonday = (ym: string) => weekMonday(shiftDays(`${ym}-01`, 6), new Date())

/** A step's state: its pill, its tone (the pill, the index mark, the progress segment) and its word for a screen reader. */
const STATUS: Record<StepStatus, { label: string; tone: "success" | "danger" | "warning" | "neutral"; word: string }> = {
  done: { label: "Done", tone: "success", word: "done" },
  todo: { label: "To Do", tone: "danger", word: "to do" },
  check: { label: "Check", tone: "warning", word: "to check" },
  na: { label: "Not Needed", tone: "neutral", word: "not needed" },
}

const ITEM_ICON: Record<ItemStatus, { Icon: typeof AlertCircle; className: string; label: string }> = {
  todo: { Icon: AlertCircle, className: "text-danger", label: "To do: " },
  check: { Icon: AlertTriangle, className: "text-amber-600 dark:text-amber-400", label: "To check: " },
  done: { Icon: CheckCircle2, className: "text-success", label: "Done: " },
}

const ORDER_NOTE = "Top to bottom is the closing order. Reminders never block the close."

/**
 * Month End: one place to close the month just ended, instead of going round
 * Plan, Invoices, Cash Book, Deadlines and Costs. Every step is computed from
 * the data those pages keep (lib/month-end), so nothing here is saved: a change
 * to a closed month opens it again, and "Also open" says so. Each fix opens the
 * window those pages use, dated in the month where the date decides it (a
 * payment, a bank check), and the page recomputes once it is saved. What has no
 * window of its own links to the screen that fixes it.
 */
export function MonthEndShell() {
  const { user } = useAuth()
  const engagementsQuery = useEngagements(user?.id)
  const clientsQuery = useClients(user?.id)
  const allocationsQuery = useAllocations(user?.id)
  const timecardsQuery = useTimecards(user?.id)
  const invoicesQuery = useInvoices(user?.id)
  const accountsQuery = useCompanyAccounts(user?.id)
  const movementsQuery = useCompanyMovements(user?.id)
  const expensesQuery = useCompanyExpenses(user?.id)
  const loansQuery = useCompanyLoans(user?.id)
  const deadlinesQuery = useCompanyDeadlines(user?.id)
  const { data: engagements = [] } = engagementsQuery
  const { data: clients = [] } = clientsQuery
  const { data: collaborators = [] } = useCollaborators(user?.id)
  const { data: allocations = [] } = allocationsQuery
  const { data: timecards = [] } = timecardsQuery
  const { data: invoices = [] } = invoicesQuery
  const { data: accounts = [] } = accountsQuery
  const { data: movements = [] } = movementsQuery
  const { data: expenses = [] } = expensesQuery
  const { data: loans = [] } = loansQuery
  const { data: deadlines = [] } = deadlinesQuery

  const { apply: applyHours, setMonthDays } = useApplyHours(user?.id)
  const updateDeadline = useUpdateCompanyDeadline(user?.id)
  const updateExpense = useUpdateCompanyExpense(user?.id)
  const updateInvoice = useUpdateInvoice(user?.id)

  const router = useRouter()
  const asked = useSearchParams().get("month")
  const [today] = useState(() => isoDate(new Date()))
  const [exporting, setExporting] = useState(false)
  /** Download Package is building the zip. */
  const [zipping, setZipping] = useState(false)
  const [attaching, setAttaching] = useState<string | null>(null)
  /** The Invoice Files item whose Attach File opened the chooser. */
  const attachTo = useRef<MonthEndItem | null>(null)
  const chooser = useRef<HTMLInputElement>(null)
  /** Where Export hands focus back: Other Periods, or the phone's More menu it was picked from. */
  const exportOpener = useRef<HTMLElement | null>(null)
  const moreButton = useRef<HTMLButtonElement>(null)
  const [sheet, setSheet] = useState<InvoiceSheetState | null>(null)
  const [cost, setCost] = useState<CostDialogState | null>(null)
  /** The account Check Balance is open on. */
  const [checking, setChecking] = useState<string | null>(null)
  /** Where a dialog hands focus back: what opened it, or its step once the fix took the item away. */
  const back = useRef<{ el: Element | null; step: StepKey }>({ el: null, step: "hours" })

  const data = useMemo(
    () => ({ engagements, clients, allocations, timecards, invoices, accounts, movements, expenses, loans, deadlines }),
    [engagements, clients, allocations, timecards, invoices, accounts, movements, expenses, loans, deadlines],
  )
  const lastMonth = shift(today.slice(0, 7), -1)
  const floor = monthEndFloor(data)
  const closable = floor !== null && floor <= lastMonth
  const first = floor ?? lastMonth
  // Never past last month, never before the first month with data.
  const wanted = asked && YEAR_MONTH.test(asked) && asked < lastMonth ? asked : lastMonth
  const month = wanted < first ? first : wanted

  const view = useMemo(
    () => (closable ? { checklist: monthEndChecklist(data, month, today, isModuleOn), open: openMonths(data, today, isModuleOn) } : null),
    [closable, data, month, today],
  )
  const book = useMemo(() => bookRows(data), [data])
  // A fix whose window closes on its own (Mark Paid), or whose list lands after the window closed (a new
  // invoice or payment), takes its item away once focus is back on it: the step takes it then.
  useEffect(() => {
    const { el, step } = back.current
    if (el && !el.isConnected && document.activeElement === document.body) {
      back.current.el = null
      document.getElementById(step)?.focus()
    }
  }, [view])

  const gate = pageState([
    engagementsQuery,
    clientsQuery,
    allocationsQuery,
    timecardsQuery,
    invoicesQuery,
    accountsQuery,
    movementsQuery,
    expensesQuery,
    loansQuery,
    deadlinesQuery,
  ])
  if (gate) return gate

  // The month lives in the URL only: Month End in the sidebar (bare /month-end) shows last month again.
  const go = (ym: string) => router.replace(`/month-end?month=${ym}`, { scroll: false })
  const customerOf = (i: Invoice) => clients.find((c) => c.id === invoiceClientId(i, engagements))?.name ?? "Unknown client"
  const exportData = { accounts, rows: book.rows, invoices, expenses, loans, movements, collaborators }
  const costCentres = costCentresOf(movements, expenses)
  const download = () => {
    const sel: ExportSelection = { from: `${month}-01`, to: monthEnd(month), accountId: null, costCentre: null }
    const result = exportCsv(exportData, sel)
    downloadCsv(result.csv, exportFileName(sel, accounts))
    toast({
      title: `Exported ${plural(result.rows, "row")}, ${dayLabel(sel.from)} to ${dayLabel(sel.to)}, every account, every cost centre.`,
    })
  }

  const downloadPackage = async () => {
    setZipping(true)
    try {
      const out = await buildPackage(
        exportData,
        { from: `${month}-01`, to: monthEnd(month), accountId: null },
        customerOf,
        async (f) => new Uint8Array(await (await downloadInvoiceFile(f)).arrayBuffer()),
      )
      const gap = out.missing > 0 ? ` ${plural(out.missing, "record")} ${out.missing === 1 ? "has" : "have"} no file yet.` : ""
      saveBlob(new Blob([out.bytes as BlobPart], { type: "application/zip" }), out.name)
      toast({ title: `Saved ${out.name}`, description: `${plural(out.rows, "row")}, ${plural(out.payments, "payment")}, ${plural(out.files, "file")}.${gap}` })
    } catch (err) {
      toast({ variant: "destructive", title: "The package could not be saved", description: err instanceof Error ? err.message : "Unknown error" })
    } finally {
      setZipping(false)
    }
  }

  const openExport = (from: HTMLElement | null) => {
    exportOpener.current = from
    setExporting(true)
  }
  const canExport = closable && accounts.length > 0
  const header = (meta?: ReactNode) => (
    <PageHeader
      title="Month End"
      subtitle="Close last month step by step. Every step reads your data; nothing is saved here."
      meta={meta}
      actions={
        closable && (
          <>
            {canExport && (
              <Button size="lg" variant="outline" className="max-sm:hidden" onClick={download}>
                <Download aria-hidden /> Download CSV
              </Button>
            )}
            <Button size="lg" variant="outline" className="max-sm:hidden" disabled={zipping} onClick={() => void downloadPackage()}>
              <FileArchive aria-hidden /> Download Package
            </Button>
            {canExport && (
              <Button size="lg" variant="outline" className="max-sm:hidden" aria-haspopup="dialog" onClick={(e) => openExport(e.currentTarget)}>
                Other Periods
              </Button>
            )}
          </>
        )
      }
      // A phone keeps both in a More menu beside the title (MonthEnd-phone.dc).
      more={
        closable && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button ref={moreButton} variant="ghost" size="icon-lg" aria-label="More" className="sm:hidden">
                <MoreHorizontal aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {canExport && <DropdownMenuItem onSelect={download}>Download CSV</DropdownMenuItem>}
              <DropdownMenuItem disabled={zipping} onSelect={() => void downloadPackage()}>
                Download Package
              </DropdownMenuItem>
              {canExport && <DropdownMenuItem onSelect={() => openExport(moreButton.current)}>Other Periods</DropdownMenuItem>}
            </DropdownMenuContent>
          </DropdownMenu>
        )
      }
    />
  )

  if (!view) {
    return (
      <div className="flex flex-col gap-3.5 sm:gap-7">
        {header()}
        <EmptyPrompt
          variant="inline"
          title={
            floor === null
              ? "Nothing to close yet. A month can be closed once it has hours on the Plan or a company account in the Cash Book."
              : `Nothing to close yet: ${formatYearMonth(floor)}, the first month with data, can be closed from ${format(parseYearMonth(shift(floor, 1)), "d MMMM yyyy")}.`
          }
        />
      </div>
    )
  }

  const { checklist, open } = view
  /** The steps of the modules this deployment runs: a left-out module's steps are not on the page. */
  const { order: STEPS, blocking: REQUIRED } = stepsOn(isModuleOn)
  const name = formatYearMonth(month)
  const earlier = open.filter((m) => m < month)
  const count = (key: StepKey) => checklist.steps[key].items.filter((i) => i.status !== "done").length
  /** A pill to each step the legend counts as a reminder: Invoices too, when all it holds is to check. */
  const reminders = (
    [
      ["invoices", `${plural(count("invoices"), "invoice")} to check`],
      ["waiting", `${plural(count("waiting"), "invoice")} waiting for payment`],
      ["suppliers", `${plural(count("suppliers"), "supplier invoice")} still owed`],
      ["recurring", `${plural(count("recurring"), "recurring cost")} not paid`],
      ["files", `${plural(count("files"), "invoice file")} missing`],
    ] as [StepKey, string][]
  ).filter(([key]) => STEPS.includes(key) && checklist.steps[key].status === "check")
  const statuses = STEPS.map((key) => checklist.steps[key].status)
  const tally = (status: StepStatus) => statuses.filter((s) => s === status).length
  const now = parseISO(today)

  /** A fix done, its item gone with the button that had focus: the step takes it. */
  const settle = (step: StepKey) => {
    if (document.activeElement === document.body) document.getElementById(step)?.focus()
  }
  const restoreFocus = (event: Event) => {
    event.preventDefault()
    const { el, step } = back.current
    ;(el instanceof HTMLElement && el.isConnected ? el : document.getElementById(step))?.focus()
  }
  const contract = (id: string | null) => {
    const e = engagements.find((x) => x.id === id)
    return e ? `${clients.find((c) => c.id === e.clientId)?.name ?? "Unknown client"} · ${engagementLabel(e)}` : "Contract"
  }
  const use = (writes: { engagementId: string; yearMonth: string; days: number }[], title: string) =>
    void applyHours(writes, title).then((written) => written && settle("hours"))
  const uses = checklist.steps.hours.items.flatMap((i) =>
    i.kind === "hours_use" && i.ref && i.days !== undefined ? [{ engagementId: i.ref, yearMonth: month, days: i.days }] : [],
  )
  /** Attach File in place: the slot's own upload-then-write order, for the chosen item. */
  const attach = async (item: MonthEndItem, file: File) => {
    const check = checkInvoiceFile(file)
    if (!check.ok) return toast({ variant: "destructive", title: "File not attached", description: check.reason })
    setAttaching(item.ref!)
    try {
      await writeWithInvoiceFile({
        userId: user?.id ?? "",
        stored: null,
        draft: { picked: file, removed: false },
        write: async (stored) => {
          if (item.kind === "file_cost") await updateExpense.mutateAsync({ id: item.ref!, input: { file: stored } })
          else await updateInvoice.mutateAsync({ id: item.ref!, input: { file: stored } })
        },
      })
    } catch (err) {
      // A rejected write has its app-wide error toast; a failed upload is said here.
      if (err instanceof FileUploadError) toast({ variant: "destructive", title: "File not attached", description: err.message })
      return
    } finally {
      setAttaching(null)
    }
    toast({ title: `Attached ${file.name}.` })
    settle("files")
  }
  const markDone = async (id: string) => {
    const title = deadlines.find((x) => x.id === id)?.title
    try {
      await updateDeadline.mutateAsync({ id, input: { isDone: true } })
    } catch {
      return // The app-wide error toast says why.
    }
    settle("deadlines")
    toast({
      title: `Done: ${title}.`,
      action: (
        <ToastAction altText="Undo" onClick={() => updateDeadline.mutate({ id, input: { isDone: false } })}>
          Undo
        </ToastAction>
      ),
    })
  }

  /**
   * The item's buttons: the fix in place where a window for it exists, else a
   * link to the screen that fixes it. Each is described by the item's text, so
   * two "Mark Paid" in a step say which invoice they are about.
   */
  const actionsOf = (item: MonthEndItem, step: StepKey, describedBy: string): ReactNode => {
    const button = (label: string, onClick: () => void, disabled = false) => (
      <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={onClick} aria-describedby={describedBy}>
        {label}
      </Button>
    )
    const dialog = (label: string, open: () => void) =>
      button(label, () => {
        back.current = { el: document.activeElement, step }
        open()
      })
    const link = (label: string, href: string) => (
      <Button asChild variant="outline" size="sm" aria-describedby={describedBy}>
        <Link href={href}>{label}</Link>
      </Button>
    )
    /** Dated and placed on the bank check the invoice would explain, when the Bank names it; else today. */
    const markPaid = (invoiceId: string, label: (number: string, credit: boolean) => string) => {
      const invoice = invoices.find((i) => i.id === invoiceId)
      return (
        invoice && (
          <MarkPaid
            key={invoiceId}
            userId={user?.id}
            invoice={invoice}
            invoices={invoices}
            engagements={engagements}
            defaultPaidDate={item.suspects?.paidOn}
            defaultAccount={item.suspects?.accountId}
          >
            <Button
              type="button"
              variant="outline"
              size="sm"
              // Its popup wraps it in a div: the div stretches in the row's actions, the button with it.
              className="max-sm:w-full"
              aria-describedby={describedBy}
              onClick={(e) => {
                back.current = { el: e.currentTarget, step }
              }}
            >
              {label(invoice.number, invoice.amount < 0)}
            </Button>
          </MarkPaid>
        )
      )
    }
    const week = `/plan?week=${firstMonday(month)}`
    const pending = setMonthDays.isPending
    switch (item.kind) {
      case "hours_use": {
        const days = item.days ?? 0
        const amount = formatContractQuantity(engagements.find((x) => x.id === item.ref) ?? {}, days)
        const title = `${amount} used: ${contract(item.ref)}, ${name}`
        return button(`Use ${amount}`, () => use([{ engagementId: item.ref!, yearMonth: month, days }], title), pending)
      }
      case "hours_missing": {
        const title = `No work: ${contract(item.ref)}, ${name}, set to ${countIn(0, contractUnit(engagements.find((x) => x.id === item.ref) ?? {}))}.`
        return (
          <>
            {link("Log Hours", week)}
            {button("No Work", () => use([{ engagementId: item.ref!, yearMonth: month, days: 0 }], title), pending)}
          </>
        )
      }
      case "hours_over":
        return link("Fix Hours", week)
      case "hours_outside":
        return link("Set Start Month", `/clients/${item.ref}`)
      case "invoice_open":
        return item.period && dialog("Record Invoice", () => setSheet({ kind: "record", clientId: item.ref, ...item.period }))
      case "invoice_misdated":
        return item.invoiceId && dialog("Edit Period", () => setSheet({ kind: "edit", invoiceId: item.invoiceId! }))
      case "invoice_provisional":
      case "invoice_credited":
        return link("Open Client", `/clients/${item.ref}#billing`)
      case "waiting":
        return markPaid(item.ref!, (_, credit) => (credit ? "Settle" : "Mark Paid"))
      case "supplier":
        // With no company account the Cash Book shows only its first-run screen.
        return accounts.length > 0 ? link("Open Owed & Held", "/cash-book?tab=owed") : link("Open Costs", "/costs")
      case "recurring": {
        const estimate = expenses.find((e) => e.id === item.ref)
        const unlinked = expenses.find((e) => e.id === item.link)
        const late = expenses.find((e) => e.id === item.late)
        return (
          estimate && (
            <>
              {unlinked && dialog("Link", () => setCost({ kind: "edit", expense: unlinked, estimateId: estimate.id }))}
              {late && dialog("Edit Date", () => setCost({ kind: "edit", expense: late }))}
              {dialog("Record Payment", () => setCost({ kind: "pay", estimate, date: checklist.end }))}
            </>
          )
        )
      }
      case "bank_open":
        return (
          <>
            {/* A later check that doesn't match is fixed in its rows: a check on the month end would not be saved over it. */}
            {item.month
              ? link("Open Cash Book", `/cash-book?tab=movements&month=${item.month}`)
              : dialog("Check Balance", () => setChecking(item.ref))}
            {item.suspects?.invoiceIds.map((id) => markPaid(id, (number) => `Mark ${number} Paid`))}
          </>
        )
      case "file_cost":
      case "file_invoice":
        return (
          item.status === "check" && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={attaching !== null || updateExpense.isPending || updateInvoice.isPending}
              aria-describedby={describedBy}
              onClick={(e) => {
                attachTo.current = item
                back.current = { el: e.currentTarget, step }
                chooser.current?.click()
              }}
            >
              <Paperclip aria-hidden className="size-4" /> {attaching === item.ref ? "Attaching…" : "Attach File"}
            </Button>
          )
        )
      case "chase":
        return link("Open To Chase", "/cash-book?tab=chase")
      case "deadline":
        return button("Mark Done", () => void markDone(item.ref!), updateDeadline.isPending)
      default:
        return null
    }
  }

  return (
    <div className="flex flex-col gap-3.5 sm:gap-7">
      <ExportDialog
        open={exporting}
        onOpenChange={setExporting}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          exportOpener.current?.focus()
        }}
        data={exportData}
        costCentres={costCentres}
        today={today}
        accountId={null}
        month={month}
        mode="package"
        customerOf={customerOf}
      />
      <input
        ref={chooser}
        type="file"
        className="sr-only"
        tabIndex={-1}
        aria-label="Choose invoice file"
        accept=".xml,.p7m,.pdf,application/xml,text/xml,application/pdf"
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = "" // The same file can be chosen again.
          if (file && attachTo.current) void attach(attachTo.current, file)
        }}
      />
      <InvoiceSheet userId={user?.id} state={sheet} onStateChange={setSheet} />
      <CheckBalanceDialog
        userId={user?.id}
        open={checking !== null}
        onOpenChange={(open) => !open && setChecking(null)}
        onCloseAutoFocus={restoreFocus}
        accounts={accounts.filter((a) => a.id === checking)}
        counted={book.counted}
        day={checklist.end}
      />
      <CompanyExpenseFormDialog
        userId={user?.id}
        state={cost}
        onClose={() => setCost(null)}
        onCloseAutoFocus={restoreFocus}
        accounts={accounts}
        expenses={expenses}
        movements={movements}
        costCentres={costCentres}
      />
      {header(
        <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-2">
          <MonthStepper
            className="max-sm:flex-1"
            label={name}
            prev={month > first ? () => go(shift(month, -1)) : undefined}
            next={month < lastMonth ? () => go(shift(month, 1)) : undefined}
          />
          <StatusPill tone={checklist.closed ? "success" : "warning"}>{checklist.closed ? "Closed" : "Open"}</StatusPill>
          <span className="text-meta text-muted-foreground max-sm:hidden">
            Ended {format(parseISO(checklist.end), "d MMM")} · {format(now, "MMMM")} closes from {format(addMonths(startOfMonth(now), 1), "d MMM")}
          </span>
        </div>,
      )}

      {/* The sentences stay word for word (tests and habit read them); the colour moved to the progress. */}
      <ContentCard as="section" labelledBy="verdict" className="flex flex-col gap-3.5 sm:gap-[18px] sm:p-6">
        <div className="flex flex-col gap-1.5 sm:gap-2">
          <h2 id="verdict" className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            Verdict
          </h2>
          <p className="text-[17px] leading-[1.35] font-semibold tracking-[-0.01em] sm:text-[19px]">
            {checklist.closed
              ? `${name} is closed: every required step is done.`
              : `${name}: ${plural(checklist.todo.length, "step")} to do (${checklist.todo.map((k) => STEP_INFO[k].title).join(", ")})`}
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:gap-2.5">
          {/* A phone puts the legend under the segments. */}
          <div className="flex flex-wrap items-baseline justify-between gap-x-5 gap-y-2 max-sm:contents">
            <p className="text-[13.5px] font-medium sm:text-sm">
              {REQUIRED.length - checklist.todo.length} of {REQUIRED.length} required steps done
            </p>
            <p className="flex flex-wrap gap-x-3.5 gap-y-1 text-[12.5px] text-subtle-foreground max-sm:order-last sm:gap-x-4 sm:gap-y-1.5 sm:text-meta">
              {tally("todo") > 0 && <StatusDot tone="danger">{tally("todo")} to do</StatusDot>}
              {tally("check") > 0 && (
                <StatusDot tone="warning">
                  {/* One span: the dot's gap would split the words. */}
                  <span>
                    {plural(tally("check"), "reminder")}
                    <span className="max-sm:hidden"> to check</span>
                  </span>
                </StatusDot>
              )}
              {tally("done") > 0 && <StatusDot tone="success">{tally("done")} done</StatusDot>}
              {tally("na") > 0 && <StatusDot outline>{tally("na")} not needed</StatusDot>}
            </p>
          </div>
          <SegmentedProgress
            size="bar"
            tones={statuses.map((status) => STATUS[status].tone)}
            label={`Steps in order: ${STEPS.map((key, i) => `${STEP_INFO[key].title} ${STATUS[statuses[i]].word}`).join(", ")}.`}
          />
        </div>
        {(checklist.todo.length > 0 || reminders.length > 0 || earlier.length > 0) && (
          <>
            <div className="h-px bg-hairline" />
            <div className="flex flex-col gap-2.5 text-sm text-subtle-foreground sm:gap-3">
              {checklist.todo.length > 0 && (
                <p className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <span className="sm:min-w-[88px]">
                    Still to do<span className="sm:hidden">:</span>
                  </span>
                  {checklist.todo.map((key) => (
                    <a
                      key={key}
                      href={`#${key}`}
                      className="rounded-sm font-medium text-foreground underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {STEP_INFO[key].title}
                    </a>
                  ))}
                </p>
              )}
              {reminders.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                  <span className="max-sm:hidden sm:min-w-[92px]">Reminders</span>
                  {reminders.map(([key, text]) => (
                    <a
                      key={key}
                      href={`#${key}`}
                      className="inline-flex min-h-8 items-center rounded-full bg-warning-soft px-2.5 text-[12.5px] font-semibold text-warning-soft-foreground transition-colors hover:bg-warning-soft/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 motion-reduce:transition-none sm:min-h-7"
                    >
                      {text}
                    </a>
                  ))}
                </div>
              )}
              {earlier.length > 0 && (
                <p className="text-[13px] text-muted-foreground sm:text-[13.5px]">
                  Also open: {plural(earlier.length, "earlier month")} (oldest:{" "}
                  <button
                    type="button"
                    className="font-medium text-foreground underline underline-offset-4 pointer-coarse:-my-3 pointer-coarse:py-3"
                    onClick={() => go(earlier[earlier.length - 1])}
                  >
                    {formatYearMonth(earlier[earlier.length - 1])}
                  </button>
                  )
                </p>
              )}
            </div>
          </>
        )}
      </ContentCard>

      {/* Two columns, like Solution.dc: the steps' index (chips on a phone), then the steps. */}
      <div className="flex flex-col gap-3.5 lg:flex-row lg:gap-12">
        {/* Keyed by month like the steps: it watches their sections, and starts again at the first. */}
        <OnThisPage
          key={month}
          aria-label="Steps"
          title="Steps"
          footer={ORDER_NOTE}
          items={STEPS.map((key, i) => ({
            id: key,
            label: STEP_INFO[key].title,
            short: key === "suppliers" ? "Supplier Invoices" : undefined,
            status: { tone: STATUS[statuses[i]].tone, label: STATUS[statuses[i]].word },
          }))}
        />
        <ol aria-label="Month-end steps" className="flex min-w-0 flex-1 flex-col gap-2.5 sm:gap-3">
          {STEPS.map((key, i) => (
            // Keyed by month too: another month starts with what was checked folded again.
            <StepCard
              key={`${month}:${key}`}
              n={i + 1}
              stepKey={key}
              step={checklist.steps[key]}
              actionsOf={actionsOf}
              extra={
                key === "hours" &&
                uses.length > 1 && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="ml-auto"
                    disabled={setMonthDays.isPending}
                    onClick={() => use(uses, `Hours used on ${uses.length} contracts, ${name}`)}
                  >
                    Use All ({uses.length})
                  </Button>
                )
              }
            />
          ))}
        </ol>
      </div>
      <p className="text-meta text-muted-foreground lg:hidden">{ORDER_NOTE}</p>
    </div>
  )
}

/**
 * One step, focusable by its key as id: a dialog hands focus back to it once the fix took the item away.
 * An open step is a card: what done means, the open items with their actions, what was checked folded.
 * A done or not-needed step folds to one row, still a section named by its h2 (MonthEnd.dc).
 */
function StepCard({
  n,
  stepKey,
  step,
  actionsOf,
  extra,
}: {
  /** Its place in the closing order. */
  n: number
  stepKey: StepKey
  step: MonthEndStep
  actionsOf: (item: MonthEndItem, step: StepKey, describedBy: string) => ReactNode
  /** Beside the pill: Hours' Use All. */
  extra?: ReactNode
}) {
  const info = STEP_INFO[stepKey]
  const status = STATUS[step.status]
  const open = step.items.filter((i) => i.status !== "done")
  const checked = step.items.filter((i) => i.status === "done")
  const id = `step-${stepKey}`
  const textId = `${useId()}-item`
  const head = (
    <>
      <span aria-hidden className="font-mono text-xs text-muted-foreground tabular-nums sm:text-[12.5px]">
        {String(n).padStart(2, "0")}
      </span>
      <h2 id={id} className={cn("font-semibold", open.length > 0 ? "text-base tracking-tight sm:text-[17px]" : "text-[15px]")}>
        {info.title}
      </h2>
      <StatusPill tone={status.tone}>{status.label}</StatusPill>
    </>
  )
  const section = { id: stepKey, tabIndex: -1, labelledBy: id }
  const focus = "scroll-mt-20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"

  if (open.length === 0) {
    const count = "text-meta text-muted-foreground"
    return (
      <li>
        <ContentCard
          as="section"
          {...section}
          padding="none"
          className={cn(
            "flex flex-wrap items-center gap-x-2.5 gap-y-1.5 py-2.5 pr-3 pl-[18px] shadow-none sm:min-h-[58px] sm:gap-x-3 sm:gap-y-2 sm:pr-[18px] sm:pl-[22px]",
            focus,
          )}
        >
          {head}
          {step.status === "na" ? (
            <span className={count}>{NOT_NEEDED[stepKey] ?? info.done}</span>
          ) : checked.length > 0 ? (
            <>
              <span className={cn(count, "max-sm:hidden")}>{checked.length} checked</span>
              {/* Opened, the fold takes the row's width, its summary still on the right. */}
              <Fold
                className="ml-auto open:basis-full open:text-right"
                summary={
                  <>
                    <span className="sm:hidden">{checked.length} checked</span>
                    <span className="max-sm:hidden">What was checked ({checked.length})</span>
                  </>
                }
              >
                <p className="text-subtle-foreground">{info.done}</p>
                <Checked items={checked} />
              </Fold>
            </>
          ) : (
            <>
              <span className={cn(count, "max-sm:ml-auto")}>Nothing to do</span>
              <Fold className="ml-auto open:basis-full open:text-right max-sm:hidden" summary="What it checks">
                <p className="text-subtle-foreground">{info.done}</p>
              </Fold>
            </>
          )}
        </ContentCard>
      </li>
    )
  }

  // A blocking item and an amber one can share a step (Invoices): each is counted as what it is.
  const todo = open.filter((i) => i.status === "todo").length
  const toCheck = open.length - todo
  return (
    <li>
      <ContentCard as="section" {...section} className={cn("flex flex-col gap-3 sm:gap-3.5", focus)}>
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 sm:gap-x-3 sm:gap-y-2">
          {head}
          <span className="text-meta text-muted-foreground">
            {[todo > 0 && `${todo} to do`, toCheck > 0 && `${toCheck} to check`].filter(Boolean).join(" · ")}
          </span>
          {extra}
        </div>
        <p className="text-[13.5px] leading-[1.55] text-subtle-foreground sm:text-sm">{info.done}</p>
        <ul>
          {open.map((item, k) => (
            <ItemRow key={k} item={item} textId={`${textId}-${k}`} actions={actionsOf(item, stepKey, `${textId}-${k}`)} />
          ))}
        </ul>
        {checked.length > 0 && (
          <Fold className="border-t border-hairline pt-2.5 sm:pt-3" summary={`What was checked (${checked.length})`}>
            <Checked items={checked} />
          </Fold>
        )}
      </ContentCard>
    </li>
  )
}

/** A native disclosure whose summary is a 44 px target on a touch screen. */
function Fold({ summary, className, children }: { summary: ReactNode; className?: string; children: ReactNode }) {
  return (
    <details className={cn("group text-[13.5px] leading-normal", className)}>
      <summary className="inline-flex min-h-9 cursor-pointer list-none items-center gap-1.5 rounded-md text-subtle-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none pointer-coarse:min-h-11 [&::-webkit-details-marker]:hidden">
        {summary}
        <ChevronDown aria-hidden className="size-3.5 transition-transform group-open:rotate-180 motion-reduce:transition-none" />
      </summary>
      <div className="flex flex-col gap-2 pt-1.5 pb-2 text-left">{children}</div>
    </details>
  )
}

/** What was checked: one line each, done said in words too. */
function Checked({ items }: { items: MonthEndItem[] }) {
  return (
    <ul className="flex flex-col gap-2 text-subtle-foreground">
      {items.map((item, k) => (
        <li key={k} className="flex items-start gap-2.5">
          <CheckCircle2 aria-hidden className="mt-[3px] size-3.5 shrink-0 text-success" />
          <div className="min-w-0">
            <p className="break-words">
              <span className="sr-only">Done: </span>
              {item.text}
            </p>
            {item.detail && <p className="text-meta break-words text-muted-foreground">{item.detail}</p>}
          </div>
        </li>
      ))}
    </ul>
  )
}

/** An open item: its icon (said in words too), text and detail, then its actions, under them on a phone. */
function ItemRow({ item, textId, actions }: { item: MonthEndItem; textId: string; actions: ReactNode }) {
  const { Icon, className, label } = ITEM_ICON[item.status]
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-3 border-t border-hairline py-3 last:pb-0 sm:py-3.5">
      <div className="flex min-w-0 flex-[1_1_360px] gap-2.5 sm:gap-3">
        <Icon aria-hidden className={cn("mt-0.5 size-4 shrink-0", className)} />
        <div className="flex min-w-0 flex-col gap-[3px]">
          <p id={textId} className="text-[14.5px] font-medium break-words">
            <span className="sr-only">{label}</span>
            {item.text}
          </p>
          {item.detail && <p className="text-meta leading-normal break-words text-subtle-foreground">{item.detail}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap gap-2 max-sm:w-full max-sm:*:flex-1">{actions}</div>}
    </li>
  )
}
