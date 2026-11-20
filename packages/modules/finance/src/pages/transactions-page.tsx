import { Skeleton } from "@alter-ego/ui/ui/skeleton"
import { Suspense } from "react"

import { TransactionsShell } from "../components/transactions/transactions-shell"

export function TransactionsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full rounded-xl" />}>
      <TransactionsShell />
    </Suspense>
  )
}
