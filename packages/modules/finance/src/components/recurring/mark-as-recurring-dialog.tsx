"use client"

import { isoDate } from "@alter-ego/kernel/dates"
import { Badge } from "@alter-ego/ui/ui/badge"
import { Button } from "@alter-ego/ui/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@alter-ego/ui/ui/dialog"
import { Input } from "@alter-ego/ui/ui/input"
import { Label } from "@alter-ego/ui/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@alter-ego/ui/ui/select"
import { useState } from "react"

import { useAccounts } from "../../hooks/use-accounts"
import { useCategories } from "../../hooks/use-categories"
import { useCurrency } from "../../hooks/use-currency"
import { useCreateRecurring } from "../../hooks/use-recurring"
import { useAuth } from "../../host"
import { CategoryChip } from "../categories/category-chip"

import type { RecurringFrequency, SuspectedSubscription } from "../../types"

interface MarkAsRecurringDialogProps {
  subscription: SuspectedSubscription | null
  onClose: () => void
}

export function MarkAsRecurringDialog({ subscription, onClose }: MarkAsRecurringDialogProps) {
  const { user } = useAuth()
  const { defaultCurrency } = useCurrency()
  const { data: accounts = [] } = useAccounts(user?.id)
  const { data: categories = [] } = useCategories(user?.id)
  const createRecurring = useCreateRecurring(user?.id)

  const [accountId, setAccountId] = useState(subscription?.accountId ?? "")
  const [amount, setAmount] = useState(subscription?.estimatedAmount.toFixed(2) ?? "")
  const [categoryId, setCategoryId] = useState(subscription?.suggestedCategoryId ?? "")
  const [frequency, setFrequency] = useState<RecurringFrequency>(
    subscription?.cadence ?? "monthly",
  )
  const [startDate, setStartDate] = useState(
    subscription?.suggestedStartDate
      ? isoDate(subscription.suggestedStartDate)
      : isoDate(new Date()),
  )

  // Reset when subscription changes
  const key = subscription?.id ?? "none"

  function handleSubmit() {
    if (!user || !subscription || !accountId) return
    const parsedAmount = parseFloat(amount)
    if (isNaN(parsedAmount) || parsedAmount <= 0) return

    createRecurring.mutate(
      {
        accountId,
        type: "expense",
        amount: parsedAmount,
        currency: subscription.currency ?? defaultCurrency,
        description: subscription.merchantName,
        categoryId: categoryId || null,
        frequency,
        interval: 1,
        startDate: new Date(startDate + "T12:00:00"),
      },
      { onSuccess: onClose },
    )
  }

  const expenseCategories = categories.filter(
    (c) => c.group !== "income" && c.group !== "savings",
  )

  return (
    <Dialog open={!!subscription} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-sm" key={key}>
        <DialogHeader>
          <DialogTitle>Mark as recurring</DialogTitle>
          <DialogDescription>
            {subscription?.merchantName} · detected{" "}
            <Badge variant="secondary">{subscription?.cadence}</Badge>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Account</Label>
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger>
                <SelectValue placeholder="Select account…" />
              </SelectTrigger>
              <SelectContent>
                {accounts
                  .filter((a) => !a.isArchived)
                  .map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Amount</Label>
              <Input
                type="number"
                step="0.01"
                min="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Frequency</Label>
              <Select value={frequency} onValueChange={(v) => setFrequency(v as RecurringFrequency)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="weekly">Weekly</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="yearly">Yearly</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Category</Label>
            {/* "none", not "": Radix Select throws on an item with an empty value. */}
            <Select value={categoryId || "none"} onValueChange={(v) => setCategoryId(v === "none" ? "" : v)}>
              <SelectTrigger>
                <SelectValue placeholder="No category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No category</SelectItem>
                {expenseCategories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    <CategoryChip category={c} plain />
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Next due date</Label>
            <Input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!accountId || createRecurring.isPending}
          >
            {createRecurring.isPending ? "Creating…" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
