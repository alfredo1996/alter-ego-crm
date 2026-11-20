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
import { Input } from "@alter-ego/ui/ui/input"
import { Label } from "@alter-ego/ui/ui/label"
import { useState } from "react"

import type { SavingsGoalWithProgress, Currency } from "../../types"

interface AddFundsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  goal: SavingsGoalWithProgress | null
  format: (amount: number, currency?: Currency) => string
  onConfirm: (goalId: string, newAmount: number, isCompleted: boolean) => void
  isPending: boolean
}

export function AddFundsDialog({
  open,
  onOpenChange,
  goal,
  format,
  onConfirm,
  isPending,
}: AddFundsDialogProps) {
  const [amount, setAmount] = useState("")

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!goal) return
    const value = parseFloat(amount)
    if (!value || value <= 0) return
    const newTotal = goal.currentAmount + value
    const isCompleted = newTotal >= goal.targetAmount
    onConfirm(goal.id, newTotal, isCompleted)
    setAmount("")
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) setAmount("") }}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Add Funds</DialogTitle>
          <DialogDescription>
            {goal
              ? `Add to "${goal.name}". Current: ${format(goal.currentAmount, goal.currency)} / ${format(goal.targetAmount, goal.currency)}`
              : "Add funds to this goal."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="add-funds-amount">Amount</Label>
            <Input
              id="add-funds-amount"
              type="number"
              step="0.01"
              min="0.01"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending || !amount || parseFloat(amount) <= 0}>
              {isPending ? "Saving..." : "Add Funds"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
