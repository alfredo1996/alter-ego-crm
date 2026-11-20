"use client"

import { Button } from "@alter-ego/ui/ui/button"
import { Plus } from "lucide-react"
import { usePathname } from "next/navigation"
import { useState } from "react"

import { NewTransactionDialog } from "./transactions/new-transaction-dialog"


/** The phone's New Transaction: a + in the mobile top bar's empty right end. A desktop page has it in its header. */
export function QuickAddFab() {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()

  // Transactions has its own New Transaction button.
  if (pathname === "/transactions") return null

  return (
    <>
      {/* Floating over the page it covered whichever row action scrolled under it, so it is
          in the top bar; from md up the sidebar layout has no top bar and the page's header
          carries New Transaction (Dashboard, Accounts, Transactions). */}
      <Button
        size="icon"
        className="fixed top-1.5 right-3 z-50 h-11 w-11 rounded-full md:hidden"
        onClick={() => setOpen(true)}
        aria-label="New Transaction"
      >
        <Plus className="h-6 w-6" />
      </Button>

      <NewTransactionDialog open={open} onOpenChange={setOpen} />
    </>
  )
}
