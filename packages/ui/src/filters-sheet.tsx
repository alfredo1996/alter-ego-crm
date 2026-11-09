"use client"

import { SlidersHorizontal } from "lucide-react"
import { useState, type ReactNode } from "react"

import { Button } from "./ui/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "./ui/sheet"
import { cn } from "./utils"

interface FiltersSheetProps {
  /** How many filters are set, shown as "Filters (n)". */
  active: number
  /** The filter controls; they apply as they change, so the sheet has only Done. */
  children: ReactNode
  className?: string
}

/**
 * A phone's filters: a "Filters (n)" button that opens the controls in a bottom
 * sheet, so the list starts on the first screen. The caller shows the button
 * below sm only (`className="sm:hidden"`) and renders the same controls inline
 * from sm up (`hidden sm:contents`): CSS picks the layout, so nothing flashes on
 * hydration, and the sheet's copy mounts only while it is open.
 */
export function FiltersSheet({ active, children, className }: FiltersSheetProps) {
  const [open, setOpen] = useState(false)
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      {/* A trigger, so closing hands focus back to it. */}
      <SheetTrigger asChild>
        <Button variant="outline" className={cn("shrink-0", className)}>
          <SlidersHorizontal />
          {active > 0 ? `Filters (${active})` : "Filters"}
        </Button>
      </SheetTrigger>
      <SheetContent
        side="bottom"
        // Focus goes to the sheet itself, which traps it: on the close X it drew a ring, and on a
        // select it would open the keyboard's picker. Left outside, Tab reached the page behind.
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          const sheet = e.currentTarget as HTMLElement
          sheet.focus()
        }}
        className="flex max-h-[85dvh] flex-col gap-4 overflow-y-auto rounded-t-xl outline-none"
      >
        <SheetHeader className="text-left">
          <SheetTitle>Filters</SheetTitle>
          <SheetDescription className="sr-only">Narrow the list. Changes apply at once.</SheetDescription>
        </SheetHeader>
        {children}
        {/* Pinned to the sheet's bottom, as a dialog's footer is: with Advanced open the controls outgrow the sheet. */}
        <div className="sticky -bottom-6 -mx-6 -mb-6 mt-auto border-t bg-background px-6 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          <Button className="w-full" onClick={() => setOpen(false)}>
            Done
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
