"use client"

import { isoDate } from "@alter-ego/kernel/dates"
import { Button } from "@alter-ego/ui/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@alter-ego/ui/ui/dialog"
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from "@alter-ego/ui/ui/form"
import { Input } from "@alter-ego/ui/ui/input"
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@alter-ego/ui/ui/select"
import { zodResolver } from "@hookform/resolvers/zod"
import { Sparkles, Check, Split, Trash2 } from "lucide-react"
import { useEffect, useState } from "react"
import { useForm, useWatch } from "react-hook-form"

import { CategoryCombobox } from "./category-combobox"
import { SplitEditor } from "./split-editor"
import { useCategorySuggestion } from "../../hooks/use-category-suggestion"
import { useMerchantNormalization } from "../../hooks/use-merchant-normalization"
import { useDescriptionSuggestions } from "../../hooks/use-transactions"
import { useAuth } from "../../host"
import { transactionFormSchema, type TransactionFormValues } from "../../schemas"
import { CategoryChip } from "../categories/category-chip"

import type { Transaction, TransactionSplit, Account, Category } from "../../types"


interface TransactionFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  transaction?: Transaction | null
  accounts: Account[]
  categories: Category[]
  onSubmit: (values: TransactionFormValues) => void
  isPending: boolean
  /** Edit mode only: a Delete in the footer, handed the transaction being edited. */
  onDelete?: (transaction: Transaction) => void
  /** Adding only: the account the form opens on, when it is one a transaction can go on (an account's own page). */
  defaultAccountId?: string
}

/** The accounts the pickers offer: open ones, plus the archived one a transaction being edited already sits on. */
export function pickableAccounts(accounts: Account[], transaction?: Transaction | null): Account[] {
  return accounts.filter(
    (a) => !a.isArchived || a.id === transaction?.accountId || a.id === transaction?.transferToAccountId,
  )
}

