import { PageLoader } from "@alter-ego/ui/page/page-state"
import { Suspense } from "react"

import { MonthEndShell } from "@/components/month-end/month-end-shell"

export const metadata = { title: "Month End" }

// useSearchParams (the month's ?month=) needs a Suspense boundary to prerender.
export default function MonthEndPage() {
  return (
    <Suspense fallback={<PageLoader />}>
      <MonthEndShell />
    </Suspense>
  )
}
