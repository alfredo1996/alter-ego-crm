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
import { cn } from "@alter-ego/ui/utils"
import { zodResolver } from "@hookform/resolvers/zod"
import { useEffect } from "react"
import { useForm } from "react-hook-form"
import { type z } from "zod"

import { createSavingsGoalSchema } from "../../schemas"

import type { SavingsGoalWithProgress, Currency } from "../../types"

type GoalFormValues = z.infer<typeof createSavingsGoalSchema>

const CURRENCIES: Currency[] = ["USD", "EUR", "GBP", "JPY", "CAD", "AUD", "CHF", "MXN", "BRL", "ARS"]
const COLOR_PRESETS = ["#6366f1", "#10b981", "#f59e0b", "#ef4444", "#3b82f6", "#8b5cf6"]

interface SavingsGoalFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  goal?: SavingsGoalWithProgress | null
  defaultCurrency: Currency
  onSubmit: (values: GoalFormValues) => void
  isPending: boolean
}

export function SavingsGoalFormDialog({
  open,
  onOpenChange,
  goal,
  defaultCurrency,
  onSubmit,
  isPending,
}: SavingsGoalFormDialogProps) {
  const isEditing = !!goal
  const form = useForm<GoalFormValues>({
    resolver: zodResolver(createSavingsGoalSchema),
    defaultValues: {
      name: "",
      targetAmount: 0,
      currency: defaultCurrency,
      targetDate: null,
      icon: "🎯",
      color: "#6366f1",
    },
  })

  useEffect(() => {
    if (open) {
      if (goal) {
        form.reset({
          name: goal.name,
          targetAmount: goal.targetAmount,
          currency: goal.currency,
          targetDate: goal.targetDate,
          icon: goal.icon,
          color: goal.color,
        })
      } else {
        form.reset({
          name: "",
          targetAmount: 0,
          currency: defaultCurrency,
          targetDate: null,
          icon: "🎯",
          color: "#6366f1",
        })
      }
    }
  }, [open, goal, defaultCurrency, form])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit Goal" : "New Savings Goal"}</DialogTitle>
          <DialogDescription>
            {isEditing ? "Update goal details." : "Set a savings target to work toward."}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Goal name</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. Emergency fund" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="targetAmount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Target amount</FormLabel>
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
                name="currency"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Currency</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {CURRENCIES.map((c) => (
                          <SelectItem key={c} value={c}>{c}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="targetDate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Target date (optional)</FormLabel>
                  <FormControl>
                    <Input
                      type="date"
                      value={field.value ? isoDate(field.value) : ""}
                      onChange={(e) =>
                        field.onChange(e.target.value ? new Date(e.target.value + "T00:00:00") : null)
                      }
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="icon"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Icon</FormLabel>
                    <FormControl>
                      <Input placeholder="🎯" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="color"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Color</FormLabel>
                    <FormControl>
                      <div className="flex flex-wrap gap-2">
                        {COLOR_PRESETS.map((color) => (
                          <button
                            key={color}
                            type="button"
                            aria-label={`Select color ${color}`}
                            onClick={() => field.onChange(color)}
                            className={cn(
                              "h-7 w-7 rounded-full border-2 transition-transform pointer-coarse:size-11",
                              field.value === color ? "border-foreground scale-110" : "border-transparent"
                            )}
                            style={{ backgroundColor: color }}
                          />
                        ))}
                      </div>
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
                {isPending ? "Saving..." : isEditing ? "Save Changes" : "Create Goal"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
