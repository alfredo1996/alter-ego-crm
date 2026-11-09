import { PageLoader } from "@alter-ego/ui/page/page-state"
import { Suspense } from "react"

import { PlanShell } from "@/components/plan/plan-shell"

export const metadata = { title: "Plan" }

// useSearchParams (the week of hours' ?week=) needs a Suspense boundary to prerender.
export default function PlanPage() {
  return (
    <Suspense fallback={<PageLoader />}>
      <PlanShell />
    </Suspense>
  )
}
