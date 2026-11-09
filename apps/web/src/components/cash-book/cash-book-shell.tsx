"use client"

import { formatYearMonth, isoDate, parseYearMonth } from "@alter-ego/kernel/dates"
import { FiltersSheet } from "@alter-ego/ui/filters-sheet"
import { ContentCard } from "@alter-ego/ui/page/content-card"
import { EmptyPrompt } from "@alter-ego/ui/page/empty-prompt"
import { FilterBar, FilterSelect } from "@alter-ego/ui/page/filter-bar"
import { MonthStepper } from "@alter-ego/ui/page/month-stepper"
import { PageHeader } from "@alter-ego/ui/page/page-header"
import { pageState } from "@alter-ego/ui/page/page-state"
import { SignedAmount } from "@alter-ego/ui/page/signed-amount"
import { StatusPill, type Tone } from "@alter-ego/ui/page/status-pill"
import { Button } from "@alter-ego/ui/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@alter-ego/ui/ui/dropdown-menu"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@alter-ego/ui/ui/tabs"
import { cn } from "@alter-ego/ui/utils"
import { addMonths, format, parseISO } from "date-fns"
import { AlertTriangle, ArrowRight, CircleCheck, MoreHorizontal, Plus } from "lucide-react"
import { useSearchParams } from "next/navigation"
import { useId, useMemo, useRef, useState } from "react"

import { AccountsDialog } from "@/components/cash-book/accounts-dialog"
import { CheckBalanceDialog } from "@/components/cash-book/check-balance-dialog"
import { CostCentresTab } from "@/components/cash-book/cost-centres-tab"
import { ExportDialog } from "@/components/cash-book/export-dialog"
import { ImportDialog } from "@/components/cash-book/import-dialog"
import { MovementDialog, type MovementPreset } from "@/components/cash-book/movement-dialog"
import {
  filterCount,
  MovementFilterFields,
  MovementsTab,
  NO_FILTERS,
  type MovementFilters,
} from "@/components/cash-book/movements-tab"
import { OwedHeldTab } from "@/components/cash-book/owed-held-tab"
import { SummaryTab } from "@/components/cash-book/summary-tab"
import { UndoImportDialog } from "@/components/cash-book/undo-import-dialog"
import { CompanyExpenseFormDialog, type CostDialogState } from "@/components/company-expenses/company-expense-form-dialog"
import { LoanFormDialog } from "@/components/company-expenses/loan-form-dialog"
import { InvoiceSheet, type InvoiceSheetState } from "@/components/crm/invoice-sheet"
import { useAssignments } from "@/hooks/use-assignments"
import { useAuth } from "@/hooks/use-auth"
import { useClients } from "@/hooks/use-clients"
import { useCollaborators } from "@/hooks/use-collaborators"
import { useCompanyAccounts } from "@/hooks/use-company-accounts"
import { useCompanyExpenses } from "@/hooks/use-company-expenses"
import { useCompanyLoans } from "@/hooks/use-company-loans"
import { useCompanyMovements } from "@/hooks/use-company-movements"
import { useEngagements } from "@/hooks/use-engagements"
import { useInvoices } from "@/hooks/use-invoices"
import {
  accountInUse,
  balancesAt,
  bookRows,
  clientsOwe,
  costCentresOf,
  dayLabel,
  deposits,
  monthSheet,
  negativeDays,
  ownerLoanBalance,
  round2,
  supplierDocuments,
  statementCheck,
  statementLabel,
  toChase,
} from "@/lib/cash-book"
import { eurCents, invoiceClientId } from "@/lib/invoices"
import { importedRecords } from "@/lib/prima-nota"
import { isModuleOn } from "@/modules"

import type { CashRow, ChaseItem, StatementCheck } from "@/lib/cash-book"
import type { CompanyAccount, CompanyExpense, CompanyLoan, CompanyMovement, Invoice } from "@/types"

type Dialog =
  | { kind: "movement"; movement: CompanyMovement | null; preset?: MovementPreset }
  | { kind: "cost"; state: CostDialogState }
  | { kind: "loan"; loan: CompanyLoan }
  | { kind: "accounts" }
  | { kind: "check" }
  | { kind: "export" }
  | { kind: "import" }
  | { kind: "undo" }
  | null

