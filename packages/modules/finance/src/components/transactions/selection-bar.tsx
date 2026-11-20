"use client"

import { useMemo, useState } from "react"

import { ConfirmDeleteDialog } from "../confirm-delete-dialog"
import { BulkActionBar } from "./bulk-action-bar"
import { BulkChangeDialog } from "./bulk-change-dialog"
import { useBulkDeleteTransactions, useUpdateTransaction } from "../../hooks/use-transactions"
import { useAuth } from "../../host"
import { selectionSummary } from "../../lib/selection-summary"

import type { Account, Transaction } from "../../types"

interface TransactionSelectionBarProps {
  selected: Map<string, Transaction>
  accounts: Account[]
  onClear: () => void
}

/** The bar with the figures, and the dialogs behind its actions: Transactions and an account's page share it. */
export function TransactionSelectionBar({ selected, accounts, onClear }: TransactionSelectionBarProps) {
  const { user } = useAuth()
  const updateTransaction = useUpdateTransaction(user?.id)
  const bulkDelete = useBulkDeleteTransactions(user?.id)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [changeMode, setChangeMode] = useState<"account" | "date" | null>(null)
  const [pending, setPending] = useState(false)
  const summary = useMemo(() => selectionSummary(selected.values()), [selected])

  async function handleDelete() {
    setPending(true)
    try {
      await bulkDelete.mutateAsync(Array.from(selected.keys()))
      onClear()
      setDeleteOpen(false)
    } finally {
      setPending(false)
    }
  }

  async function handleChange(value: string | Date) {
    if (!changeMode) return
    setPending(true)
    try {
      const input = changeMode === "account" ? { accountId: value as string } : { date: value as Date }
      // allSettled: a row deleted meanwhile must not leave the dialog stuck.
      await Promise.allSettled(Array.from(selected.keys()).map((id) => updateTransaction.mutateAsync({ id, input })))
      onClear()
      setChangeMode(null)
    } finally {
      setPending(false)
    }
  }

  return (
    <>
      <BulkActionBar
        summary={summary}
        onDelete={() => setDeleteOpen(true)}
        onChangeAccount={() => setChangeMode("account")}
        onChangeDate={() => setChangeMode("date")}
        onClear={onClear}
      />
      <ConfirmDeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete Transactions"
        description={`Are you sure you want to delete ${selected.size} transaction${selected.size > 1 ? "s" : ""}? This action cannot be undone.`}
        onConfirm={handleDelete}
        isPending={pending}
      />
      {changeMode && (
        <BulkChangeDialog
          open
          onOpenChange={(open) => !open && setChangeMode(null)}
          mode={changeMode}
          accounts={accounts}
          count={selected.size}
          onConfirm={handleChange}
          isPending={pending}
        />
      )}
    </>
  )
}
