"use client"

import { Loader2 } from "lucide-react"

import { useImportStore } from "../stores/import-store"


export function ImportProgressIndicator() {
  const active = useImportStore((s) => s.active)

  if (!active) return null

  const pct = active.total > 0 ? Math.round((active.done / active.total) * 100) : 0

  return (
    <div className="fixed bottom-4 left-4 z-50 flex items-center gap-3 rounded-lg border bg-background px-4 py-3 shadow-lg md:left-auto md:right-4">
      <Loader2 className="h-4 w-4 animate-spin text-primary" />
      <div className="min-w-0">
        <p className="text-sm font-medium">{active.label}</p>
        {/* total 0 = no countable steps; the spinner alone says it's running */}
        {active.total > 0 && (
          <div className="mt-1 flex items-center gap-2">
            <div className="h-1.5 w-32 rounded-full bg-muted">
              <div
                className="h-1.5 rounded-full bg-primary transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="text-xs tabular-nums text-muted-foreground">
              {active.done}/{active.total}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
