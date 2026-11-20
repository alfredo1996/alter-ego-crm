"use client"


import { Button } from "@alter-ego/ui/ui/button"
import { Input } from "@alter-ego/ui/ui/input"
import { cn } from "@alter-ego/ui/utils"
import { Plus, Trash2 } from "lucide-react"

import { CategoryCombobox } from "./category-combobox"

import type { Category, TransactionSplit } from "../../types"

interface SplitEditorProps {
  splits: TransactionSplit[]
  totalAmount: number
  onChange: (splits: TransactionSplit[]) => void
  categories: Category[]
}

let splitIdCounter = 0
function nextSplitId(): string {
  return `split-${++splitIdCounter}-${Date.now()}`
}

export function SplitEditor({
  splits,
  totalAmount,
  onChange,
  categories,
}: SplitEditorProps) {
  const allocated = splits.reduce((sum, s) => sum + s.amount, 0)
  const remaining = totalAmount - allocated
  const isOver = remaining < -0.005
  const isExact = Math.abs(remaining) < 0.005

  function addSplit() {
    onChange([
      ...splits,
      {
        id: nextSplitId(),
        categoryId: "",
        amount: Math.max(0, parseFloat(remaining.toFixed(2))),
      },
    ])
  }

  function removeSplit(index: number) {
    onChange(splits.filter((_, i) => i !== index))
  }

  function updateSplit(index: number, updates: Partial<TransactionSplit>) {
    onChange(splits.map((s, i) => (i === index ? { ...s, ...updates } : s)))
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">Split breakdown</span>
        <span
          className={cn(
            "font-medium",
            isOver && "text-destructive",
            isExact && "text-income",
            !isOver && !isExact && "text-muted-foreground"
          )}
        >
          {isExact
            ? "Balanced"
            : isOver
              ? `Over by ${Math.abs(remaining).toFixed(2)}`
              : `${remaining.toFixed(2)} remaining`}
        </span>
      </div>

      {splits.map((split, index) => (
        <div key={split.id} className="flex items-start gap-2">
          <div className="flex-1">
            <CategoryCombobox
              categories={categories}
              value={split.categoryId || undefined}
              onChange={(id) => updateSplit(index, { categoryId: id ?? "" })}
            />
          </div>
          <Input
            type="number"
            step="0.01"
            min="0"
            className="w-28"
            value={split.amount || ""}
            placeholder="0.00"
            onChange={(e) =>
              updateSplit(index, { amount: e.target.valueAsNumber || 0 })
            }
          />
          <Input
            className="w-32"
            placeholder="Note..."
            value={split.note ?? ""}
            onChange={(e) =>
              updateSplit(index, { note: e.target.value || null })
            }
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-9 w-9 shrink-0 text-muted-foreground hover:text-destructive"
            onClick={() => removeSplit(index)}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={addSplit}
        disabled={isExact && splits.length > 0}
      >
        <Plus className="mr-1.5 h-3.5 w-3.5" />
        Add Split
      </Button>
    </div>
  )
}
