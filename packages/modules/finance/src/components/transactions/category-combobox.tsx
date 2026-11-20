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
import { defaultFilter } from "cmdk"
import { Check, ChevronsUpDown } from "lucide-react"
import { useState } from "react"

import { CategoryChip } from "../categories/category-chip"

import type { Category } from "../../types"

// Items are valued by id (two categories can share a name), so search scores the keywords only.
const byKeywords = (_value: string, search: string, keywords?: string[]) => defaultFilter("", search, keywords)

interface CategoryComboboxProps {
  categories: Category[]
  value?: string
  onChange: (categoryId: string | undefined) => void
  className?: string
}

export function CategoryCombobox({
  categories,
  value,
  onChange,
  className,
}: CategoryComboboxProps) {
  const [open, setOpen] = useState(false)

  const selected = categories.find((c) => c.id === value)

  // Group categories by group name
  const groups = new Map<string, Category[]>()
  for (const cat of categories) {
    const group = cat.group ?? "Other"
    if (!groups.has(group)) groups.set(group, [])
    groups.get(group)!.push(cat)
  }

  return (
    // modal: in a Dialog (its usual home), the dialog's scroll lock otherwise swallows
    // the list's wheel and touch scroll, leaving the later options out of reach.
    <Popover modal open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn("w-full justify-between font-normal", className)}
        >
          {selected ? (
            <CategoryChip category={selected} plain />
          ) : (
            <span className="text-muted-foreground">Select category...</span>
          )}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="p-0"
        style={{ width: "var(--radix-popover-trigger-width)" }}
      >
        <Command filter={byKeywords}>
          <CommandInput placeholder="Search categories..." />
          <CommandList>
            <CommandEmpty>No category found.</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value="__none__"
                keywords={["None"]}
                onSelect={() => {
                  onChange(undefined)
                  setOpen(false)
                }}
              >
                <Check
                  className={cn(
                    "mr-2 h-4 w-4",
                    !value ? "opacity-100" : "opacity-0"
                  )}
                />
                None
              </CommandItem>
            </CommandGroup>
            {Array.from(groups.entries()).map(([group, cats]) => (
              <CommandGroup key={group} heading={group.charAt(0).toUpperCase() + group.slice(1)}>
                {cats.map((cat) => (
                  <CommandItem
                    key={cat.id}
                    value={cat.id}
                    keywords={[cat.name]}
                    onSelect={() => {
                      onChange(cat.id === value ? undefined : cat.id)
                      setOpen(false)
                    }}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        value === cat.id ? "opacity-100" : "opacity-0"
                      )}
                    />
                    <CategoryChip category={cat} plain />
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
