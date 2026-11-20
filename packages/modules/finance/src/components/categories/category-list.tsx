"use client"


import { ContentCard } from "@alter-ego/ui/page/content-card"
import { StatusPill } from "@alter-ego/ui/page/status-pill"
import { Button } from "@alter-ego/ui/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@alter-ego/ui/ui/dropdown-menu"
import { cn } from "@alter-ego/ui/utils"
import { MoreHorizontal, Pencil, RotateCcw, Trash2 } from "lucide-react"
import Link from "next/link"
import { Fragment, useRef } from "react"

import type { CategoryGroupView } from "../../lib/category-groups"
import type { Category } from "../../types"

interface CategoryListProps {
  groups: CategoryGroupView[]
  /** categoryId to the month's spend; left out while it loads or if it failed: no amounts, no "Not used". */
  spend?: Map<string, number>
  /** Money out, as the page writes it: "−€950.00". */
  formatOut: (amount: number) => string
  onEdit: (category: Category) => void
  onDelete: (category: Category) => void
  onReset: (category: Category) => void
}

function CategoryRow({
  category,
  child = false,
  amount,
  formatOut,
  onEdit,
  onDelete,
  onReset,
}: {
  category: Category
  child?: boolean
  amount: number | undefined
  formatOut: (amount: number) => string
  onEdit: (category: Category) => void
  onDelete: (category: Category) => void
  onReset: (category: Category) => void
}) {
  const choseItem = useRef(false)
  return (
    <li
      className={cn(
        "grid min-h-10 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-2.5 border-t border-hairline pr-2.5 pl-5",
        child && "pl-10",
      )}
    >
      <Link
        href={`/transactions?categoryId=${category.id}`}
        className={cn(
          "flex min-h-11 min-w-0 items-center gap-2.5 rounded-sm py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          child ? "text-[13.5px] text-subtle-foreground" : "text-sm max-sm:text-[15px]",
        )}
      >
        <span
          aria-hidden
          className={cn("shrink-0 rounded-full", child ? "size-[7px]" : "size-2")}
          style={{ backgroundColor: category.color }}
        />
        <span className="truncate">{category.name}</span>
      </Link>
      <span className="flex items-center gap-2.5">
        {!category.isDefault && <StatusPill>Yours</StatusPill>}
        {amount ? <span className="text-sm font-medium whitespace-nowrap tabular-nums">{formatOut(amount)}</span> : null}
      </span>
      {/* A built-in is edited as the user's own copy (same id); Reset to Default drops the copy. Only own categories are deleted. */}
      <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={`Actions for ${category.name}`} className="size-8">
              <MoreHorizontal aria-hidden className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          {/* Focus goes back to the trigger on Escape; when an item opened a dialog, the dialog owns it. */}
          <DropdownMenuContent
            align="end"
            onCloseAutoFocus={(e) => {
              if (choseItem.current) e.preventDefault()
              choseItem.current = false
            }}
          >
            <DropdownMenuItem
              onClick={() => {
                choseItem.current = true
                onEdit(category)
              }}
            >
              <Pencil className="mr-2 h-4 w-4" />
              Edit
            </DropdownMenuItem>
            {category.isDefault ? (
              category.userId !== null && (
                // Not through choseItem: Reset opens no dialog, focus returns to the trigger.
                <DropdownMenuItem onClick={() => onReset(category)}>
                  <RotateCcw className="mr-2 h-4 w-4" />
                  Reset to Default
                </DropdownMenuItem>
              )
            ) : (
              <DropdownMenuItem
                onClick={() => {
                  choseItem.current = true
                  onDelete(category)
                }}
                variant="destructive"
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
      </DropdownMenu>
    </li>
  )
}

/** One card per group: its name, the month's spend, then its categories with their children indented. */
export function CategoryList({ groups, spend, formatOut, onEdit, onDelete, onReset }: CategoryListProps) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,300px),1fr))] gap-3 sm:gap-5">
      {groups.map(({ group, label, roots, count, total }) => {
        const id = `category-group-${group}`
        return (
          <ContentCard key={group} as="section" labelledBy={id} padding="none" className="flex flex-col overflow-hidden">
            <div className="flex flex-col gap-1 px-5 pt-[18px] pb-3.5">
              <div className="flex items-baseline justify-between gap-3">
                <h2 id={id} className="text-[17px] font-semibold tracking-tight">
                  {label}
                </h2>
                {total > 0 && <span className="text-[15px] font-semibold whitespace-nowrap tabular-nums">{formatOut(total)}</span>}
              </div>
              <div className="flex flex-wrap justify-between gap-x-3 gap-y-1 text-[13px] text-subtle-foreground">
                <span>
                  {count} {count === 1 ? "category" : "categories"}
                </span>
                {/* The spend counts expenses only: an income group has nothing to say here. */}
                {spend && group !== "income" && total === 0 && <span>Not used this month</span>}
              </div>
            </div>
            <ul className="pb-1.5">
              {roots.map(({ category, children }) => (
                <Fragment key={category.id}>
                  <CategoryRow category={category} amount={spend?.get(category.id)} formatOut={formatOut} onEdit={onEdit} onDelete={onDelete} onReset={onReset} />
                  {children.map((child) => (
                    <CategoryRow key={child.id} category={child} child amount={spend?.get(child.id)} formatOut={formatOut} onEdit={onEdit} onDelete={onDelete} onReset={onReset} />
                  ))}
                </Fragment>
              ))}
            </ul>
          </ContentCard>
        )
      })}
    </div>
  )
}
