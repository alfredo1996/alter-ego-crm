"use client"

import { TransactionFormDialog } from "./transaction-form-dialog"
import { useAccounts } from "../../hooks/use-accounts"
import { useCategories } from "../../hooks/use-categories"
import { useCurrency } from "../../hooks/use-currency"
import { useCreateTransaction } from "../../hooks/use-transactions"
import { useAuth } from "../../host"

import type { TransactionFormValues } from "../../schemas"

interface NewTransactionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** An account's own page opens the form on that account. */
  defaultAccountId?: string
}

/** The New Transaction form with its own data and save: the phone's top-bar + and the Dashboard and Accounts headers share it. */
export function NewTransactionDialog({ open, onOpenChange, defaultAccountId }: NewTransactionDialogProps) {
  const { user } = useAuth()
  // Read only once open: the phone's + mounts this on every page, and a mounted-closed dialog
  // that reads would race the page's own load and double the accounts and categories reads.
  const { data: accounts } = useAccounts(open ? user?.id : undefined)
  const { data: categories } = useCategories(open ? user?.id : undefined)
  const { defaultCurrency } = useCurrency()
  const createTransaction = useCreateTransaction(user?.id)

  function handleSubmit(values: TransactionFormValues) {
    const currency = accounts?.find((a) => a.id === values.accountId)?.currency ?? defaultCurrency
    createTransaction.mutate({ ...values, currency }, { onSuccess: () => onOpenChange(false) })
  }

  return (
    <TransactionFormDialog
      open={open}
      onOpenChange={onOpenChange}
      accounts={accounts ?? []}
      categories={categories ?? []}
      onSubmit={handleSubmit}
      isPending={createTransaction.isPending}
      defaultAccountId={defaultAccountId}
    />
  )
}
