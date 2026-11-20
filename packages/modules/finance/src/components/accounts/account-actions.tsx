"use client"

import { Button } from "@alter-ego/ui/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@alter-ego/ui/ui/dropdown-menu"
import { useToast } from "@alter-ego/ui/use-toast"
import { cn } from "@alter-ego/ui/utils"
import { Archive, MoreHorizontal, Pencil, Trash2 } from "lucide-react"
import { useState } from "react"

import { AccountFormDialog } from "./account-form-dialog"
import { useAccounts, useCreateAccount, useUpdateAccount, useDeleteAccount } from "../../hooks/use-accounts"
import { useCurrency } from "../../hooks/use-currency"
import { useAuth } from "../../host"
import { isAtZero } from "../../lib/account-ledger"
import { accountTypeOptions } from "../../lib/options"
import { ConfirmDeleteDialog } from "../confirm-delete-dialog"


import type { AccountFormValues } from "../../schemas"
import type { Account } from "../../types"

const BUILTIN_TYPE_VALUES = new Set(accountTypeOptions.map((o) => o.value))

/**
 * Create, edit, archive and delete an account, with the guards and the dialogs, for the pages that
 * carry them (the list and an account's own page). Render `dialogs` once.
 */
export function useAccountActions({ onDeleted }: { onDeleted?: () => void } = {}) {
  const { user } = useAuth()
  const { data: accounts } = useAccounts(user?.id)
  const { format } = useCurrency()
  const { toast } = useToast()
  const createAccount = useCreateAccount(user?.id)
  const updateAccount = useUpdateAccount(user?.id)
  const deleteAccount = useDeleteAccount(user?.id)

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Account | null>(null)
  const [deleting, setDeleting] = useState<Account | null>(null)

  function openNew() {
    setEditing(null)
    setFormOpen(true)
  }

  function edit(account: Account) {
    setEditing(account)
    setFormOpen(true)
  }

  function archive(account: Account) {
    // Archiving is closing: the balance leaves the totals, so it has to be zero first.
    if (!account.isArchived && !isAtZero(account.balance)) {
      toast({
        title: "Move the balance out before archiving",
        description: `${account.name} is at ${format(account.balance, account.currency)}. An archived account leaves the totals.`,
        variant: "destructive",
      })
      return
    }
    updateAccount.mutate(
      { id: account.id, input: { isArchived: !account.isArchived } },
      { onError: (err) => toast({ title: "Failed to archive account", description: err.message, variant: "destructive" }) },
    )
  }

  function handleSubmit(values: AccountFormValues) {
    const onError = (err: Error) => toast({ title: "Failed to save account", description: err.message, variant: "destructive" })
    if (editing) {
      updateAccount.mutate({ id: editing.id, input: values }, { onSuccess: () => setFormOpen(false), onError })
    } else {
      createAccount.mutate(values, { onSuccess: () => setFormOpen(false), onError })
    }
  }

  function handleDeleteConfirm() {
    if (!deleting) return
    deleteAccount.mutate(deleting.id, {
      onSuccess: () => {
        setDeleting(null)
        onDeleted?.()
      },
      onError: (err) => toast({ title: "Failed to delete account", description: err.message, variant: "destructive" }),
    })
  }

  const dialogs = (
    <>
      <AccountFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        account={editing}
        existingCustomTypes={[...new Set((accounts ?? []).map((a) => a.type).filter((t) => !BUILTIN_TYPE_VALUES.has(t)))]}
        onSubmit={handleSubmit}
        isPending={createAccount.isPending || updateAccount.isPending}
      />
      <ConfirmDeleteDialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete Account"
        description={`Are you sure you want to delete “${deleting?.name}”? Only an account with no transactions can be deleted; to close one that has history, archive it instead. This action cannot be undone.`}
        onConfirm={handleDeleteConfirm}
        isPending={deleteAccount.isPending}
      />
    </>
  )

  return { openNew, edit, archive, remove: setDeleting, dialogs }
}

interface AccountMenuProps {
  account: Account
  /** Left out where Edit Details is a button of its own. */
  onEdit?: (account: Account) => void
  onArchive: (account: Account) => void
  onDelete: (account: Account) => void
  /** The trigger: a card's bare dots, or a header's bordered button. */
  variant?: "card" | "header"
  className?: string
}

/** The Actions menu of an account: Edit, Archive (or Unarchive) and Delete. */
export function AccountMenu({ account, onEdit, onArchive, onDelete, variant = "card", className }: AccountMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant={variant === "header" ? "outline" : "ghost"}
          size={variant === "header" ? "icon-lg" : "icon"}
          // The name is an attribute, not text: a page's `getByText(account name)` must find the title alone.
          aria-label={variant === "header" ? "More actions" : `Actions for ${account.name}`}
          className={cn(variant === "card" && "-my-1.5 -mr-2", className)}
        >
          <MoreHorizontal aria-hidden className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onCloseAutoFocus={(e) => e.preventDefault()}>
        {onEdit && (
          <DropdownMenuItem onClick={() => onEdit(account)}>
            <Pencil className="mr-2 h-4 w-4" />
            Edit
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={() => onArchive(account)}>
          <Archive className="mr-2 h-4 w-4" />
          {account.isArchived ? "Unarchive" : "Archive"}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onDelete(account)} variant="destructive">
          <Trash2 className="mr-2 h-4 w-4" />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
