"use client"

import { isoDate } from "@alter-ego/kernel/dates"
import { Button } from "@alter-ego/ui/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@alter-ego/ui/ui/dialog"
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@alter-ego/ui/ui/form"
import { Input } from "@alter-ego/ui/ui/input"
import { zodResolver } from "@hookform/resolvers/zod"
import { useRef, useState } from "react"
import { useForm } from "react-hook-form"


import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog"
import {
  useCreateCompanyAccount,
  useDeleteCompanyAccount,
  useUpdateCompanyAccount,
} from "@/hooks/use-company-accounts"
import { dayLabel, round2 } from "@/lib/cash-book"
import { eurCents } from "@/lib/invoices"
import { z } from "@/lib/zod"

import type { CompanyAccount } from "@/types"

type Values = { name: string; openingBalance: string; openingDate: string }

/**
 * The company's accounts: add one with the balance it had at the start of a
 * day, rename it or fix that balance, delete one nothing was recorded on. It
 * stays open to add the next one, so what happened is said inside it, not in a
 * toast that Esc would close first.
 */
export function AccountsDialog({
  userId,
  open,
  onOpenChange,
  onCloseAutoFocus,
  accounts,
  inUse,
}: {
  userId: string | undefined
  open: boolean
  onOpenChange: (open: boolean) => void
  /** No DialogTrigger: the caller says where focus goes back to. */
  onCloseAutoFocus?: (event: Event) => void
  accounts: CompanyAccount[]
  /** Accounts a movement, cost or paid invoice names: they can't be deleted. */
  inUse: (accountId: string) => boolean
}) {
  // null adds; an account edits it.
  const [editing, setEditing] = useState<CompanyAccount | null>(null)
  const [deleting, setDeleting] = useState<CompanyAccount | null>(null)
  const [status, setStatus] = useState("")
  const content = useRef<HTMLDivElement>(null)
  /** The Delete tapped, while its account is still there: where Cancel puts focus back. */
  const deleteButton = useRef<HTMLButtonElement | null>(null)
  const deleteAccount = useDeleteCompanyAccount(userId)
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setEditing(null)
          setStatus("")
        }
        onOpenChange(next)
      }}
    >
      <DialogContent ref={content} size="md" onCloseAutoFocus={onCloseAutoFocus}>
        <DialogHeader>
          <DialogTitle>Company Accounts</DialogTitle>
          <DialogDescription>
            The company&apos;s bank accounts and cash box.
          </DialogDescription>
        </DialogHeader>
        {/* Mounted empty, so the first message is announced too. */}
        <p role="status" className={status ? "rounded-md bg-muted px-3 py-2 text-sm" : "sr-only"}>
          {status}
        </p>
        {accounts.length > 0 && (
          <ul className="divide-y rounded-md border">
            {accounts.map((a) => {
              const used = inUse(a.id)
              return (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                  <div className="min-w-0">
                    <p className="font-medium">{a.name}</p>
                    <p className="text-xs text-muted-foreground">
                      Opened {dayLabel(isoDate(a.openingDate))} with {eurCents(a.openingBalance)}
                    </p>
                    {used && <p className="text-xs text-muted-foreground">Has entries: it can&apos;t be deleted.</p>}
                  </div>
                  <div className="flex gap-1">
                    <Button type="button" variant="outline" size="sm" onClick={() => setEditing(a)}>
                      Edit
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      disabled={used || deleteAccount.isPending}
                      aria-label={`Delete ${a.name}`}
                      onClick={(e) => {
                        deleteButton.current = e.currentTarget
                        setDeleting(a)
                      }}
                    >
                      Delete
                    </Button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
        <AccountForm
          key={editing?.id ?? "new"}
          userId={userId}
          account={editing}
          onDone={(message) => {
            setEditing(null)
            if (message) setStatus(message)
          }}
        />
        <ConfirmDeleteDialog
          open={deleting !== null}
          onOpenChange={(next) => !next && setDeleting(null)}
          // Cancel: back to its Delete, so the list stays where it was (the form's field scrolled the
          // dialog down to it). Deleted, that button is gone: focus goes to the form's first field.
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            ;(deleteButton.current ?? content.current?.querySelector<HTMLInputElement>("input"))?.focus()
          }}
          title={`Delete ${deleting?.name ?? "Account"}?`}
          description="Its name, opening balance and last bank check go. Nothing is recorded on it, so no balance changes."
          confirmLabel="Delete Account"
          isPending={deleteAccount.isPending}
          onConfirm={() => {
            const a = deleting
            if (!a) return
            deleteAccount.mutate(a.id, {
              onSuccess: () => {
                deleteButton.current = null
                if (editing?.id === a.id) setEditing(null)
                setDeleting(null)
                setStatus(`${a.name} deleted.`)
              },
            })
          }}
        />
      </DialogContent>
    </Dialog>
  )
}

/** Stable, so React runs it once per mount: an inline ref ran on every render and pulled the dialog back. */
const scrollIntoView = (el: HTMLElement | null) => el?.scrollIntoView?.({ block: "end", behavior: "smooth" })

function AccountForm({
  userId,
  account,
  onDone,
}: {
  userId: string | undefined
  account: CompanyAccount | null
  /** Saved: what to say; cancelled: nothing. */
  onDone: (message?: string) => void
}) {
  const createAccount = useCreateCompanyAccount(userId)
  const updateAccount = useUpdateCompanyAccount(userId)
  const [today] = useState(() => isoDate(new Date()))
  const form = useForm<Values>({
    resolver: zodResolver(
      z.object({
        name: z.string().trim().min(1, "Name the account, e.g. Main Bank.").max(100, "Keep it under 100 characters."),
        openingBalance: z
          .string()
          .refine((v) => v.trim() !== "" && Number.isFinite(Number(v)), "Enter the balance, 0 if it was empty."),
        openingDate: z.string().min(1, "Enter the day of that balance."),
      }),
    ),
    defaultValues: account
      ? { name: account.name, openingBalance: String(account.openingBalance), openingDate: isoDate(account.openingDate) }
      : { name: "", openingBalance: "", openingDate: today },
  })
  const pending = createAccount.isPending || updateAccount.isPending

  const submit = form.handleSubmit(async (v) => {
    const input = {
      name: v.name.trim(),
      openingBalance: round2(Number(v.openingBalance)),
      openingDate: new Date(`${v.openingDate}T00:00:00`),
    }
    try {
      if (account) await updateAccount.mutateAsync({ id: account.id, input })
      else await createAccount.mutateAsync(input)
    } catch {
      return
    }
    form.reset({ name: "", openingBalance: "", openingDate: today })
    onDone(account ? `${input.name} saved.` : `${input.name} added. Add the next one, or close.`)
  })

  return (
    <Form {...form}>
      {/* Edit brings the form, Save included, into view: below the list it sat off a phone's screen.
          Keyed by the account, so the ref runs once per Edit. */}
      <form
        ref={account ? scrollIntoView : undefined}
        noValidate
        onSubmit={submit}
        className="space-y-4 rounded-md border p-4"
      >
        <h3 className="font-medium">{account ? `Edit ${account.name}` : "Add Account"}</h3>
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Name</FormLabel>
              <FormControl>
                <Input placeholder="e.g. Main Bank" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="openingBalance"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Opening Balance</FormLabel>
                <FormControl>
                  <Input type="number" step="0.01" inputMode="decimal" className="text-right tabular-nums" {...field} />
                </FormControl>
                <FormDescription>
                  At the start of the opening date, before its movements: the previous day&apos;s closing balance on
                  the statement.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="openingDate"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Opening Date</FormLabel>
                <FormControl>
                  <Input type="date" {...field} />
                </FormControl>
                <FormDescription>Movements from this day on add to the balance; earlier ones stay out.</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <div className="flex justify-end gap-2">
          {account && (
            <Button type="button" variant="outline" onClick={() => onDone()}>
              Cancel
            </Button>
          )}
          <Button type="submit" disabled={pending}>
            {account ? "Save Account" : "Add Account"}
          </Button>
        </div>
      </form>
    </Form>
  )
}
