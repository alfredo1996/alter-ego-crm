"use client"

import { EmptyPrompt } from "@alter-ego/ui/page/empty-prompt"
import { TagChip } from "@alter-ego/ui/page/status-pill"
import { Button } from "@alter-ego/ui/ui/button"
import { Input } from "@alter-ego/ui/ui/input"
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@alter-ego/ui/ui/select"
import { Switch } from "@alter-ego/ui/ui/switch"
import { useToast } from "@alter-ego/ui/use-toast"
import { ArrowRight, Plus, RefreshCw, Trash2 } from "lucide-react"
import { useState } from "react"

import { useCategories } from "../../hooks/use-categories"
import { ConfirmDeleteDialog } from "../confirm-delete-dialog"
import { SettingsRow } from "./settings-section"
import {
  useCategorizationRules,
  useCreateCategorizationRule,
  useUpdateCategorizationRule,
  useDeleteCategorizationRule,
} from "../../hooks/use-categorization-rules"
import { useMerchantNormalization } from "../../hooks/use-merchant-normalization"
import { CategoryChip } from "../categories/category-chip"



interface CategorizationRulesSectionProps {
  userId: string | undefined
  /** How many transactions Re-normalize would visit, in its sentence. */
  /** Undefined while the count loads. */
  transactionCount?: number
}

export function CategorizationRulesSection({ userId, transactionCount }: CategorizationRulesSectionProps) {
  const { data: rules, isLoading: rulesLoading } = useCategorizationRules(userId)
  const { data: categories, isLoading: categoriesLoading } = useCategories(userId)
  const createRule = useCreateCategorizationRule(userId)
  const updateRule = useUpdateCategorizationRule(userId)
  const deleteRule = useDeleteCategorizationRule(userId)
  const { renormalize } = useMerchantNormalization(userId)
  const { toast } = useToast()

  const [pattern, setPattern] = useState("")
  const [categoryId, setCategoryId] = useState("")
  const [displayAs, setDisplayAs] = useState("")
  // One tap on the trash deleted the rule outright; it asks first now.
  const [deleting, setDeleting] = useState<{ id: string; pattern: string } | null>(null)

  async function handleAdd() {
    const trimmedPattern = pattern.trim()
    if (!trimmedPattern || !categoryId) return
    try {
      await createRule.mutateAsync({
        pattern: trimmedPattern,
        categoryId,
        displayAs: displayAs.trim() || undefined,
      })
      setPattern("")
      setCategoryId("")
      setDisplayAs("")
    } catch (err) {
      toast({
        title: "Failed to create rule",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      })
    }
  }

  async function handleToggleActive(ruleId: string, currentValue: boolean) {
    try {
      await updateRule.mutateAsync({ id: ruleId, input: { isActive: !currentValue } })
    } catch (err) {
      toast({
        title: "Failed to update rule",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      })
    }
  }

  async function handleDelete(ruleId: string) {
    try {
      await deleteRule.mutateAsync(ruleId)
      setDeleting(null)
    } catch (err) {
      toast({
        title: "Failed to delete rule",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      })
    }
  }

  const categoryOf = (catId: string) => categories?.find((c) => c.id === catId)

  if (categoriesLoading) {
    return <p className="py-4 text-sm text-muted-foreground">Loading...</p>
  }

  return (
    <SettingsRow label="Auto-categorization Rules" heading stacked hint="When a description contains the pattern, the transaction gets that category.">
      {rulesLoading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : rules && rules.length > 0 ? (
        <ul className="flex flex-col divide-y divide-hairline rounded-xl border border-hairline">
          {rules.map((rule) => (
            // A phone gives the pattern its own line, then the category and the controls.
            <li key={rule.id} className="flex min-h-[52px] flex-wrap items-center gap-x-3 gap-y-1 py-1 pr-1 pl-3.5 sm:flex-nowrap">
              <TagChip className="min-w-0 max-w-full shrink">
                <span className="truncate">{rule.pattern}</span>
              </TagChip>
              <ArrowRight aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 text-sm">
                <CategoryChip plain category={categoryOf(rule.categoryId) ?? { name: rule.categoryId, color: "#a3a3a3" }} />
                {rule.displayAs && <span className="text-[13px] text-muted-foreground">· shown as {rule.displayAs}</span>}
              </span>
              <div className="ml-auto flex shrink-0 items-center gap-1">
                <Switch
                  checked={rule.isActive}
                  onCheckedChange={() => handleToggleActive(rule.id, rule.isActive)}
                  disabled={updateRule.isPending}
                  aria-label={`Toggle rule for ${rule.pattern}`}
                />
                <button
                  type="button"
                  onClick={() => setDeleting(rule)}
                  disabled={deleteRule.isPending}
                  className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                  aria-label={`Delete rule for ${rule.pattern}`}
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyPrompt variant="inline" title="No rules yet." />
      )}

      {/* The add form: the pattern and the category are siblings. On a phone the pattern gets the
          full width (beside the category and Add it was 56 px), with the category under it. */}
      <div className="flex flex-col gap-2 rounded-xl bg-surface-subtle p-3.5">
        <span className="text-[13px] font-medium text-subtle-foreground">New rule</span>
        <div className="flex flex-wrap gap-2">
          <Input
            aria-label="Pattern"
            placeholder="Pattern (e.g. Netflix)"
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAdd()
            }}
            className="min-w-0 flex-[2_1_200px]"
          />
          <Select value={categoryId} onValueChange={setCategoryId}>
            <SelectTrigger aria-label="Rule category" className="min-w-0 flex-[1_1_160px]">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              {(categories ?? []).map((cat) => (
                <SelectItem key={cat.id} value={cat.id}>
                  {cat.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex gap-2">
          <Input
            aria-label="Display as"
            placeholder="Display as (optional, e.g. Amazon)"
            value={displayAs}
            onChange={(e) => setDisplayAs(e.target.value)}
            className="min-w-0 flex-1"
          />
          <Button type="button" onClick={handleAdd} disabled={!pattern.trim() || !categoryId || createRule.isPending}>
            <Plus />
            {createRule.isPending ? "Adding..." : "Add Rule"}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2.5">
        <span className="text-[13px] text-muted-foreground">
          Rules apply to new transactions. Run them on the {transactionCount === undefined ? "transactions" : transactionCount} you already have:
        </span>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            renormalize.mutate(undefined, {
              onSuccess: (count) => {
                toast({
                  title: "Re-normalization complete",
                  description: `Updated ${count} transaction${count !== 1 ? "s" : ""}.`,
                })
              },
              onError: (err) => {
                toast({
                  title: "Re-normalization failed",
                  description: err instanceof Error ? err.message : "Unknown error",
                  variant: "destructive",
                })
              },
            })
          }}
          disabled={renormalize.isPending}
        >
          <RefreshCw className={renormalize.isPending ? "animate-spin" : ""} />
          {renormalize.isPending ? "Re-normalizing..." : "Re-normalize All Transactions"}
        </Button>
      </div>

      <ConfirmDeleteDialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete Rule"
        description={`Delete the rule for \u201c${deleting?.pattern}\u201d? This cannot be undone.`}
        onConfirm={() => deleting && handleDelete(deleting.id)}
        isPending={deleteRule.isPending}
      />
    </SettingsRow>
  )
}
