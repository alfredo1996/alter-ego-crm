"use client"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs"
import { cn } from "../utils"

import type { ReactNode } from "react"

interface StatusTabsProps {
  /** `controls`: the id of what the tab shows, for tabs with no panel (no children). */
  items: { value: string; label: string; count?: number; controls?: string }[]
  value: string
  onValueChange: (value: string) => void
  "aria-label": string
  /**
   * What the tabs filter: the tab panel the selected tab controls. Left out when the tabs only
   * pick what a phone shows (the task board's columns, side by side from sm up): no panel is
   * then left focusable, or named after a hidden tab, and each item's `controls` points at its own.
   */
  children?: ReactNode
  /** A FilterBar on the tabs' row from sm up, after them; above them on a phone. */
  toolbar?: ReactNode
  /** On the root: `sm:hidden` makes the tabs a phone's. */
  className?: string
}

/**
 * Filter pills with counts, on the shadcn Tabs: role tab, aria-selected and the arrow
 * keys for free. The count is part of the name ("Active 7"). The filtered list is the
 * children, in the one tab panel, so the selected tab's aria-controls points at it.
 * On a phone the row scrolls sideways under the page gutter (py-1 keeps the focus
 * ring unclipped); the page never does.
 */
export function StatusTabs({ items, value, onValueChange, "aria-label": label, children, toolbar, className }: StatusTabsProps) {
  const list = (
    <TabsList
      aria-label={label}
      className="-mx-4 -my-1 flex justify-start gap-2 overflow-x-auto rounded-none bg-transparent px-4 py-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0"
    >
      {items.map((item) => (
        <TabsTrigger
          key={item.value}
          value={item.value}
          // Only when set: undefined would wipe the aria-controls Radix points at the panel.
          {...(item.controls ? { "aria-controls": item.controls } : {})}
          className="group shrink-0 gap-1.5 rounded-full border bg-background px-3.5 py-0 font-normal text-subtle-foreground data-[state=active]:border-primary data-[state=active]:bg-primary data-[state=active]:font-medium data-[state=active]:text-primary-foreground data-[state=active]:shadow-none"
        >
          {item.label}
          {item.count !== undefined && (
            <>
              {" "}
              <span className="tabular-nums text-muted-foreground group-data-[state=active]:text-primary-foreground/70">
                {item.count}
              </span>
            </>
          )}
        </TabsTrigger>
      ))}
    </TabsList>
  )
  return (
    <Tabs value={value} onValueChange={onValueChange} className={cn("flex flex-col gap-4 sm:gap-6", className)}>
      {toolbar ? (
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          {list}
          {toolbar}
        </div>
      ) : (
        list
      )}
      {children !== undefined && (
        <TabsContent value={value} className="mt-0">
          {children}
        </TabsContent>
      )}
    </Tabs>
  )
}
