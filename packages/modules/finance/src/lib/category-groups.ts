import { CATEGORY_GROUPS } from "./options"

import type { Category, CategoryGroup } from "../types"

export type CategoryKind = "all" | "income" | "expenses"

export interface CategoryRoot {
  category: Category
  children: Category[]
}

export interface CategoryGroupView {
  group: CategoryGroup
  label: string
  roots: CategoryRoot[]
  /** Rows shown in the group, children included. */
  count: number
  /** The month's spend over the whole group, whatever a search hides; 0 for none. */
  total: number
}

interface Options {
  query?: string
  kind?: CategoryKind
  /** categoryId to the month's spend. */
  spend?: Map<string, number>
}

/** Income is its own group; every other group is an expense. */
export function kindCounts(categories: Category[]): Record<CategoryKind, number> {
  const income = categories.filter((c) => c.group === "income").length
  return { all: categories.length, income, expenses: categories.length - income }
}

/**
 * The Categories page's cards: groups in their own order, each category with its children.
 * A search keeps the rows whose name matches, with a matching parent's children and a matching
 * child's parent (a child alone would have no context).
 */
export function categoryGroups(categories: Category[], { query = "", kind = "all", spend }: Options): CategoryGroupView[] {
  const q = query.trim().toLowerCase()
  const hit = (c: Category) => c.name.toLowerCase().includes(q)

  return CATEGORY_GROUPS.filter((g) => kind === "all" || (kind === "income") === (g.value === "income"))
    .map(({ value, label }) => {
      const items = categories.filter((c) => c.group === value)
      const ids = new Set(items.map((c) => c.id))
      // A child whose parent is in another group (or gone) is a root of its own.
      const roots = items
        .filter((c) => !c.parentId || !ids.has(c.parentId))
        .map((category) => {
          const kids = items.filter((c) => c.parentId === category.id)
          const children = !q || hit(category) ? kids : kids.filter(hit)
          return { category, children }
        })
        .filter((r) => !q || hit(r.category) || r.children.length > 0)
      const rows = roots.flatMap((r) => [r.category, ...r.children])
      return {
        group: value,
        label,
        roots,
        count: rows.length,
        total: items.reduce((sum, c) => sum + (spend?.get(c.id) ?? 0), 0),
      }
    })
    .filter((g) => g.roots.length > 0)
}
