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
import { useEffect } from "react"
import { useForm, useWatch } from "react-hook-form"

import { createRecurringTransactionSchema } from "../../schemas"
import { CategoryChip } from "../categories/category-chip"

import type { Account, Category, Currency, RecurringTransaction } from "../../types"
import type { z } from "zod"

type FormValues = z.infer<typeof createRecurringTransactionSchema>

interface RecurringFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  rule?: RecurringTransaction | null
  accounts: Account[]
  categories: Category[]
  defaultCurrency: Currency
  onSubmit: (values: FormValues) => void
  isPending: boolean
}

export function RecurringFormDialog({
  open,
  onOpenChange,
  rule,
  accounts,
  categories,
  defaultCurrency,
  onSubmit,
  isPending,
}: RecurringFormDialogProps) {
  const isEditing = !!rule
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const form = useForm<FormValues>({
    resolver: zodResolver(createRecurringTransactionSchema),
    defaultValues: {
      accountId: "",
      type: "expense",
      amount: 0,
      currency: defaultCurrency,
      categoryId: null,
      description: "",
      notes: "",
      frequency: "monthly",
      interval: 1,
      startDate: today,
      endDate: null,
    },
  })

  useEffect(() => {
    if (open) {
      if (rule) {
        form.reset({
          accountId: rule.accountId,
          type: rule.type,
          amount: rule.amount,
          currency: rule.currency,
          categoryId: rule.categoryId,
          description: rule.description,
          notes: rule.notes ?? "",
          frequency: rule.frequency,
          interval: rule.interval,
          startDate: rule.startDate,
          endDate: rule.endDate,
        })
      } else {
        const d = new Date()
        d.setHours(0, 0, 0, 0)
        form.reset({
          accountId: accounts[0]?.id ?? "",
          type: "expense",
          amount: 0,
          currency: defaultCurrency,
          categoryId: null,
          description: "",
          notes: "",
          frequency: "monthly",
          interval: 1,
          startDate: d,
          endDate: null,
        })
      }
    }
  }, [open, rule, defaultCurrency, accounts, form])

  const expenseCategories = categories.filter((c) => c.group !== "income")
  const incomeCategories = categories.filter((c) => c.group === "income")
  const type = useWatch({ control: form.control, name: "type" })
  const filteredCategories = type === "income" ? incomeCategories : expenseCategories

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit Recurring Rule" : "New Recurring Transaction"}</DialogTitle>
          <DialogDescription>
            {isEditing
              ? "Update the recurring transaction rule."
              : "Set up a transaction that repeats automatically."}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. Monthly Rent" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
                        <SelectItem value="income">Income</SelectItem>
                        <SelectItem value="expense">Expense</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
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
                        min="0.01"
                        placeholder="0.00"
                        {...field}
                        onChange={(e) => field.onChange(e.target.valueAsNumber || 0)}
                      />
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
                  <FormLabel>Account</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select account" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {accounts.map((acc) => (
                        <SelectItem key={acc.id} value={acc.id}>
                          {acc.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="categoryId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Category</FormLabel>
                  <Select
                    onValueChange={(v) => field.onChange(v === "__none__" ? null : v)}
                    value={field.value ?? "__none__"}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select category" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="__none__">No category</SelectItem>
                      {filteredCategories.map((cat) => (
                        <SelectItem key={cat.id} value={cat.id}>
                          <CategoryChip category={cat} plain />
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="frequency"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Frequency</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="daily">Daily</SelectItem>
                        <SelectItem value="weekly">Weekly</SelectItem>
                        <SelectItem value="monthly">Monthly</SelectItem>
                        <SelectItem value="yearly">Yearly</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="interval"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Every (interval)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min="1"
                        step="1"
                        {...field}
                        onChange={(e) => field.onChange(e.target.valueAsNumber || 1)}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="startDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Start Date</FormLabel>
                    <FormControl>
                      <Input
                        type="date"
                        value={field.value ? isoDate(field.value) : ""}
                        onChange={(e) => {
                          const d = e.target.value ? new Date(e.target.value + "T00:00:00") : new Date()
                          field.onChange(d)
                        }}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="endDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>End Date <span className="text-xs text-muted-foreground">(optional)</span></FormLabel>
                    <FormControl>
                      <Input
                        type="date"
                        value={field.value ? isoDate(field.value) : ""}
                        onChange={(e) => {
                          field.onChange(e.target.value ? new Date(e.target.value + "T00:00:00") : null)
                        }}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? "Saving..." : isEditing ? "Save Changes" : "Create Rule"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
