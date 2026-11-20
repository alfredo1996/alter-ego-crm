"use client"

import { ImportProgressIndicator } from "./components/import-progress-indicator"
import { QuickAddFab } from "./components/quick-add-fab"

/** What finance floats over every page: the phone's New Transaction button and the import progress indicator. */
export function FinanceOverlays() {
  return (
    <>
      <QuickAddFab />
      <ImportProgressIndicator />
    </>
  )
}
