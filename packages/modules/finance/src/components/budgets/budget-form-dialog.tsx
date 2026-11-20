"use client"

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
import { useForm } from "react-hook-form"
import { type z } from "zod"

import { createBudgetSchema } from "../../schemas"
import { CategoryChip } from "../categories/category-chip"

import type { Budget, Category, Currency } from "../../types"

type BudgetFormValues = z.infer<typeof createBudgetSchema>

interface BudgetFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  budget?: Budget | null
  categories: Category[]
  defaultCurrency: Currency
  onSubmit: (values: BudgetFormValues) => void
  isPending: boolean
}

export function BudgetFormDialog({
  open,
  onOpenChange,
  budget,
  categories,
  defaultCurrency,
  onSubmit,
  isPending,
}: BudgetFormDialogProps) {
  const isEditing = !!budget
  const form = useForm<BudgetFormValues>({
    resolver: zodResolver(createBudgetSchema),
    defaultValues: {
      name: "",
      categoryId: null,
      amount: 0,
      currency: defaultCurrency,
      period: "monthly",
      rolloverMode: "reset",
    },
  })

  useEffect(() => {
    if (open) {
      if (budget) {
        form.reset({
          name: budget.name,
          categoryId: budget.categoryId,
          amount: budget.amount,
          currency: budget.currency,
          period: budget.period,
          rolloverMode: budget.rolloverMode ?? "reset",
        })
      } else {
        form.reset({
          name: "",
          categoryId: null,
          amount: 0,
          currency: defaultCurrency,
          period: "monthly",
          rolloverMode: "reset",
        })
      }
    }
  }, [open, budget, defaultCurrency, form])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit Budget" : "New Budget"}</DialogTitle>
          <DialogDescription>
            {isEditing ? "Update budget details." : "Set a spending limit for a category or all expenses."}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. Monthly groceries" {...field} />
                  </FormControl>
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
                    onValueChange={(v) => field.onChange(v === "__all__" ? null : v)}
                    value={field.value ?? "__all__"}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="__all__">All expenses (overall budget)</SelectItem>
                      {categories
                        .filter((c) => c.group !== "income")
                        .map((cat) => (
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
                name="amount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Limit</FormLabel>
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
                name="period"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Period</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="monthly">Monthly</SelectItem>
                        <SelectItem value="yearly">Yearly</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="rolloverMode"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Rollover</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value ?? "reset"}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="reset">Reset each period</SelectItem>
                      <SelectItem value="surplus">Carry surplus forward</SelectItem>
                      <SelectItem value="deficit">Carry deficit forward</SelectItem>
                      <SelectItem value="full">Full rollover</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? "Saving..." : isEditing ? "Save Changes" : "Create Budget"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
