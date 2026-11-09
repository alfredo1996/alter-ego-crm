"use client"


import { EmptyPrompt } from "@alter-ego/ui/page/empty-prompt"
import { FilterBar, FilterSelect } from "@alter-ego/ui/page/filter-bar"
import { PageHeader } from "@alter-ego/ui/page/page-header"
import { pageState } from "@alter-ego/ui/page/page-state"
import { SectionHeader } from "@alter-ego/ui/page/section-header"
import { StatCard, StatStrip } from "@alter-ego/ui/page/stat-card"
import { StatusPill } from "@alter-ego/ui/page/status-pill"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@alter-ego/ui/ui/alert-dialog"
import { Button } from "@alter-ego/ui/ui/button"
import { format } from "date-fns"
import { AlertTriangle, ArrowRight, Plus } from "lucide-react"
import Link from "next/link"
import { useMemo, useRef, useState } from "react"

import { useAuth } from "@/hooks/use-auth"
import { useClients } from "@/hooks/use-clients"
import { useCollaborators } from "@/hooks/use-collaborators"
import { useCompanyAccounts } from "@/hooks/use-company-accounts"
import { useCompanyExpenses, useDeleteCompanyExpense } from "@/hooks/use-company-expenses"
import { useCompanyLoans, useDeleteCompanyLoan } from "@/hooks/use-company-loans"
import { useCompanyMovements } from "@/hooks/use-company-movements"
import { useEngagements } from "@/hooks/use-engagements"
import { useOpenFromQuery } from "@/hooks/use-open-from-query"
import { COST_CATEGORY_LABELS, costCentresOf, ownerLoanBalance, round2, supplierDocuments } from "@/lib/cash-book"
import { invoiceLine } from "@/lib/collaborator-invoices"
import { engagementLabel } from "@/lib/engagements"
import { eurCents } from "@/lib/invoices"
import { perMonthIn } from "@/lib/projection"

import { CompanyExpenseFormDialog, type CostDialogState } from "./company-expense-form-dialog"
import { CostTable } from "./cost-table"
import { LoanFormDialog } from "./loan-form-dialog"
import { LoansSection } from "./loans-section"
import { RecurringCards } from "./recurring-cards"

import type { CompanyExpense, CompanyExpenseCategory, CompanyLoan, CompanyLoanDirection } from "@/types"

const sum = (values: number[]) => round2(values.reduce((s, v) => s + v, 0))
const OWNER = "owner"
const OWED = "owed"
const LINK = "inline-flex items-center gap-1 text-foreground underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring"

