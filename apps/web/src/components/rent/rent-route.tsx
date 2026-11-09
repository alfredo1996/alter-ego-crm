"use client"

import { RentPage, type DepositReturn } from "@alter-ego/rent/page"
import { PageLoader } from "@alter-ego/ui/page/page-state"
import { useQueryClient } from "@tanstack/react-query"
import { useMemo, useState } from "react"

import { MovementDialog, type MovementPreset } from "@/components/cash-book/movement-dialog"
import { useAuth } from "@/hooks/use-auth"
import { useClients } from "@/hooks/use-clients"
import { useCompanyAccounts } from "@/hooks/use-company-accounts"
import { useCompanyExpenses } from "@/hooks/use-company-expenses"
import { useCompanyLoans } from "@/hooks/use-company-loans"
import { useCompanyMovements } from "@/hooks/use-company-movements"
import { useEngagements } from "@/hooks/use-engagements"
import { useInvoices } from "@/hooks/use-invoices"
import { getBackend } from "@/lib/backend"
import { costCentreTotals } from "@/lib/cash-book"

/**
 * The one place the app meets the Rent module: it hands over the database and the user, and the
 * cash book's rows as plain data (they belong to Books). The package declares the fields it reads.
 */
export function RentRoute() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const accounts = useCompanyAccounts(user?.id)
  const movements = useCompanyMovements(user?.id)
  const expenses = useCompanyExpenses(user?.id)
  const invoices = useInvoices(user?.id)
  const loans = useCompanyLoans(user?.id)
  const clients = useClients(user?.id)
  const engagements = useEngagements(user?.id)
  // End Tenancy hands over the deposit to give back; the cash book's own Add Movement opens filled in from it.
  const [giveBack, setGiveBack] = useState<MovementPreset | null>(null)
  const returnDeposit = (b: DepositReturn) =>
    setGiveBack({ direction: "out", type: "deposit_held", leaseId: b.leaseId, amount: b.amount, date: b.date, accountId: b.accountId, counterparty: b.counterparty, project: b.property })

  const data = useMemo(
    () => ({ invoices: invoices.data ?? [], expenses: expenses.data ?? [], loans: loans.data ?? [], movements: movements.data ?? [] }),
    [invoices.data, expenses.data, loans.data, movements.data],
  )
  const costs = useMemo(() => data.expenses.filter((e) => !e.isRecurring).map((e) => ({ id: e.id, leaseId: e.leaseId, forMonth: e.forMonth, amount: e.amount })), [data.expenses])

  if (!user || movements.isPending || expenses.isPending || accounts.isPending) return <PageLoader />
  return (
    <>
    <RentPage
      db={getBackend().db}
      userId={user.id}
      movements={data.movements}
      costs={costs}
      accounts={(accounts.data ?? []).map((a) => ({ id: a.id, name: a.name }))}
      figures={(year, property) => costCentreTotals(data, `${year}-01-01`, `${year}-12-31`).centres.find((c) => c.name === property) ?? null}
      costCentresHref="/cash-book?tab=centres"
      onReturnDeposit={returnDeposit}
      onCashBookChanged={() => {
        void queryClient.invalidateQueries({ queryKey: ["companyMovements"] })
        void queryClient.invalidateQueries({ queryKey: ["companyExpenses"] })
      }}
    />
    <MovementDialog
      userId={user.id}
      open={!!giveBack}
      onOpenChange={(open) => !open && setGiveBack(null)}
      movement={null}
      preset={giveBack}
      accounts={accounts.data ?? []}
      movements={data.movements}
      expenses={data.expenses}
      loans={data.loans}
      invoices={data.invoices}
      engagements={engagements.data ?? []}
      clients={clients.data ?? []}
    />
    </>
  )
}
