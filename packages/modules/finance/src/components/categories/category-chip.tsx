import { cn } from "@alter-ego/ui/utils"

import type { Category } from "../../types"

interface CategoryChipProps {
  /** null or undefined reads "Uncategorized", in amber. */
  category: Pick<Category, "name" | "color"> | null | undefined
  /** Dot and name only, no chip background: for option lists and inline text. */
  plain?: boolean
  className?: string
}

/** A category as its colour dot and name. The icon field is a lucide name, never shown as text. */
export function CategoryChip({ category, plain = false, className }: CategoryChipProps) {
  return (
    <span
      className={cn(
        "inline-flex min-w-0 max-w-full items-center gap-1.5 whitespace-nowrap",
        !plain && "rounded-md px-2 py-0.5 text-[12.5px] leading-4",
        !plain && (category
          ? "bg-muted text-neutral-700 dark:text-neutral-300"
          : "bg-amber-100 font-medium text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"),
        className
      )}
    >
      {category ? (
        <span aria-hidden className="size-[7px] shrink-0 rounded-full" style={{ backgroundColor: category.color }} />
      ) : (
        <span aria-hidden className="size-2 shrink-0 rounded-full border-[1.5px] border-dashed border-amber-700 dark:border-amber-400" />
      )}
      <span className="truncate">{category?.name ?? "Uncategorized"}</span>
    </span>
  )
}