export function CompanyExpensesShell() {
  const { user } = useAuth()
  const expensesQuery = useCompanyExpenses(user?.id)
  const loansQuery = useCompanyLoans(user?.id)
  const accountsQuery = useCompanyAccounts(user?.id)
  const movementsQuery = useCompanyMovements(user?.id)
  const { data: expenses = [] } = expensesQuery
  const { data: loans = [] } = loansQuery
  const { data: accounts = [] } = accountsQuery
  const { data: movements = [] } = movementsQuery
  const { data: collaborators = [] } = useCollaborators(user?.id)
  const { data: engagements = [] } = useEngagements(user?.id)
  const { data: clients = [] } = useClients(user?.id)
  const deleteExpense = useDeleteCompanyExpense(user?.id)
  const deleteLoan = useDeleteCompanyLoan(user?.id)

  const [cost, setCost] = useState<CostDialogState | null>(null)
  // Back from a cost's file lands on that cost.
  useOpenFromQuery(expensesQuery.isSuccess, (id) => {
    const expense = expenses.find((e) => e.id === id)
    if (expense) setCost({ kind: "edit", expense })
  })
  const [loanDialog, setLoanDialog] = useState<{ loan: CompanyLoan | null; direction: CompanyLoanDirection } | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<CompanyExpense | null>(null)
  const [deleteLoanTarget, setDeleteLoanTarget] = useState<CompanyLoan | null>(null)
  const [search, setSearch] = useState("")
  const [category, setCategory] = useState<string | null>(null)
  const [centre, setCentre] = useState<string | null>(null)
  const [paidFilter, setPaidFilter] = useState<string | null>(null)
  // No DialogTrigger: focus goes back to the button that opened a dialog.
  const opener = useRef<HTMLElement | null>(null)
  const remember = (from?: HTMLElement | null) => {
    opener.current = from ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null)
  }
  const openCost = (state: CostDialogState, from?: HTMLElement | null) => {
    remember(from)
    setCost(state)
  }
  const restoreFocus = (event: Event) => {
    if (opener.current?.isConnected) {
      event.preventDefault()
      opener.current.focus()
    }
  }

  const owed = useMemo(() => supplierDocuments(expenses, movements), [expenses, movements])
  const owner = useMemo(() => ownerLoanBalance(loans, expenses), [loans, expenses])
  const oneOff = expenses.filter((e) => !e.isRecurring)
  const estimates = expenses.filter((e) => e.isRecurring)
  const totalOneOff = sum(oneOff.map((e) => e.amount))
  // A year of each estimate, plus the one-off costs that pay none: a payment of an estimate is inside it,
  // unless that estimate was deleted since.
  const annualized = sum([
    ...estimates.map((e) => perMonthIn(e, format(new Date(), "yyyy-MM")) * 12),
    ...oneOff.filter((e) => !expenses.some((x) => x.id === e.recurringExpenseId && x.isRecurring)).map((e) => e.amount),
  ])
  const accountName = (id: string | null) => accounts.find((a) => a.id === id)?.name ?? null

  // Page-wide, not per list: the summary cards read "€0" until the data lands.
  const gate = pageState([expensesQuery, loansQuery, accountsQuery, movementsQuery])
  if (gate) return gate

  const today = new Date()
  const owedDocs = owed.docs.filter((d) => d.owed > 0)
  const contractName = (id: string) => {
    const e = engagements.find((x) => x.id === id)
    return e ? `${clients.find((c) => c.id === e.clientId)?.name ?? ""} · ${engagementLabel(e)}` : null
  }
  const estimateOf = (e: CompanyExpense) => expenses.find((x) => x.id === e.recurringExpenseId && x.isRecurring)
  const paidFrom = (e: CompanyExpense) => {
    if (e.accountId) return { node: accountName(e.accountId) ?? "An account that no longer exists" }
    if (e.paidByOwner) return { node: <StatusPill tone="info">Your card</StatusPill> }
    const doc = owed.docs.find((d) => d.expense.id === e.id)
    if (!doc) return { node: <span className="text-muted-foreground">Not paid from an account</span> }
    if (doc.owed <= 0) return { node: "Paid by Supplier Invoice Payments" }
    const last = movements
      .filter((m) => m.kind === "supplier_payment" && m.direction === "out" && m.expenseId === e.id)
      .sort((a, b) => b.date.getTime() - a.date.getTime())[0]
    return {
      node: <StatusPill tone="warning">Owed {eurCents(doc.owed)}</StatusPill>,
      sub: doc.paid > 0 && last ? `${eurCents(doc.paid)} paid on ${format(last.date, "dd/MM")}` : undefined,
    }
  }

  const needle = search.trim().toLowerCase()
  const matching = oneOff.filter(
    (e) =>
      (!needle || [e.description, e.documentRef, e.project].some((t) => t?.toLowerCase().includes(needle))) &&
      (category === null || e.category === category) &&
      (centre === null || e.project === centre) &&
      (paidFilter === null ||
        (paidFilter === OWNER ? e.paidByOwner : paidFilter === OWED ? owedDocs.some((d) => d.expense.id === e.id) : e.accountId === paidFilter)),
  )
  const filters = [category, centre, paidFilter].filter((f) => f !== null).length
  const showAll = () => {
    setSearch("")
    setCategory(null)
    setCentre(null)
    setPaidFilter(null)
  }
  const categories = [...new Set(oneOff.map((e) => e.category))]
  const centres = [...new Set(oneOff.map((e) => e.project).filter((p): p is string => !!p))].sort()
  const first = oneOff.length ? oneOff.reduce((a, b) => (a.date < b.date ? a : b)).date : null
  const since = first ? format(first, first.getFullYear() === today.getFullYear() ? "MMMM" : "MMM yyyy") : null

  return (
    <div className="flex flex-col gap-6 sm:gap-7">
      <PageHeader
        title="Costs"
        subtitle="What the company spends, one-off and recurring, and what it owes you."
        actions={
          <>
            <Button size="lg" variant="outline" onClick={(ev) => openCost({ kind: "recurring" }, ev.currentTarget)}>
              <Plus aria-hidden /> Add Recurring Cost
            </Button>
            <Button size="lg" onClick={(ev) => openCost({ kind: "new" }, ev.currentTarget)}>
              <Plus aria-hidden /> Add Cost
            </Button>
          </>
        }
      />
      <CompanyExpenseFormDialog
        userId={user?.id}
        state={cost}
        onClose={() => setCost(null)}
        onCloseAutoFocus={restoreFocus}
        accounts={accounts}
        expenses={expenses}
        movements={movements}
        costCentres={costCentresOf(expenses, movements)}
      />
      <LoanFormDialog
        userId={user?.id}
        open={loanDialog !== null}
        onOpenChange={(open) => !open && setLoanDialog(null)}
        onCloseAutoFocus={restoreFocus}
        loan={loanDialog?.loan ?? null}
        direction={loanDialog?.direction ?? "to_company"}
        accounts={accounts}
        loans={loans}
        expenses={expenses}
      />

      <StatStrip>
        <StatCard
          label="One-Off Costs"
          value={eurCents(totalOneOff)}
          detail={since ? `${oneOff.length} ${oneOff.length === 1 ? "cost" : "costs"} since ${since}, net of VAT` : "Net of the VAT you recover"}
        />
        <StatCard label="Annualized" value={eurCents(annualized)} detail="A year of recurring, plus the rest" />
        <StatCard
          label="You Owe Suppliers"
          value={
            <>
              {eurCents(owed.owed)}
              <Link href="/cash-book?tab=owed" className={`${LINK} sm:hidden`} aria-label="Open Owed & Held in the Cash Book">
                <ArrowRight aria-hidden className="size-4" />
              </Link>
            </>
          }
          detail={
            <>
              {owedDocs.length > 0 ? `${owedDocs.length} ${owedDocs.length === 1 ? "invoice" : "invoices"} not paid in full, VAT incl.` : "Supplier invoices, VAT incl."}{" "}
              <Link href="/cash-book?tab=owed" className={LINK}>
                Owed &amp; Held <ArrowRight aria-hidden className="size-3.5" />
              </Link>
            </>
          }
        />
        <StatCard
          label="SRL Owes You"
          tone={owner.total < 0 ? "warning" : undefined}
          value={
            <>
              {eurCents(Math.max(0, owner.total))}
              <a href="#shareholder-loan" className={`${LINK} sm:hidden`} aria-label="Go to the Shareholder Loan">
                <ArrowRight aria-hidden className="size-4" />
              </a>
            </>
          }
          detail={
            owner.total < 0 ? (
              <span className="flex gap-1">
                <AlertTriangle aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                The SRL has paid you {eurCents(-owner.total)} more than it owed. Check the repayments.
              </span>
            ) : (
              <>
                Shareholder loan,{" "}
                <a href="#shareholder-loan" className={LINK}>
                  below <ArrowRight aria-hidden className="size-3.5 rotate-90" />
                </a>
              </>
            )
          }
        />
      </StatStrip>
      {/* The strip hides each detail on a phone; a warning is not left to colour alone. */}
      {owner.total < 0 && (
        <p className="flex gap-1.5 text-meta text-warning-soft-foreground sm:hidden">
          <AlertTriangle aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          The SRL has paid you {eurCents(-owner.total)} more than it owed. Check the repayments.
        </p>
      )}

      {estimates.length > 0 && (
        <RecurringCards
          estimates={estimates}
          expenses={expenses}
          today={today}
          onPay={(estimate, from) => openCost({ kind: "pay", estimate }, from)}
          onEdit={(expense, from) => openCost({ kind: "edit", expense }, from)}
          onDelete={setDeleteTarget}
        />
      )}

      <section aria-labelledby="one-off-title" className="flex flex-col gap-4">
        <SectionHeader id="one-off-title" title="One-Off Costs" description="Every payment recorded once, recurring ones included" />
        {oneOff.length === 0 ? (
          <EmptyPrompt
            variant="inline"
            title={
              expenses.length === 0
                ? "No costs yet. Add a cost you paid, or a recurring cost the Plan should expect every month."
                : "No one-off costs yet. Record Payment on a recurring cost, or Add Cost."
            }
          />
        ) : (
          <>
            <FilterBar
              search={{ label: "Search costs", placeholder: "Search costs and documents…", value: search, onChange: setSearch }}
              sheet={{ active: filters }}
            >
              <FilterSelect
                label="Category"
                allLabel="All categories"
                value={category}
                options={categories.map((c) => ({ value: c, label: COST_CATEGORY_LABELS[c as CompanyExpenseCategory] ?? c }))}
                onValueChange={setCategory}
              />
              {centres.length > 0 && (
                <FilterSelect
                  label="Cost Centre"
                  allLabel="All cost centres"
                  value={centre}
                  options={centres.map((c) => ({ value: c, label: c }))}
                  onValueChange={setCentre}
                />
              )}
              <FilterSelect
                label="Paid From"
                allLabel="Anywhere"
                value={paidFilter}
                options={[
                  ...accounts.map((a) => ({ value: a.id, label: a.name })),
                  ...(oneOff.some((e) => e.paidByOwner) ? [{ value: OWNER, label: "Your card" }] : []),
                  ...(owedDocs.length > 0 ? [{ value: OWED, label: "Owed to a supplier" }] : []),
                ]}
                onValueChange={setPaidFilter}
              />
            </FilterBar>
            <CostTable
              costs={matching}
              estimateOf={estimateOf}
              paidFrom={paidFrom}
              linkOf={(e) => invoiceLine(e, collaborators, contractName)}
              onEdit={(expense, from) => openCost({ kind: "edit", expense }, from)}
              onDelete={setDeleteTarget}
              empty={
                <EmptyPrompt
                  variant="inline"
                  title="No costs match these filters."
                  action={
                    <Button variant="outline" onClick={showAll}>
                      Show All
                    </Button>
                  }
                />
              }
            />
          </>
        )}
      </section>

      <LoansSection
        loans={loans}
        expenses={expenses}
        owner={owner}
        accountName={accountName}
        today={today}
        onLend={(direction, from) => {
          remember(from)
          setLoanDialog({ loan: null, direction })
        }}
        onEditLoan={(loan, from) => {
          remember(from)
          setLoanDialog({ loan, direction: loan.direction })
        }}
        onDeleteLoan={setDeleteLoanTarget}
        onOpenCost={(expense, from) => openCost({ kind: "edit", expense }, from)}
      />

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Cost</AlertDialogTitle>
            <AlertDialogDescription>
              Delete &quot;{deleteTarget?.description}&quot;? It leaves the Plan{deleteTarget?.accountId ? " and the Cash Book balance" : ""}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => {
              if (deleteTarget) deleteExpense.mutate(deleteTarget.id, { onSuccess: () => setDeleteTarget(null) })
            }}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deleteLoanTarget} onOpenChange={(open) => { if (!open) setDeleteLoanTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Shareholder Loan</AlertDialogTitle>
            <AlertDialogDescription>
              Delete &quot;{deleteLoanTarget?.description}&quot; ({eurCents(deleteLoanTarget?.amount ?? 0)})? What the SRL owes
              you changes at once.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => {
              if (deleteLoanTarget) deleteLoan.mutate(deleteLoanTarget.id, { onSuccess: () => setDeleteLoanTarget(null) })
            }}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
