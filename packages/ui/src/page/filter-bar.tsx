"use client"

import { Search } from "lucide-react"

import { FiltersSheet } from "../filters-sheet"
import { Input } from "../ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select"
import { cn } from "../utils"

import type { ReactNode } from "react"

interface FilterBarProps {
  search?: { value: string; onChange: (value: string) => void; label: string; placeholder?: string }
  /** The FilterSelects. */
  children?: ReactNode
  /** Fold the selects into the Filters sheet on a phone; `active` is the "Filters (n)" count. */
  sheet?: { active: number }
  className?: string
}

/** One row: a 44px search, then the dropdowns. */
export function FilterBar({ search, children, sheet, className }: FilterBarProps) {
  return (
    <div className={cn("flex flex-wrap items-center gap-2.5", className)}>
      {search && (
        <div className="relative min-w-0 flex-[1_1_220px]">
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            aria-label={search.label}
            placeholder={search.placeholder}
            value={search.value}
            onChange={(e) => search.onChange(e.target.value)}
            // An ellipsis, not a cut letter, where a phone's field is narrower than the placeholder.
            className="h-11 pl-10 text-base text-ellipsis"
          />
        </div>
      )}
      {sheet ? (
        <>
          {/* CSS picks the layout, as FiltersSheet's own callers do: nothing flashes on hydration. */}
          <div className="hidden sm:contents">{children}</div>
          <FiltersSheet active={sheet.active} className="h-11 sm:hidden">
            {children}
          </FiltersSheet>
        </>
      ) : (
        children
      )}
    </div>
  )
}

const ALL = "__all__"

interface FilterSelectProps {
  label: string
  /** null: no filter. */
  value: string | null
  options: { value: string; label: string }[]
  onValueChange: (value: string | null) => void
  /** The "no filter" option in the list: "All clients". The trigger then reads "Client: All". */
  allLabel: string
  /** What the trigger reads for no filter, where "All" is wrong ("Compare: None"). */
  noneLabel?: string
  className?: string
}

/**
 * A Select whose trigger reads "Client: All": still a combobox named by its label,
 * with option roles, so the tests' locators keep working.
 */
export function FilterSelect({ label, value, options, onValueChange, allLabel, noneLabel = "All", className }: FilterSelectProps) {
  // A value missing from the options (a stale deep link) still shows as set, so "All" can clear it:
  // mapped to ALL, picking All changed nothing and Radix never called back.
  const shown = value === null ? noneLabel : (options.find((o) => o.value === value)?.label ?? value)
  return (
    <Select value={value ?? ALL} onValueChange={(v) => onValueChange(v === ALL ? null : v)}>
      <SelectTrigger
        aria-label={label}
        className={cn("h-11 w-full gap-2 px-3.5 text-sm sm:w-auto sm:max-w-64", value !== null && "border-foreground", className)}
      >
        <SelectValue>
          <span className="text-muted-foreground">{label}:</span> {shown}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{allLabel}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
