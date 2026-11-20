"use client"

import { PageHeader } from "@alter-ego/ui/page/page-header"
import { Button } from "@alter-ego/ui/ui/button"
import { Card, CardContent } from "@alter-ego/ui/ui/card"
import { Skeleton } from "@alter-ego/ui/ui/skeleton"
import { Plus, AlertCircle } from "lucide-react"
import { useState } from "react"

import { useAccountActions } from "./account-actions"
import { AccountList } from "./account-list"
import { useAccounts, useLastActivity } from "../../hooks/use-accounts"
import { useCurrency } from "../../hooks/use-currency"
import { useAuth } from "../../host"
import { netWorthTotals } from "../../lib/net-worth"
import { NewTransactionDialog } from "../transactions/new-transaction-dialog"

export function AccountsShell() {
  const { user } = useAuth()
  const { data: accounts, isPending, isError, error, refetch } = useAccounts(user?.id)
  const lastActivity = useLastActivity(user?.id, (accounts ?? []).map((a) => a.id))
  const { format, defaultCurrency } = useCurrency()
  const actions = useAccountActions()
  const [newTransactionOpen, setNewTransactionOpen] = useState(false)

  if (isPending) {
    return (
      <div>
        <div className="mb-6 flex items-center justify-between">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-9 w-36" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-xl" />
          ))}
        </div>
      </div>
    )
  }

  if (isError && !accounts) {
    return (
      <div>
        <PageHeader className="mb-6" title="Accounts" />
        <Card>
          <CardContent className="flex flex-col items-center gap-4 p-8">
            <AlertCircle className="h-10 w-10 text-destructive" />
            <p className="text-sm text-muted-foreground">
              {error instanceof Error ? error.message : "Failed to load accounts"}
            </p>
            <Button variant="outline" onClick={() => refetch()}>
              Try Again
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  // Archived accounts are closed: out of the totals and the count, as the Dashboard has it.
  const live = (accounts ?? []).filter((a) => !a.isArchived)
  const { totalAssets: own, totalLiabilities: owe, netWorth: net } = netWorthTotals(live)

  return (
    <div>
      <PageHeader
        className="mb-6"
        title="Accounts"
        subtitle={
          live.length > 0 && (
            <>
              <span className="tabular-nums">{format(net)}</span> across {live.length} {live.length === 1 ? "account" : "accounts"}
            </>
          )
        }
        actions={
          <>
            <Button size="lg" variant="outline" onClick={actions.openNew}>
              <Plus className="h-4 w-4" />
              New Account
            </Button>
            {/* From md up the header carries it; a phone has the + in the top bar. */}
            <Button size="lg" className="max-md:hidden" onClick={() => setNewTransactionOpen(true)}>
              <Plus className="h-4 w-4" />
              New Transaction
            </Button>
          </>
        }
      />

      <AccountList
        accounts={accounts ?? []}
        lastActivity={lastActivity.data}
        format={format}
        defaultCurrency={defaultCurrency}
        onEdit={actions.edit}
        onDelete={actions.remove}
        onArchive={actions.archive}
        toolbar={
          live.length > 0 && (
            <p className="text-[13px] text-muted-foreground">
              You own <span className="font-medium text-foreground tabular-nums">{format(own)}</span> · you owe{" "}
              <span className="font-medium text-foreground tabular-nums">{format(owe)}</span>
            </p>
          )
        }
      />

      <NewTransactionDialog open={newTransactionOpen} onOpenChange={setNewTransactionOpen} />
      {actions.dialogs}
    </div>
  )
}
