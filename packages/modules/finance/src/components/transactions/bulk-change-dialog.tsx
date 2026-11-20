"use client"


import { Button } from "@alter-ego/ui/ui/button"
import { Calendar } from "@alter-ego/ui/ui/calendar"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@alter-ego/ui/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@alter-ego/ui/ui/select"
import { useState } from "react"

import type { Account } from "../../types"

interface BulkChangeDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: "account" | "date"
  accounts: Account[]
  count: number
  onConfirm: (value: string | Date) => void
  isPending: boolean
}

export function BulkChangeDialog({
  open,
  onOpenChange,
  mode,
  accounts,
  count,
  onConfirm,
  isPending,
}: BulkChangeDialogProps) {
  const [selectedAccountId, setSelectedAccountId] = useState("")
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined)

  function handleConfirm() {
    if (mode === "account" && selectedAccountId) {
      onConfirm(selectedAccountId)
    } else if (mode === "date" && selectedDate) {
      onConfirm(selectedDate)
    }
  }

  const isValid = mode === "account" ? !!selectedAccountId : !!selectedDate

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {mode === "account" ? "Change Account" : "Change Date"}
          </DialogTitle>
          <DialogDescription>
            Apply to {count} selected transaction{count > 1 ? "s" : ""}.
          </DialogDescription>
        </DialogHeader>

        {mode === "account" ? (
          <Select value={selectedAccountId} onValueChange={setSelectedAccountId}>
            <SelectTrigger>
              <SelectValue placeholder="Select account..." />
            </SelectTrigger>
            <SelectContent>
              {accounts.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <div className="flex justify-center">
            <Calendar
              mode="single"
              selected={selectedDate}
              onSelect={setSelectedDate}
            />
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!isValid || isPending} onClick={handleConfirm}>
            {isPending ? "Applying..." : "Apply"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