const sum = (values: number[]) => round2(values.reduce((s, v) => s + v, 0))

const TABS = ["movements", "summary", "centres", "owed", "chase"]
const YEAR_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/

/**
 * The company's cash book: each account's balance and whether it matches the
 * bank, the money that is not really the company's, and the month as a sheet.
 * Nothing is stored here but movements: invoices paid into an account and costs
 * paid from one are read where they live, so every page agrees.
 */
export function CashBookShell() {
  const { user } = useAuth()
  const accountsQuery = useCompanyAccounts(user?.id)
  const movementsQuery = useCompanyMovements(user?.id)
  const invoicesQuery = useInvoices(user?.id)
  const expensesQuery = useCompanyExpenses(user?.id)
  const loansQuery = useCompanyLoans(user?.id)
  const clientsQuery = useClients(user?.id)
  const engagementsQuery = useEngagements(user?.id)
  const { data: collaborators = [] } = useCollaborators(user?.id)
  const { data: assignments = [] } = useAssignments(user?.id)
  const { data: accounts = [] } = accountsQuery
  const { data: movements = [] } = movementsQuery
  const { data: invoices = [] } = invoicesQuery
  const { data: expenses = [] } = expensesQuery
  const { data: loans = [] } = loansQuery
  const { data: clients = [] } = clientsQuery
  const { data: engagements = [] } = engagementsQuery

  const [today] = useState(() => isoDate(new Date()))
  // Where a link (Month End's) opens the page: a known tab, a month up to this one; anything else is ignored.
  const params = useSearchParams()
  const [ym, setYm] = useState(() => {
    const asked = params.get("month")
    return asked && YEAR_MONTH.test(asked) && asked <= today.slice(0, 7) ? asked : today.slice(0, 7)
  })
  const [accountId, setAccountId] = useState<string | null>(null)
  const [tab, setTab] = useState(() => TABS.find((t) => t === params.get("tab")) ?? "movements")
  const [filters, setFilters] = useState<MovementFilters>(NO_FILTERS)
  const ids = useId()
  const [dialog, setDialog] = useState<Dialog>(null)
  const [sheet, setSheet] = useState<InvoiceSheetState | null>(null)
  // No DialogTrigger on these dialogs: focus goes back to what opened one, else to Add Movement.
  const opener = useRef<HTMLElement | null>(null)
  const addButton = useRef<HTMLButtonElement>(null)
  const moreButton = useRef<HTMLButtonElement>(null)
  const movementsTab = useRef<HTMLButtonElement>(null)
  const owedTab = useRef<HTMLButtonElement>(null)
  const openDialog = (next: NonNullable<Dialog>, from?: HTMLElement | null) => {
    opener.current = from ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null)
    setDialog(next)
  }
  const restoreFocus = (event: Event) => {
    event.preventDefault()
    const back = opener.current
    ;(back && back !== document.body && back.isConnected ? back : addButton.current)?.focus()
  }
  // The clicked month, item or figure goes with its tab: the tab takes focus.
  const show = (next: "movements" | "owed") => {
    setTab(next)
    ;(next === "owed" ? owedTab : movementsTab).current?.focus()
  }

  const data = useMemo(() => ({ invoices, expenses, loans, movements }), [invoices, expenses, loans, movements])
  const importData = useMemo(
    () => ({ accounts, invoices, expenses, loans, movements, clients, clientOf: (i: Invoice) => invoiceClientId(i, engagements), collaborators, assignments }),
    [accounts, invoices, expenses, loans, movements, clients, engagements, collaborators, assignments],
  )
  const { rows, counted } = useMemo(
    () => bookRows({ accounts, invoices, expenses, loans, movements, clients, engagements }),
    [accounts, invoices, expenses, loans, movements, clients, engagements],
  )

  const gate = pageState([
    accountsQuery,
    movementsQuery,
    invoicesQuery,
    expensesQuery,
    loansQuery,
    clientsQuery,
    engagementsQuery,
  ])
  if (gate) return gate

  // A chip left on a deleted account falls back to every account.
  const scope = accounts.some((a) => a.id === accountId) ? accountId : null
  const openRow = (row: CashRow) => {
    if (row.source === "invoice") return setSheet({ kind: "edit", invoiceId: row.sourceId })
    if (row.source === "expense") {
      const expense = expenses.find((e) => e.id === row.sourceId)
      return expense && openDialog({ kind: "cost", state: { kind: "edit", expense } })
    }
    if (row.source === "loan") {
      const loan = loans.find((l) => l.id === row.sourceId)
      return loan && openDialog({ kind: "loan", loan })
    }
    openDialog({ kind: "movement", movement: movements.find((m) => m.id === row.sourceId) ?? null })
  }
  const costCentres = costCentresOf(movements, expenses)
  const chase = toChase({ accounts, rows, invoices, expenses, invoicing: isModuleOn("invoicing") }).filter(
    (c) => scope === null || ("row" in c ? c.row.accountId === scope : "accountId" in c ? c.accountId === scope : true),
  )

  const dialogs = (
    <>
      <MovementDialog
        userId={user?.id}
        open={dialog?.kind === "movement"}
        onOpenChange={(open) => !open && setDialog(null)}
        onCloseAutoFocus={restoreFocus}
        movement={dialog?.kind === "movement" ? dialog.movement : null}
        preset={dialog?.kind === "movement" ? dialog.preset : null}
        accounts={accounts}
        movements={movements}
        expenses={expenses}
        loans={loans}
        invoices={invoices}
        engagements={engagements}
        clients={clients}
      />
      <AccountsDialog
        userId={user?.id}
        open={dialog?.kind === "accounts"}
        onOpenChange={(open) => !open && setDialog(null)}
        onCloseAutoFocus={restoreFocus}
        accounts={accounts}
        inUse={(id) => accountInUse(id, { invoices, expenses, loans, movements })}
      />
      <CheckBalanceDialog
        userId={user?.id}
        open={dialog?.kind === "check"}
        onOpenChange={(open) => !open && setDialog(null)}
        onCloseAutoFocus={restoreFocus}
        accounts={accounts}
        counted={counted}
      />
      <CompanyExpenseFormDialog
        userId={user?.id}
        state={dialog?.kind === "cost" ? dialog.state : null}
        onClose={() => setDialog(null)}
        onCloseAutoFocus={restoreFocus}
        accounts={accounts}
        expenses={expenses}
        movements={movements}
        costCentres={costCentres}
      />
      <LoanFormDialog
        userId={user?.id}
        open={dialog?.kind === "loan"}
        onOpenChange={(open) => !open && setDialog(null)}
        onCloseAutoFocus={restoreFocus}
        loan={dialog?.kind === "loan" ? dialog.loan : null}
        direction="to_company"
        accounts={accounts}
        loans={loans}
        expenses={expenses}
      />
      <ExportDialog
        open={dialog?.kind === "export"}
        onOpenChange={(open) => !open && setDialog(null)}
        onCloseAutoFocus={restoreFocus}
        data={{ accounts, rows, ...data, collaborators }}
        costCentres={costCentres}
        today={today}
        accountId={scope}
        customerOf={(i) => clients.find((c) => c.id === invoiceClientId(i, engagements))?.name ?? "Unknown client"}
      />
      <ImportDialog
        userId={user?.id}
        open={dialog?.kind === "import"}
        onOpenChange={(open) => !open && setDialog(null)}
        onCloseAutoFocus={restoreFocus}
        data={importData}
        onUndo={() => setDialog({ kind: "undo" })}
        onImported={(day) => setYm(day.slice(0, 7))}
      />
      <UndoImportDialog
        userId={user?.id}
        open={dialog?.kind === "undo"}
        onOpenChange={(open) => !open && setDialog(null)}
        onCloseAutoFocus={restoreFocus}
        data={importData}
      />
      <InvoiceSheet userId={user?.id} state={sheet} onStateChange={setSheet} />
    </>
  )
  const imported = Object.values(importedRecords(importData)).some((list) => list.length > 0)

  // Hidden on a phone, where the first movement must show on the first screen (CashBook-phone.dc has none).
  // PageHeader's meta slot, not its subtitle: display none there, so no gap is left for it either.
  const intro = <p className="hidden text-sm text-muted-foreground sm:block sm:text-[15px]">The company&apos;s bank accounts, day by day.</p>

  // The dialogs come first in both branches: adding the first account swaps the
  // branch, and a dialog that moved in the tree would remount, losing focus.
  if (accounts.length === 0) {
    return (
      <div className="space-y-6">
        {dialogs}
        <PageHeader title="Cash Book" meta={intro} />
        <section className="space-y-3 rounded-lg border p-6">
          <h2 className="font-medium">Start With Your Accounts</h2>
          <p className="text-sm text-muted-foreground">
            Add each company bank account, and a cash box if you keep one, with its balance on a day. From then on the
            movements you add here and the invoices you mark paid into an account add up to the balance the bank shows.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => openDialog({ kind: "accounts" })}>
              <Plus className="mr-1 h-4 w-4" /> Add Your First Account
            </Button>
            <Button variant="outline" onClick={() => openDialog({ kind: "import" })}>
              Import Excel
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            Kept the prima nota in Excel until now? Import Excel brings it in once, accounts included, and checks every
            balance against its Saldo sheet before writing anything.
          </p>
        </section>
      </div>
    )
  }

  const balances = balancesAt(accounts, counted, today)
  const total = sum([...balances.values()])
  const suppliersOwed = supplierDocuments(expenses, movements).owed
  const owner = ownerLoanBalance(loans, expenses)
  const toGiveBack = sum(deposits(movements).filter((d) => d.kind === "deposit_held").map((d) => d.amount))
  const negatives = negativeDays(accounts, counted)
  const owed = clientsOwe(invoices, engagements)
  const ledger = monthSheet(accounts, counted, ym, scope)
  // In − Out of this month so far, every account: what the balance moved since the 1st (CashBook.dc).
  const sinceFirst = ym === today.slice(0, 7) && scope === null ? ledger.net : monthSheet(accounts, counted, today.slice(0, 7), null).net

  const figures = [
    { key: "clients", label: "Clients owe you", value: owed },
    { key: "suppliers", label: "You owe suppliers", value: suppliersOwed },
    // Below zero the SRL has paid you more than it owed: €0.00, and the warning under the line says why.
    { key: "srl", label: "SRL owes you", value: Math.max(owner.total, 0) },
    { key: "deposits", label: "Deposits to give back", value: toGiveBack },
  ]
  const searching = filters.query.trim() !== ""
  const accountFilter = (
    <FilterSelect
      label="Account"
      allLabel="All accounts"
      value={scope}
      options={accounts.map((a) => ({ value: a.id, label: a.name }))}
      onValueChange={setAccountId}
    />
  )
  const search = (
    // 14 px from sm up, so "Search movements…" fits beside the five views; touch keeps 16 px (the Input's guard: no zoom on focus).
    <FilterBar
      className="min-w-0 sm:flex-[1_1_160px] sm:[&_input]:text-sm"
      search={{
        value: filters.query,
        onChange: (query) => setFilters({ ...filters, query }),
        label: "Search movements",
        placeholder: "Search movements…",
      }}
    />
  )

  return (
    <div className="flex flex-col gap-3 sm:gap-7">
      {dialogs}
      <PageHeader
        title="Cash Book"
        meta={intro}
        actions={
          <>
            {/* A 44 px "+" on a phone, beside More, so both share the title's row. */}
            <Button
              ref={addButton}
              size="lg"
              aria-label="Add Movement"
              className="max-sm:w-11 max-sm:px-0"
              onClick={() => openDialog({ kind: "movement", movement: null })}
            >
              <Plus aria-hidden />
              <span className="hidden sm:inline">Add Movement</span>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button ref={moreButton} size="icon-lg" variant="outline" aria-label="More" title="Check Balance, Accounts, Export, Import">
                  <MoreHorizontal aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => openDialog({ kind: "check" }, moreButton.current)}>Check Balance</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => openDialog({ kind: "accounts" }, moreButton.current)}>Accounts</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => openDialog({ kind: "export" }, moreButton.current)}>Export</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => openDialog({ kind: "import" }, moreButton.current)}>Import Excel</DropdownMenuItem>
                {imported && (
                  <DropdownMenuItem onSelect={() => openDialog({ kind: "undo" }, moreButton.current)}>Undo Import</DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />

      <div className="flex flex-col gap-3 sm:gap-4">
        <BalanceHero
          accounts={accounts}
          balances={balances}
          total={total}
          sinceFirst={sinceFirst}
          today={today}
          check={(a) => statementCheck(a, counted)}
          negative={(a) => negatives.find((n) => n.accountId === a.id)?.day ?? null}
          onCheck={(from) => openDialog({ kind: "check" }, from)}
        />

        {/* Owed & Held in one line: the figures that are not the company's money, or not yet. Their detail is the tab. */}
        <section
          aria-label="Summary"
          className="grid grid-cols-2 gap-x-4 gap-y-0.5 rounded-xl border border-hairline bg-sidebar px-4 py-1.5 sm:flex sm:flex-wrap sm:items-center sm:gap-x-10 sm:gap-y-3.5 sm:px-[22px] sm:py-3.5"
        >
          <h2 className="text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase max-sm:sr-only">Owed &amp; held</h2>
          {figures.map((f) => (
            <article key={f.key} aria-labelledby={`${ids}-${f.key}`} className="flex min-h-[46px] flex-col justify-center gap-px sm:min-h-0 sm:gap-0.5">
              <p id={`${ids}-${f.key}`} className="text-[12.5px] text-muted-foreground sm:text-meta">
                {f.label}
              </p>
              <p className="text-[15.5px] font-semibold tabular-nums sm:text-base">{eurCents(f.value)}</p>
            </article>
          ))}
          <Button variant="ghost" size="lg" className="ml-auto px-2 font-normal text-subtle-foreground max-sm:hidden" onClick={() => show("owed")}>
            See Owed &amp; Held <ArrowRight aria-hidden />
          </Button>
          {owner.total < 0 && (
            <p className="col-span-2 flex gap-1.5 py-2 text-meta text-warning-soft-foreground sm:basis-full sm:py-0">
              <AlertTriangle aria-hidden className="mt-0.5 size-3.5 shrink-0" />
              The SRL has paid you {eurCents(-owner.total)} more than it owed. Check the repayments.
            </p>
          )}
        </section>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="flex flex-col gap-3 sm:gap-4">
        {/* One toolbar (CashBook.dc): the month, the account, the search and the views. A phone keeps the month
            and folds the account, the search and the ledger's filters into its Filters sheet. */}
        <div className="flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:items-center">
          <div className="flex gap-2">
            <MonthStepper
              label={formatYearMonth(ym)}
              prev={() => setYm(shift(ym, -1))}
              next={() => setYm(shift(ym, 1))}
              className="max-sm:flex-1"
            />
            <FiltersSheet
              active={(scope === null ? 0 : 1) + (tab === "movements" ? filterCount(filters) + (searching ? 1 : 0) : 0)}
              className="h-11 sm:hidden"
            >
              {accountFilter}
              {tab === "movements" && (
                <>
                  {search}
                  <MovementFilterFields sheet={ledger} filters={filters} onChange={setFilters} />
                </>
              )}
            </FiltersSheet>
          </div>
          <div className="hidden sm:contents">
            {accountFilter}
            {/* The search reads the ledger only. */}
            {tab === "movements" && search}
          </div>
          {/* A segmented track from sm up; on a phone a row of pills that scrolls sideways, the page never does. */}
          <TabsList
            aria-label="Cash book views"
            className="max-w-full justify-start overflow-x-auto sm:ml-auto max-sm:-mx-4 max-sm:-my-1 max-sm:flex max-sm:max-w-none max-sm:gap-2 max-sm:rounded-none max-sm:bg-transparent max-sm:px-4 max-sm:py-1 max-sm:[scrollbar-width:none]"
          >
            <TabsTrigger ref={movementsTab} value="movements" className={VIEW}>
              Movements
            </TabsTrigger>
            <TabsTrigger value="summary" className={VIEW}>
              Summary
            </TabsTrigger>
            <TabsTrigger value="centres" className={VIEW}>
              Cost Centres
            </TabsTrigger>
            <TabsTrigger ref={owedTab} value="owed" className={VIEW}>
              Owed &amp; Held
            </TabsTrigger>
            <TabsTrigger value="chase" className={cn(VIEW, "group gap-1.5")}>
              To Chase
              {chase.length > 0 && (
                <>
                  {" "}
                  <span className="tabular-nums text-muted-foreground max-sm:group-data-[state=active]:text-primary-foreground/70">
                    {chase.length}
                  </span>
                </>
              )}
            </TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="movements" className="mt-0">
          <MovementsTab
            accounts={accounts}
            sheet={ledger}
            ym={ym}
            today={today}
            accountId={scope}
            filters={filters}
            onFilters={setFilters}
            onOpen={openRow}
          />
        </TabsContent>
        <TabsContent value="summary" className="mt-0">
          <SummaryTab
            accounts={accounts}
            counted={counted}
            data={data}
            today={today}
            ym={ym}
            onMonth={setYm}
            onShowMonth={(month) => {
              setYm(month)
              show("movements")
            }}
            accountId={scope}
          />
        </TabsContent>
        <TabsContent value="centres" className="mt-0">
          <CostCentresTab data={data} ym={ym} accountId={scope} accountName={accounts.find((a) => a.id === scope)?.name ?? null} />
        </TabsContent>
        <TabsContent value="owed" className="mt-0">
          <OwedHeldTab
            invoices={invoices}
            engagements={engagements}
            clients={clients}
            expenses={expenses}
            loans={loans}
            movements={movements}
            onPay={(bill) =>
              openDialog({
                kind: "movement",
                movement: null,
                preset: {
                  direction: "out",
                  type: "supplier_payment",
                  expenseId: bill.expense.id,
                  amount: bill.owed,
                  documentRef: bill.expense.documentRef,
                  project: bill.expense.project,
                },
              })
            }
          />
        </TabsContent>
        <TabsContent value="chase" className="mt-0">
          <ChaseTab
            items={chase}
            accounts={accounts}
            onRow={openRow}
            onInvoice={(invoiceId) => setSheet({ kind: "edit", invoiceId })}
            onCost={(expense) => openDialog({ kind: "cost", state: { kind: "edit", expense } })}
            onMonth={(day) => {
              setYm(day.slice(0, 7))
              show("movements")
            }}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}

const shift = (ym: string, months: number) => format(addMonths(parseYearMonth(ym), months), "yyyy-MM")

/** A view tab: the shadcn segment from sm up (12 px sides, CashBook.dc), a pill on a phone (CashBook-phone.dc). */
const VIEW =
  "shrink-0 sm:px-3 max-sm:min-h-11 max-sm:rounded-full max-sm:border max-sm:bg-background max-sm:px-4 max-sm:text-sm max-sm:font-normal max-sm:text-subtle-foreground max-sm:data-[state=active]:border-primary max-sm:data-[state=active]:bg-primary max-sm:data-[state=active]:font-medium max-sm:data-[state=active]:text-primary-foreground max-sm:data-[state=active]:shadow-none"

/** Each account's share of the total, in neutral swatches: the board's #171717 and #d4d4d4 first. */
const SHARE = ["bg-foreground", "bg-border-strong", "bg-muted-foreground", "bg-hairline"]

const CHECK_PILL: Record<StatementCheck["status"], { tone: Tone; label: string }> = {
  matches: { tone: "success", label: "Matches" },
  missing_in: { tone: "warning", label: "Doesn't match" },
  missing_out: { tone: "warning", label: "Doesn't match" },
  not_checked: { tone: "neutral", label: "Not checked" },
}

/** "14 Oct", with the year when it is not this one. */
const shortDay = (day: string, today: string) => format(parseISO(day), day.slice(0, 4) === today.slice(0, 4) ? "d MMM" : "d MMM yyyy")

/**
 * The balance today (CashBook.dc): the total, what it moved since the 1st, each account's share
 * as a bar, and one row per account with its balance and whether it matches the bank.
 */
function BalanceHero({
  accounts,
  balances,
  total,
  sinceFirst,
  today,
  check,
  negative,
  onCheck,
}: {
  accounts: CompanyAccount[]
  balances: Map<string, number>
  total: number
  sinceFirst: number
  today: string
  check: (account: CompanyAccount) => StatementCheck
  /** The first day the account's balance goes below zero, or null. */
  negative: (account: CompanyAccount) => string | null
  onCheck: (from: HTMLElement) => void
}) {
  const share = (a: CompanyAccount) => Math.max(balances.get(a.id) ?? 0, 0)
  const positive = sum(accounts.map(share))
  return (
    <ContentCard
      as="section"
      aria-label="Accounts"
      padding="none"
      className="flex flex-col gap-2 px-[18px] py-3.5 sm:gap-6 sm:p-6 lg:flex-row lg:gap-10"
    >
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 [grid-template-areas:'title_since'_'total_total'_'bar_bar'] sm:grid-cols-1 sm:gap-y-2.5 sm:[grid-template-areas:'title'_'total'_'since'_'bar'] lg:flex-[1_1_300px] lg:content-center">
        <h2 className="text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase [grid-area:title]">Balance today</h2>
        <p className="text-[34px] leading-[1.1] font-semibold tracking-[-0.03em] tabular-nums [grid-area:total] sm:text-[44px] sm:leading-[1.05]">
          {eurCents(total)}
        </p>
        <p className="text-meta text-subtle-foreground [grid-area:since] sm:text-sm">
          <SignedAmount amount={sinceFirst} format={eurCents} /> since {shortDay(`${today.slice(0, 7)}-01`, today)}
          <span className="max-sm:hidden">
            , {accounts.length === 1 ? "in your one company account" : `across ${accounts.length} company accounts`}
          </span>
        </p>
        {accounts.length > 1 && positive > 0 && (
          <div aria-hidden className="my-0.5 flex h-1.5 gap-[3px] [grid-area:bar] sm:mt-1.5 sm:mb-0">
            {accounts.map((a, k) => (
              <span key={a.id} className={cn("rounded-[3px]", SHARE[k % SHARE.length])} style={{ width: `${(share(a) / positive) * 100}%` }} />
            ))}
          </div>
        )}
      </div>
      <div className="flex flex-col divide-y divide-hairline lg:flex-[1_1_460px] lg:justify-center lg:border-l lg:border-hairline lg:pl-10">
        {accounts.map((a, k) => {
          const c = check(a)
          const pill = CHECK_PILL[c.status]
          const below = negative(a)
          return (
            <article
              key={a.id}
              aria-labelledby={`cash-account-${a.id}`}
              className="grid grid-cols-[auto_auto_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1 py-2 [grid-template-areas:'sw_name_name_amt'_'._pill_detail_detail'] first:pt-1.5 last:pb-0 sm:gap-x-3.5 sm:gap-y-1.5 sm:py-4 sm:[grid-template-areas:'sw_name_pill_amt'_'sw_detail_detail_amt'] sm:first:pt-1 sm:last:pb-1"
            >
              <span aria-hidden className={cn("size-[9px] rounded-[3px] [grid-area:sw] sm:size-2.5", SHARE[k % SHARE.length])} />
              <p id={`cash-account-${a.id}`} className="min-w-0 text-[15px] font-medium [overflow-wrap:anywhere] [grid-area:name]">
                {a.name}
              </p>
              <StatusPill tone={pill.tone} className="justify-self-start [grid-area:pill]">
                {pill.label}
              </StatusPill>
              <div className="min-w-0 text-meta text-muted-foreground [grid-area:detail]">
                <p>
                  {c.status === "matches"
                    ? `Checked against the bank on ${shortDay(c.day, today)}`
                    : c.status === "not_checked"
                      ? "No bank balance typed yet"
                      : statementLabel(c, eurCents)}
                  {c.status !== "matches" && (
                    <span className="max-sm:hidden">
                      {" · "}
                      <button
                        type="button"
                        className="rounded-sm text-foreground underline underline-offset-4 hover:text-subtle-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                        onClick={(e) => onCheck(e.currentTarget)}
                      >
                        Check Balance
                      </button>
                    </span>
                  )}
                </p>
                {below && <p className="text-danger-soft-foreground">Below zero on {dayLabel(below)}: see To Chase.</p>}
              </div>
              <p className="text-right text-base font-semibold tracking-[-0.01em] whitespace-nowrap tabular-nums [grid-area:amt] sm:text-lg">
                {eurCents(balances.get(a.id) ?? 0)}
              </p>
            </article>
          )
        })}
      </div>
    </ContentCard>
  )
}

/** What each To Chase item is, in a word: the sentence under it says why. */
const CHASE_PILL: Record<ChaseItem["kind"], { tone: Tone; label: string }> = {
  negative: { tone: "danger", label: "Below zero" },
  no_account: { tone: "warning", label: "No account" },
  no_document: { tone: "warning", label: "No document" },
  estimated: { tone: "warning", label: "Date estimated" },
  before_opening: { tone: "warning", label: "Before opening" },
  unassigned: { tone: "danger", label: "Account deleted" },
}

/** What to fix before the book can be trusted, each with where to fix it. */
function ChaseTab({
  items,
  accounts,
  onRow,
  onInvoice,
  onCost,
  onMonth,
}: {
  items: ChaseItem[]
  accounts: CompanyAccount[]
  onRow: (row: CashRow) => void
  onInvoice: (invoiceId: string) => void
  onCost: (expense: CompanyExpense) => void
  onMonth: (day: string) => void
}) {
  if (items.length === 0) {
    return (
      <EmptyPrompt
        title={
          <span className="flex items-center gap-2">
            <CircleCheck aria-hidden className="size-5 shrink-0 text-success" />
            Nothing to chase
          </span>
        }
        description="Every row has an account and a real date, and no balance goes below zero."
      />
    )
  }
  const name = (id: string) => accounts.find((a) => a.id === id)?.name ?? "an account that no longer exists"
  const describe = (item: ChaseItem): { what: string; why: string; action: string; go: () => void } => {
    switch (item.kind) {
      case "negative":
        return {
          what: `${name(item.accountId)} ends ${dayLabel(item.day)} at ${eurCents(item.balance)}`,
          why: "A bank account can't go below zero: a row is missing, or has the wrong date or account.",
          action: "Show Month",
          go: () => onMonth(item.day),
        }
      case "no_account":
        return {
          what: `Invoice ${item.invoice.number} paid on ${dayLabel(isoDate(item.invoice.paidDate!))}, no account`,
          why: "Paid since the Cash Book began, but not into an account: it is missing from the balances.",
          action: "Open Invoice",
          go: () => onInvoice(item.invoice.id),
        }
      case "no_document":
        return {
          what: `${item.expense.description}, ${dayLabel(isoDate(item.expense.date))}, no document`,
          why: "A cost paid with no invoice or receipt number: ask the supplier for it, then add it to the cost.",
          action: "Add Document",
          go: () => onCost(item.expense),
        }
      case "estimated":
        return {
          what: `${item.row.description}, ~${dayLabel(item.row.day)}`,
          why: "The date is a guess. Set the real day from the bank: the ~ goes away.",
          action: "Fix Date",
          go: () => onRow(item.row),
        }
      case "before_opening":
        return {
          what: `${item.row.description}, ${dayLabel(item.row.day)}`,
          why: `Dated before ${name(item.row.accountId)} opened, so it is left out of the balance. Fix the date, or the account's opening date.`,
          action: "Open",
          go: () => onRow(item.row),
        }
      case "unassigned":
        return {
          what: `${item.row.description}, ${dayLabel(item.row.day)}`,
          why: "Its account no longer exists, so it is left out of every balance. Pick another account.",
          action: "Open",
          go: () => onRow(item.row),
        }
    }
  }
  return (
    <ContentCard as="div" padding="none">
      <ul className="divide-y divide-hairline">
        {items.map((item, k) => {
          const d = describe(item)
          const pill = CHASE_PILL[item.kind]
          return (
            <li key={k} className="flex flex-col gap-3 px-[18px] py-4 sm:flex-row sm:items-start sm:justify-between sm:px-[22px]">
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                  <p className="font-medium [overflow-wrap:anywhere]">{d.what}</p>
                  <StatusPill tone={pill.tone}>{pill.label}</StatusPill>
                </div>
                <p className="text-meta text-muted-foreground">{d.why}</p>
              </div>
              <Button variant="outline" size="sm" className="self-start" onClick={d.go}>
                {d.action}
              </Button>
            </li>
          )
        })}
      </ul>
    </ContentCard>
  )
}
