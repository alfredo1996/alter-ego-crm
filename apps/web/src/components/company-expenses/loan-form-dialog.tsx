"use client"

import { isoDate } from "@alter-ego/kernel/dates"
import { Button } from "@alter-ego/ui/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@alter-ego/ui/ui/dialog"
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@alter-ego/ui/ui/form"
import { Input } from "@alter-ego/ui/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@alter-ego/ui/ui/select"
import { Textarea } from "@alter-ego/ui/ui/textarea"
import { toast } from "@alter-ego/ui/use-toast"
import { cn } from "@alter-ego/ui/utils"
import { zodResolver } from "@hookform/resolvers/zod"
import { Trash2 } from "lucide-react"
import { useState } from "react"
import { useForm, useWatch } from "react-hook-form"


import { defaultAccountId, rememberAccount } from "@/components/cash-book/last-account"
import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog"
import { useCreateCompanyLoan, useDeleteCompanyLoan, useUpdateCompanyLoan } from "@/hooks/use-company-loans"
import { dayLabel, ownerLoanBalance, round2 } from "@/lib/cash-book"
import { eurCents } from "@/lib/invoices"
import { z } from "@/lib/zod"

import type { CompanyAccount, CompanyExpense, CompanyLoan, CompanyLoanDirection, CreateCompanyLoanInput } from "@/types"

/** A loan written before the cash book, or with no account set up yet. */
const NO_ACCOUNT = "none"

export const LOAN_ACTIONS: Record<CompanyLoanDirection, string> = {
  to_company: "Lend to SRL",
  from_company: "Repay Shareholder Loan",
}

const DEFAULT_DESCRIPTION: Record<CompanyLoanDirection, string> = {
  to_company: "Shareholder loan",
  from_company: "Shareholder loan repayment",
}

type Values = { direction: CompanyLoanDirection; amount: string; date: string; accountId: string; description: string; notes: string }

/**
 * A shareholder loan, dated and through an account: money the owner lends the
 * company, or the company pays back (loans, and costs the owner paid by card).
 * Never a withdrawal: in an SRL money reaches the owner only for a reason.
 */
