import { PageLoader } from "@alter-ego/ui/page/page-state"
import { Suspense } from "react"

import { CashBookShell } from "@/components/cash-book/cash-book-shell"

export const metadata = { title: "Cash Book" }

// useSearchParams (?tab= and ?month=, Month End's links) needs a Suspense boundary to prerender.
export default function CashBookPage() {
  return (
    <Suspense fallback={<PageLoader />}>
      <CashBookShell />
    </Suspense>
  )
}
