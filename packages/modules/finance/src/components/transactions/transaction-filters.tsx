"use client"


import { FiltersSheet } from "@alter-ego/ui/filters-sheet"
import { FilterBar, FilterSelect } from "@alter-ego/ui/page/filter-bar"
import { Button } from "@alter-ego/ui/ui/button"
import { DateRangePicker } from "@alter-ego/ui/ui/date-range-picker"
import { Input } from "@alter-ego/ui/ui/input"
import { Label } from "@alter-ego/ui/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@alter-ego/ui/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@alter-ego/ui/ui/select"
import { cn } from "@alter-ego/ui/utils"
import { ChevronDown, X } from "lucide-react"

import type { Account, Category, Tag, TransactionFilters, TransactionStatus } from "../../types"

/** The Category filter's first option: the URL's `uncategorized=true`, beside `categoryId=`. */
export const UNCATEGORIZED = "__uncategorized__"

export function categoryFilterValue(filters: TransactionFilters): string | null {
  return filters.uncategorized ? UNCATEGORIZED : (filters.categoryId ?? null)
}

export function withCategoryFilter(filters: TransactionFilters, value: string | null): TransactionFilters {
  return {
    ...filters,
    categoryId: value && value !== UNCATEGORIZED ? value : undefined,
    uncategorized: value === UNCATEGORIZED ? true : undefined,
  }
}

/** What the phone's "Filters (n)" counts: the sheet's controls, not the search box or the type tabs. */
export function countFilters(filters: TransactionFilters): number {
  return (
    [
      filters.accountId,
      categoryFilterValue(filters),
      filters.dateFrom || filters.dateTo,
      filters.status,
      filters.hasNote,
      filters.tagIds?.length,
      filters.minAmount !== undefined,
      filters.maxAmount !== undefined,
    ].filter(Boolean).length
  )
}

/**
 * False when a filter the backend applies in memory is set (search, amounts, tags, note, status,
 * uncategorized): a count read would then fetch every match, so the tabs go without numbers.
 */
export function countsAreCheap(f: TransactionFilters): boolean {
  return !(
    f.search ||
    f.minAmount !== undefined ||
    f.maxAmount !== undefined ||
    f.tagIds?.length ||
    f.hasNote ||
    f.status ||
    f.uncategorized
  )
}

/** "Uncategorized" first (no category); the default category of that name would read the same and mean another. */
export function categoryOptions(categories: Category[]): { value: string; label: string }[] {
  return [
    { value: UNCATEGORIZED, label: "Uncategorized" },
    ...categories
      .filter((c) => c.name !== "Uncategorized")
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((c) => ({ value: c.id, label: c.name })),
  ]
}

interface TransactionFiltersBarProps {
  filters: TransactionFilters
  onFiltersChange: (filters: TransactionFilters) => void
  accounts: Account[]
  categories: Category[]
  tags?: Tag[]
}

const triggerClass = "h-11 gap-2 rounded-[10px] px-3.5 font-normal"

