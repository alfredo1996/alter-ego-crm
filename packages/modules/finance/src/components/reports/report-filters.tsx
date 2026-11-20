"use client"


import { Button } from "@alter-ego/ui/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@alter-ego/ui/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@alter-ego/ui/ui/popover"
import { cn } from "@alter-ego/ui/utils"
import { Check, ChevronDown, Minus } from "lucide-react"
import { useMemo, useState } from "react"

import { CategoryChip } from "../categories/category-chip"

import type { ReportFilters } from "../../hooks/use-reports"
import type { Account, Category, CategoryGroup } from "../../types"

// ─── Group colors for visual distinction ─────────────────────────────────────

const GROUP_COLORS: Record<CategoryGroup, string> = {
  income: "bg-emerald-500",
  housing: "bg-blue-500",
  transportation: "bg-sky-500",
  food: "bg-amber-500",
  utilities: "bg-slate-500",
  healthcare: "bg-rose-500",
  personal: "bg-purple-500",
  entertainment: "bg-pink-500",
  education: "bg-indigo-500",
  savings: "bg-teal-500",
  debt: "bg-red-500",
  other: "bg-gray-500",
}

function titleCase(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/**
 * A trigger that reads like FilterSelect's: "Accounts: All", "Accounts: Main Checking", "Categories: 3 of 12".
 * A combobox named by its label, with a dark border while a filter is set.
 */
const TRIGGER = "h-11 w-full justify-between gap-2 px-3.5 text-sm font-normal sm:w-auto sm:max-w-64"

function FilterTrigger({ label, value, active }: { label: string; value: string; active: boolean }) {
  return (
    <PopoverTrigger asChild>
      <Button type="button" variant="outline" role="combobox" aria-label={label} className={cn(TRIGGER, active && "border-foreground")}>
        <span className="truncate">
          <span className="text-muted-foreground">{label}:</span> {value}
        </span>
        <ChevronDown aria-hidden className="size-4 shrink-0 opacity-50" />
      </Button>
    </PopoverTrigger>
  )
}

// ─── Flat MultiSelect (used for Accounts) ────────────────────────────────────

interface MultiSelectProps {
  label: string
  options: { value: string; label: string; prefix?: string }[]
  selected: string[]
  onToggle: (value: string) => void
  onClear: () => void
}

function MultiSelect({ label, options, selected, onToggle, onClear }: MultiSelectProps) {
  const [open, setOpen] = useState(false)
  const hasSelection = selected.length > 0
  const value = !hasSelection
    ? "All"
    : selected.length === 1
      ? (options.find((o) => o.value === selected[0])?.label ?? "1 selected")
      : `${selected.length} selected`

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <FilterTrigger label={label} value={value} active={hasSelection} />
      <PopoverContent className="w-56 p-0" align="start">
        <Command>
          <CommandInput placeholder={`Search ${label.toLowerCase()}...`} />
          {hasSelection && (
            <div className="flex items-center justify-between border-b px-3 py-1.5">
              <button
                type="button"
                className="text-xs font-medium text-primary hover:underline pointer-coarse:min-h-11"
                onClick={onClear}
              >
                Clear selection
              </button>
            </div>
          )}
          <CommandList>
            <CommandEmpty>No results.</CommandEmpty>
            <CommandGroup>
              {options.map((opt) => (
                <CommandItem
                  key={opt.value}
                  value={opt.value}
                  onSelect={() => onToggle(opt.value)}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      selected.includes(opt.value) ? "opacity-100" : "opacity-0"
                    )}
                  />
                  {opt.prefix && <span className="mr-1">{opt.prefix}</span>}
                  {opt.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

// ─── Grouped Category Select ─────────────────────────────────────────────────

interface CategoryGroupSelectProps {
  categories: Category[]
  selected: string[]
  onToggle: (id: string) => void
  onToggleGroup: (group: CategoryGroup) => void
  onToggleAll: () => void
}

function CategoryGroupSelect({
  categories,
  selected,
  onToggle,
  onToggleGroup,
  onToggleAll,
}: CategoryGroupSelectProps) {
  const [open, setOpen] = useState(false)
  const hasSelection = selected.length > 0

  // No explicit filter → backend returns all categories → treat as "all selected"
  const noFilter = selected.length === 0

  const grouped = useMemo(() => {
    const map = new Map<CategoryGroup, Category[]>()
    for (const cat of categories) {
      if (cat.group === "income") continue
      const list = map.get(cat.group) ?? []
      list.push(cat)
      map.set(cat.group, list)
    }
    return map
  }, [categories])

  const allNonIncomeIds = useMemo(
    () => categories.filter((c) => c.group !== "income").map((c) => c.id),
    [categories]
  )
  const spendingCount = allNonIncomeIds.length
  const categoriesValue = !hasSelection ? "All" : `${selected.length} of ${spendingCount}`
  const allSelected = noFilter || (allNonIncomeIds.length > 0 && allNonIncomeIds.every((id) => selected.includes(id)))

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <FilterTrigger label="Categories" value={categoriesValue} active={hasSelection} />
      <PopoverContent className="w-72 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search categories..." />
          <div className="flex items-center justify-between border-b px-3 py-1.5">
            <button
              type="button"
              className="text-xs font-medium text-primary hover:underline pointer-coarse:min-h-11"
              onClick={onToggleAll}
            >
              {allSelected ? "Deselect all" : "Select all"}
            </button>
          </div>
          <CommandList className="max-h-[300px]">
            <CommandEmpty>No results.</CommandEmpty>
            {Array.from(grouped.entries()).map(([group, cats]) => {
              const groupIds = cats.map((c) => c.id)
              const groupAllSelected = noFilter || groupIds.every((id) => selected.includes(id))
              const groupSomeSelected = !groupAllSelected && groupIds.some((id) => selected.includes(id))

              return (
                <CommandGroup
                  key={group}
                  heading={
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 py-0.5 text-xs font-semibold uppercase tracking-wide cursor-pointer hover:opacity-80"
                      onClick={() => onToggleGroup(group)}
                    >
                      <span className={cn("h-2 w-2 rounded-full shrink-0", GROUP_COLORS[group])} />
                      {titleCase(group)}
                      <span className="ml-auto">
                        {groupAllSelected ? (
                          <Check className="h-3 w-3 text-primary" />
                        ) : groupSomeSelected ? (
                          <Minus className="h-3 w-3 text-muted-foreground" />
                        ) : null}
                      </span>
                    </button>
                  }
                >
                  {cats.map((cat) => (
                    <CommandItem
                      key={cat.id}
                      value={`${cat.name} ${group}`}
                      onSelect={() => onToggle(cat.id)}
                      className="pl-6"
                    >
                      <Check
                        className={cn(
                          "mr-2 h-4 w-4",
                          (noFilter || selected.includes(cat.id)) ? "opacity-100" : "opacity-0"
                        )}
                      />
                      <CategoryChip category={cat} plain />
                    </CommandItem>
                  ))}
                </CommandGroup>
              )
            })}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

// ─── Filter Bar ──────────────────────────────────────────────────────────────

interface ReportFiltersBarProps {
  accounts: Account[]
  categories: Category[]
  filters: ReportFilters
  onChange: (filters: ReportFilters) => void
}

export function ReportFiltersBar({
  accounts,
  categories,
  filters,
  onChange,
}: ReportFiltersBarProps) {
  function toggleAccount(id: string) {
    const current = filters.accountIds ?? []
    const next = current.includes(id)
      ? current.filter((x) => x !== id)
      : [...current, id]
    onChange({ ...filters, accountIds: next.length ? next : undefined })
  }

  function toggleCategory(id: string) {
    const noFilter = !filters.categoryIds?.length
    if (noFilter) {
      // Transition from implicit "all" → explicit all minus this one
      const allIds = categories.filter((c) => c.group !== "income").map((c) => c.id)
      const next = allIds.filter((x) => x !== id)
      onChange({ ...filters, categoryIds: next.length ? next : undefined })
      return
    }
    const current = filters.categoryIds ?? []
    const next = current.includes(id)
      ? current.filter((x) => x !== id)
      : [...current, id]
    onChange({ ...filters, categoryIds: next.length ? next : undefined })
  }

  function toggleCategoryGroup(group: CategoryGroup) {
    const groupIds = categories
      .filter((c) => c.group === group)
      .map((c) => c.id)
    const noFilter = !filters.categoryIds?.length
    // When no filter is active, toggling a group means "deselect this group"
    // → explicitly set all IDs MINUS this group
    if (noFilter) {
      const allIds = categories.filter((c) => c.group !== "income").map((c) => c.id)
      const next = allIds.filter((id) => !groupIds.includes(id))
      onChange({ ...filters, categoryIds: next.length ? next : undefined })
      return
    }
    const current = filters.categoryIds ?? []
    const allGroupSelected = groupIds.every((id) => current.includes(id))
    const next = allGroupSelected
      ? current.filter((id) => !groupIds.includes(id))
      : [...new Set([...current, ...groupIds])]
    onChange({ ...filters, categoryIds: next.length ? next : undefined })
  }

  function toggleAllCategories() {
    const allIds = categories.filter((c) => c.group !== "income").map((c) => c.id)
    const current = filters.categoryIds ?? []
    const noFilter = current.length === 0
    const explicitlyAllSelected = allIds.length > 0 && allIds.every((id) => current.includes(id))

    if (noFilter) {
      // Transition from implicit "all" to explicit — enables individual deselects
      onChange({ ...filters, categoryIds: allIds })
    } else if (explicitlyAllSelected) {
      // Clear back to no filter (= all shown)
      onChange({ ...filters, categoryIds: undefined })
    } else {
      // Some selected → select all explicitly
      onChange({ ...filters, categoryIds: allIds })
    }
  }

  const hasAnyFilter = (filters.accountIds?.length ?? 0) + (filters.categoryIds?.length ?? 0) > 0

  const accountOptions = accounts.map((a) => ({ value: a.id, label: a.name }))

  return (
    <>
      <MultiSelect
        label="Accounts"
        options={accountOptions}
        selected={filters.accountIds ?? []}
        onToggle={toggleAccount}
        onClear={() => onChange({ ...filters, accountIds: undefined })}
      />
      <CategoryGroupSelect
        categories={categories}
        selected={filters.categoryIds ?? []}
        onToggle={toggleCategory}
        onToggleGroup={toggleCategoryGroup}
        onToggleAll={toggleAllCategories}
      />
      {hasAnyFilter && (
        <Button type="button" variant="ghost" className="h-11 text-sm text-muted-foreground" onClick={() => onChange({})}>
          Clear all
        </Button>
      )}
    </>
  )
}
