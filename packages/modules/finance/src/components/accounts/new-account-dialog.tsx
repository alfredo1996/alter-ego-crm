"use client"

import { useToast } from "@alter-ego/ui/use-toast"

import { AccountFormDialog } from "./account-form-dialog"
import { useAccounts, useCreateAccount } from "../../hooks/use-accounts"
import { useAuth } from "../../host"
import { accountTypeOptions } from "../../lib/options"

import type { AccountFormValues } from "../../schemas"

const BUILTIN_TYPE_VALUES = new Set(accountTypeOptions.map((o) => o.value))

interface NewAccountDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** The New Account form with its own save, for a page that opens it in place (the Dashboard). */
export function NewAccountDialog({ open, onOpenChange }: NewAccountDialogProps) {
  const { user } = useAuth()
  const { data: accounts } = useAccounts(user?.id)
  const createAccount = useCreateAccount(user?.id)
  const { toast } = useToast()

  function handleSubmit(values: AccountFormValues) {
    createAccount.mutate(values, {
      onSuccess: () => onOpenChange(false),
      onError: (err) => toast({ title: "Failed to save account", description: err.message, variant: "destructive" }),
    })
  }

  return (
    <AccountFormDialog
      open={open}
      onOpenChange={onOpenChange}
      existingCustomTypes={[...new Set((accounts ?? []).map((a) => a.type).filter((t) => !BUILTIN_TYPE_VALUES.has(t)))]}
      onSubmit={handleSubmit}
      isPending={createAccount.isPending}
    />
  )
}