export function TransactionFormDialog({
  open,
  onOpenChange,
  transaction,
  accounts,
  categories,
  onSubmit,
  isPending,
  onDelete,
  defaultAccountId,
}: TransactionFormDialogProps) {
  const isEditing = !!transaction
  const pickable = pickableAccounts(accounts, transaction)
  const { user } = useAuth()
  const { normalize } = useMerchantNormalization(user?.id)
  const { data: descriptionSuggestions } = useDescriptionSuggestions(user?.id)
  const [splitMode, setSplitMode] = useState(false)
  const [splits, setSplits] = useState<TransactionSplit[]>([])

  const form = useForm<TransactionFormValues>({
    resolver: zodResolver(transactionFormSchema),
    defaultValues: {
      type: "expense",
      amount: 0,
      description: "",
      accountId: "",
      date: new Date(),
      notes: "",
      status: "cleared",
    },
  })

  const transactionType = useWatch({ control: form.control, name: "type" })
  const description = useWatch({ control: form.control, name: "description" })
  const amount = useWatch({ control: form.control, name: "amount" })

  const { suggestedCategoryId, clearSuggestion } = useCategorySuggestion(
    description,
    transactionType,
    categories,
    user?.id,
  )

  useEffect(() => {
    if (open) {
      if (transaction) {
        form.reset({
          type: transaction.type,
          amount: transaction.amount,
          description: transaction.description,
          accountId: transaction.accountId,
          categoryId: transaction.categoryId ?? undefined,
          date: transaction.date,
          notes: transaction.notes ?? "",
          status: transaction.status ?? "cleared",
          transferToAccountId: transaction.transferToAccountId ?? undefined,
        })
        if (transaction.splits.length > 0) {
          // The split state is reset with the form each time the dialog opens; the
          // rule reports only this first setState of the effect. Moving the reset
          // into render (the prev-value pattern) is the fix, left for its own change.
          // eslint-disable-next-line react-hooks/set-state-in-effect
          setSplitMode(true)
          setSplits(transaction.splits)
        } else {
          setSplitMode(false)
          setSplits([])
        }
      } else {
        form.reset({
          type: "expense",
          amount: 0,
          description: "",
          accountId: (pickable.find((a) => a.id === defaultAccountId) ?? pickable[0])?.id ?? "",
          date: new Date(),
          notes: "",
          status: "cleared",
        })
        setSplitMode(false)
        setSplits([])
      }
      clearSuggestion()
    }
  }, [open, transaction, accounts, form]) // eslint-disable-line react-hooks/exhaustive-deps

  const suggestedCategory = suggestedCategoryId
    ? categories.find((c) => c.id === suggestedCategoryId)
    : null

  const currentCategoryId = useWatch({ control: form.control, name: "categoryId" })
  const showSuggestion =
    suggestedCategory !== undefined &&
    suggestedCategory !== null &&
    currentCategoryId !== suggestedCategoryId

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm" className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit Transaction" : "New Transaction"}</DialogTitle>
          <DialogDescription>
            {isEditing ? "Update transaction details." : "Record a new transaction."}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit((values) => {
            if (splitMode && splits.length > 0) {
              onSubmit({ ...values, categoryId: undefined, splits })
            } else {
              onSubmit({ ...values, splits: [] })
            }
          })} className="space-y-4">
            <FormField
              control={form.control}
              name="type"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Type</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="expense">Expense</SelectItem>
                      <SelectItem value="income">Income</SelectItem>
                      <SelectItem value="transfer">Transfer</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="amount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Amount</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="0.00"
                        {...field}
                        onChange={(e) => field.onChange(e.target.valueAsNumber || 0)}
                      />
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
                      <Input
                        type="date"
                        value={field.value ? isoDate(new Date(field.value)) : ""}
                        onChange={(e) => field.onChange(new Date(e.target.value + "T00:00:00"))}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => {
                const normalized = field.value ? normalize(field.value) : ""
                const willNormalize = field.value && normalized !== field.value
                return (
                  <FormItem>
                    <FormLabel>Description</FormLabel>
                    {/* The Input has to be FormControl's only child: FormControl is a
                        Slot, and a fragment gives it nothing to put the generated id
                        on — which left the visible label tied to no control at all. */}
                    <FormControl>
                      <Input placeholder="e.g. Grocery shopping" list="desc-suggestions" {...field} />
                    </FormControl>
                    <datalist id="desc-suggestions">
                      {descriptionSuggestions?.map((d) => (
                        <option key={d} value={d} />
                      ))}
                    </datalist>
                    {willNormalize && (
                      <p className="text-xs text-muted-foreground">
                        Will be saved as: <span className="font-medium">{normalized}</span>
                      </p>
                    )}
                    {/* What the bank or import said, which the read-only detail dialog used to show. */}
                    {transaction?.rawDescription && transaction.rawDescription !== transaction.description && (
                      <p className="text-xs text-muted-foreground">
                        Original: <span className="font-medium">{transaction.rawDescription}</span>
                      </p>
                    )}
                    <FormMessage />
                  </FormItem>
                )
              }}
            />
            <FormField
              control={form.control}
              name="accountId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{transactionType === "transfer" ? "From Account" : "Account"}</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select account" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {pickable.map((account) => (
                        <SelectItem key={account.id} value={account.id}>
                          {account.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            {transactionType === "transfer" ? (
              <FormField
                control={form.control}
                name="transferToAccountId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>To Account</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value ?? ""}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select destination" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {pickable.map((account) => (
                          <SelectItem key={account.id} value={account.id}>
                            {account.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ) : splitMode ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Category (Split)</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setSplitMode(false)
                      setSplits([])
                    }}
                  >
                    Single category
                  </Button>
                </div>
                <SplitEditor
                  splits={splits}
                  totalAmount={amount || 0}
                  onChange={setSplits}
                  categories={
                    transactionType === "income"
                      ? categories.filter((c) => c.group === "income")
                      : categories.filter((c) => c.group !== "income")
                  }
                />
              </div>
            ) : (
              <FormField
                control={form.control}
                name="categoryId"
                render={({ field }) => {
                  const filteredCats = transactionType === "income"
                    ? categories.filter((c) => c.group === "income")
                    : categories.filter((c) => c.group !== "income")
                  return (
                    <FormItem>
                      <div className="flex items-center justify-between">
                        <FormLabel>Category</FormLabel>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-auto px-2 py-0.5 text-xs"
                          onClick={() => setSplitMode(true)}
                        >
                          <Split className="mr-1 h-3 w-3" />
                          Split
                        </Button>
                      </div>
                      <FormControl>
                        <CategoryCombobox
                          categories={filteredCats}
                          value={field.value}
                          onChange={(id) => field.onChange(id ?? undefined)}
                        />
                      </FormControl>
                      {showSuggestion && (
                        <button
                          type="button"
                          onClick={() => {
                            form.setValue("categoryId", suggestedCategory!.id)
                            clearSuggestion()
                          }}
                          className="flex items-center gap-1.5 rounded-full border border-dashed border-primary/50 bg-primary/5 px-2.5 py-0.5 text-xs text-primary transition-colors hover:bg-primary/10"
                        >
                          <Sparkles className="h-3 w-3" />
                          <span>Suggested:</span>
                          <CategoryChip category={suggestedCategory} plain />
                          <Check className="h-3 w-3" />
                        </button>
                      )}
                      <FormMessage />
                    </FormItem>
                  )
                }}
              />
            )}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Notes (optional)</FormLabel>
                    <FormControl>
                      <Input placeholder="Additional details..." {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="status"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Status</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value ?? "cleared"}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="pending">Pending</SelectItem>
                        <SelectItem value="cleared">Cleared</SelectItem>
                        <SelectItem value="reconciled">Reconciled</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <DialogFooter>
              {/* Delete on the left, away from the thumb; Save, the usual action, last. */}
              {transaction && onDelete && (
                <Button type="button" variant="destructive" className="mr-auto max-sm:w-11 max-sm:px-0" onClick={() => onDelete(transaction)}>
                  <Trash2 aria-hidden />
                  {/* An icon on a phone: with the label, Save wrapped onto a second row. */}
                  <span className="max-sm:sr-only">Delete</span>
                </Button>
              )}
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? "Saving..." : isEditing ? "Save Changes" : "Add Transaction"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