export function LoanFormDialog({
  userId,
  open,
  onOpenChange,
  onCloseAutoFocus,
  loan,
  direction,
  accounts,
  loans,
  expenses,
}: {
  userId: string | undefined
  open: boolean
  onOpenChange: (open: boolean) => void
  onCloseAutoFocus?: (event: Event) => void
  /** Editing this one; null adds one going `direction`. */
  loan: CompanyLoan | null
  direction: CompanyLoanDirection
  accounts: CompanyAccount[]
  /** Every loan and cost: what the SRL owes the owner besides this one. */
  loans: CompanyLoan[]
  expenses: CompanyExpense[]
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" onCloseAutoFocus={onCloseAutoFocus}>
        {open && (
          <LoanForm
            key={loan?.id ?? direction}
            userId={userId}
            loan={loan}
            direction={direction}
            accounts={accounts}
            owedBefore={ownerLoanBalance(loans.filter((l) => l.id !== loan?.id), expenses).total}
            onClose={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function LoanForm({
  userId,
  loan,
  direction,
  accounts,
  owedBefore,
  onClose,
}: {
  userId: string | undefined
  loan: CompanyLoan | null
  direction: CompanyLoanDirection
  accounts: CompanyAccount[]
  owedBefore: number
  onClose: () => void
}) {
  const createLoan = useCreateCompanyLoan(userId)
  const updateLoan = useUpdateCompanyLoan(userId)
  const deleteLoan = useDeleteCompanyLoan(userId)
  const [today] = useState(() => isoDate(new Date()))
  const [confirmDelete, setConfirmDelete] = useState(false)
  // No account to pick: none set up yet, or a loan written before the cash book.
  const allowNone = accounts.length === 0 || (loan !== null && loan.accountId === null)

  const schema = z
    .object({
      direction: z.enum(["to_company", "from_company"]),
      amount: z.string(),
      date: z.string(),
      accountId: z.string(),
      description: z.string().max(300, "Keep it under 300 characters."),
      notes: z.string().max(500, "Keep it under 500 characters."),
    })
    .superRefine((v, ctx) => {
      const amount = Number(v.amount)
      if (v.amount.trim() === "" || !Number.isFinite(amount) || amount <= 0) {
        ctx.addIssue({ code: "custom", path: ["amount"], message: "Enter the amount, above 0." })
      }
      if (!v.date) ctx.addIssue({ code: "custom", path: ["date"], message: "Enter the day it went through the bank." })
      if (!v.accountId) ctx.addIssue({ code: "custom", path: ["accountId"], message: "Pick the account." })
    })

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: loan
      ? {
          direction: loan.direction,
          amount: String(loan.amount),
          date: isoDate(loan.date),
          accountId: loan.accountId ?? NO_ACCOUNT,
          description: loan.description,
          notes: loan.notes ?? "",
        }
      : {
          direction,
          amount: "",
          date: today,
          accountId: defaultAccountId(accounts) || (accounts.length === 0 ? NO_ACCOUNT : ""),
          description: "",
          notes: "",
        },
  })
  const values = useWatch({ control: form.control }) as Values
  const repay = values.direction === "from_company"
  const amount = Number(values.amount) || 0
  const after = round2(owedBefore + (repay ? -amount : amount))

  const save = form.handleSubmit(async (v) => {
    const input: CreateCompanyLoanInput = {
      direction: v.direction,
      amount: round2(Number(v.amount)),
      date: new Date(`${v.date}T00:00:00`),
      accountId: v.accountId === NO_ACCOUNT ? null : v.accountId,
      description: v.description.trim() || DEFAULT_DESCRIPTION[v.direction],
      notes: v.notes.trim() || null,
    }
    try {
      if (loan) {
        // Any date edit makes the day a real one.
        const dateEdited = v.date !== isoDate(loan.date)
        await updateLoan.mutateAsync({ id: loan.id, input: { ...input, ...(dateEdited && { dateEstimated: false }) } })
      } else {
        await createLoan.mutateAsync(input)
      }
    } catch {
      return // The app-wide error toast says why; the form stays to retry.
    }
    if (input.accountId) rememberAccount(input.accountId)
    toast({
      title: `${loan ? "Saved" : "Recorded"}: ${input.direction === "to_company" ? "loan to the SRL" : "repayment to you"} of ${eurCents(input.amount)}. The SRL owes you ${eurCents(Math.max(0, after))}.`,
    })
    onClose()
  })

  const pending = createLoan.isPending || updateLoan.isPending
  const accountName = accounts.find((a) => a.id === values.accountId)?.name

  return (
    <>
      <DialogHeader>
        <DialogTitle>{loan ? "Edit Shareholder Loan" : LOAN_ACTIONS[direction]}</DialogTitle>
        <DialogDescription>
          {repay
            ? "The company pays you back what it owes you: loans, and costs you paid with your own card. Not a cost, and never a withdrawal."
            : "Money you lend the company. It owes it back to you: not income, and the Plan leaves it out."}
        </DialogDescription>
      </DialogHeader>
      <Form {...form}>
        <form noValidate className="space-y-4" onSubmit={save}>
          <div role="group" aria-label="Direction" className="grid grid-cols-2 gap-1 rounded-md bg-muted p-1">
            {(["to_company", "from_company"] as const).map((d) => (
              <button
                key={d}
                type="button"
                aria-pressed={values.direction === d}
                onClick={() => form.setValue("direction", d)}
                className={cn(
                  "rounded-sm px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors",
                  values.direction === d && "bg-background text-foreground shadow-sm",
                )}
              >
                {LOAN_ACTIONS[d]}
              </button>
            ))}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="amount"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Amount</FormLabel>
                  <FormControl>
                    <Input {...field} autoFocus type="number" min="0" step="0.01" inputMode="decimal" className="text-right tabular-nums" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="date"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Date</FormLabel>
                  <FormControl>
                    <Input type="date" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <FormField
            control={form.control}
            name="accountId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{repay ? "From Account" : "Into Account"}</FormLabel>
                <Select value={field.value} onValueChange={(v) => v && field.onChange(v)}>
                  <FormControl>
                    <SelectTrigger ref={field.ref}>
                      <SelectValue placeholder="Pick an account" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {accounts.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name}
                      </SelectItem>
                    ))}
                    {allowNone && <SelectItem value={NO_ACCOUNT}>No Company Account</SelectItem>}
                  </SelectContent>
                </Select>
                <FormDescription>
                  {field.value === NO_ACCOUNT
                    ? accounts.length === 0
                      ? "No company account yet: add them in the Cash Book, so loans show in its balances."
                      : "Not in any balance of the Cash Book: pick the account the money went through."
                    : accountName
                      ? `In the Cash Book on ${accountName}${values.date ? `, ${dayLabel(values.date)}` : ""}.`
                      : "The account the money went through: the loan shows in its Cash Book balance."}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <p
            role="status"
            className={cn("rounded-md bg-muted px-3 py-2 text-sm", repay && after < 0 && "bg-amber-500/10 text-amber-800 dark:text-amber-300")}
          >
            {repay && after < 0
              ? `More than the SRL owes you (${eurCents(Math.max(0, owedBefore))}): it would have paid you ${eurCents(-after)} with no reason, which an SRL can't. Check the amount.`
              : `The SRL owes you ${eurCents(Math.max(0, owedBefore))} now${amount > 0 ? `, ${eurCents(after)} after this.` : "."}`}
          </p>

          <FormField
            control={form.control}
            name="description"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Description (optional)</FormLabel>
                <FormControl>
                  <Input placeholder={DEFAULT_DESCRIPTION[values.direction]} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="notes"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Notes (optional)</FormLabel>
                <FormControl>
                  <Textarea rows={2} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <DialogFooter className="justify-between">
            {loan && (
              <Button type="button" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setConfirmDelete(true)}>
                <Trash2 className="h-4 w-4 sm:mr-2" />
                <span className="max-sm:sr-only">Delete</span>
              </Button>
            )}
            <div className="ml-auto flex flex-wrap justify-end gap-2">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Saving…" : loan ? "Save Changes" : repay ? "Record Repayment" : "Record Loan"}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </Form>
      {loan && (
        <ConfirmDeleteDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          title="Delete Shareholder Loan?"
          description={`${loan.description}, ${eurCents(loan.amount)} on ${dayLabel(isoDate(loan.date))}. What the SRL owes you${loan.accountId ? " and the account's balance" : ""} change at once.`}
          confirmLabel="Delete Loan"
          isPending={deleteLoan.isPending}
          onConfirm={() =>
            deleteLoan.mutate(loan.id, {
              onSuccess: () => {
                setConfirmDelete(false)
                onClose()
                toast({ title: `Deleted: ${loan.description}.` })
              },
            })
          }
        />
      )}
    </>
  )
}
