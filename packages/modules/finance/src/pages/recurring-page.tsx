import { PageLoader } from "@alter-ego/ui/page/page-state"
import { Suspense } from "react"

import { RecurringShell } from "../components/recurring/recurring-shell"

export function RecurringPage() {
  // useSearchParams (Reports' ?tab=suggested link) needs a Suspense boundary to prerender.
  return (
    <Suspense fallback={<PageLoader />}>
      <RecurringShell />
    </Suspense>
  )
}
