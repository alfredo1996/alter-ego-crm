import { PageLoader } from "@alter-ego/ui/page/page-state"
import { Suspense } from "react"

import { SolutionCatalog } from "@/components/crm/solution-catalog"

export const metadata = { title: "Solutions" }

// useSearchParams (the filters, and an old ?solution= link) needs a Suspense boundary to prerender.
export default function SolutionsPage() {
  return (
    <Suspense fallback={<PageLoader />}>
      <SolutionCatalog />
    </Suspense>
  )
}
