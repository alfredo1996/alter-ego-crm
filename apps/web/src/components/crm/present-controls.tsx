"use client"

import { Button } from "@alter-ego/ui/ui/button"
import { Presentation } from "lucide-react"

import { usePresent } from "@/hooks/use-present"

/** Present, beside a page's own actions; the page hides it while presenting. */
export function PresentButton({ blockedBy }: { blockedBy?: string }) {
  const { setPresent } = usePresent()
  return (
    <>
      <Button variant="outline" size="lg" disabled={!!blockedBy} aria-describedby={blockedBy ? "present-blocked" : undefined} onClick={() => setPresent(true)}>
        <Presentation aria-hidden /> Present
      </Button>
      {blockedBy && (
        <span id="present-blocked" className="sr-only">
          {blockedBy}
        </span>
      )}
    </>
  )
}

/** The bar over a presenting page: what is hidden, and the way out. */
export function PresentBanner() {
  const { setPresent } = usePresent()
  return (
    <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-foreground px-4 py-3 text-sm text-background">
      <span>Presenting: days, money and edit controls are hidden.</span>
      <Button variant="outline" size="lg" className="border-background/40 bg-transparent text-background hover:bg-background/10 hover:text-background" onClick={() => setPresent(false)}>
        Stop Presenting
      </Button>
    </div>
  )
}