export function TransactionFiltersBar({
  filters,
  onFiltersChange,
  accounts,
  categories,
  tags = [],
}: TransactionFiltersBarProps) {
  const set = (patch: Partial<TransactionFilters>) => onFiltersChange({ ...filters, ...patch })
  const hasDates = !!(filters.dateFrom || filters.dateTo)
  const moreCount = [filters.status, filters.hasNote, filters.minAmount !== undefined, filters.maxAmount !== undefined].filter(Boolean).length
  const tagCount = filters.tagIds?.length ?? 0

  const dates = (
    <DateRangePicker
      value={hasDates ? { from: filters.dateFrom, to: filters.dateTo } : undefined}
      onChange={(range) =>
        set({
          dateFrom: range?.from,
          dateTo: range?.to
            ? new Date(range.to.getFullYear(), range.to.getMonth(), range.to.getDate(), 23, 59, 59)
            : undefined,
        })
      }
      placeholder="Dates"
      className={cn(triggerClass, "sm:w-auto", hasDates && "border-foreground")}
    />
  )
  const account = (
    <FilterSelect
      label="Account"
      allLabel="All accounts"
      value={filters.accountId ?? null}
      options={accounts.map((a) => ({ value: a.id, label: a.name }))}
      onValueChange={(accountId) => set({ accountId: accountId ?? undefined })}
    />
  )
  const category = (
    <FilterSelect
      label="Category"
      allLabel="All categories"
      value={categoryFilterValue(filters)}
      options={categoryOptions([...categories])}
      onValueChange={(value) => onFiltersChange(withCategoryFilter(filters, value))}
    />
  )
  const tagPicker = tags.length > 0 && (
    <div className="flex flex-wrap gap-1.5">
      {tags.map((tag) => {
        const selected = filters.tagIds?.includes(tag.id) ?? false
        return (
          <button
            key={tag.id}
            type="button"
            aria-pressed={selected}
            onClick={() => {
              const current = filters.tagIds ?? []
              const next = selected ? current.filter((id) => id !== tag.id) : [...current, tag.id]
              set({ tagIds: next.length ? next : undefined })
            }}
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors motion-reduce:transition-none pointer-coarse:min-h-11",
              selected ? "ring-2 ring-primary ring-offset-1" : "opacity-60 hover:opacity-100",
            )}
            style={{ backgroundColor: tag.color + "20", color: tag.color }}
          >
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: tag.color }} />
            {tag.name}
          </button>
        )
      })}
      {tagCount > 0 && (
        <button
          type="button"
          onClick={() => set({ tagIds: undefined })}
          className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground pointer-coarse:min-h-11"
        >
          <X aria-hidden className="h-3 w-3" />
          Clear
        </button>
      )}
    </div>
  )
  const moreFields = (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="tx-status" className="text-xs text-muted-foreground">Status</Label>
        <Select
          value={filters.status ?? "all"}
          onValueChange={(value) => set({ status: value === "all" ? undefined : (value as TransactionStatus) })}
        >
          <SelectTrigger id="tx-status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="cleared">Cleared</SelectItem>
            <SelectItem value="reconciled">Reconciled</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {(["minAmount", "maxAmount"] as const).map((key) => (
          <div key={key} className="flex flex-col gap-1.5">
            <Label htmlFor={`tx-${key}`} className="text-xs text-muted-foreground">
              {key === "minAmount" ? "Min amount" : "Max amount"}
            </Label>
            <Input
              id={`tx-${key}`}
              type="number"
              step="0.01"
              min="0"
              placeholder={key === "minAmount" ? "0.00" : "Any"}
              value={filters[key] ?? ""}
              onChange={(e) => set({ [key]: e.target.value ? parseFloat(e.target.value) : undefined })}
            />
          </div>
        ))}
      </div>
      <label className="flex cursor-pointer items-center gap-2 text-sm pointer-coarse:min-h-11">
        <input
          type="checkbox"
          checked={!!filters.hasNote}
          onChange={(e) => set({ hasNote: e.target.checked || undefined })}
          className="h-4 w-4 rounded border"
        />
        Has note
      </label>
    </div>
  )

  const popover = (label: string, count: number, body: React.ReactNode, width = "w-80") => (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" className={cn(triggerClass, count > 0 && "border-foreground")}>
          {label}
          {count > 0 && <span className="tabular-nums text-muted-foreground">{count}</span>}
          <ChevronDown aria-hidden className="text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className={width}>
        {body}
      </PopoverContent>
    </Popover>
  )

  return (
    <FilterBar
      search={{
        label: "Search transactions",
        placeholder: "Search transactions...",
        value: filters.search ?? "",
        onChange: (value) => set({ search: value || undefined }),
      }}
    >
      {/* CSS picks the layout, as FilterBar's own sheet does: nothing flashes on hydration. */}
      <div className="hidden sm:contents">
        {dates}
        {account}
        {category}
        {tagPicker && popover("Tags", tagCount, tagPicker)}
        {popover("More Filters", moreCount, moreFields, "w-72")}
      </div>
      <FiltersSheet active={countFilters(filters)} className="h-11 sm:hidden">
        {account}
        {category}
        {dates}
        {tagPicker && (
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">Tags</Label>
            {tagPicker}
          </div>
        )}
        {moreFields}
      </FiltersSheet>
    </FilterBar>
  )
}
