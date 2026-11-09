
import { AlertCircle, Loader2 } from "lucide-react"

import { Button } from "../ui/button"
import { Card, CardContent } from "../ui/card"

import type { ReactElement } from "react"

/** The one loading look: route changes, auth restore and page data all show this. */
export function PageLoader() {
  return (
    <div role="status" aria-label="Loading" className="flex min-h-[50vh] items-center justify-center">
      <Loader2 className="text-muted-foreground h-8 w-8 animate-spin" />
    </div>
  )
}

export function PageError({ message, onRetry }: { message?: string; onRetry: () => void }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-4 p-8">
        <AlertCircle className="h-10 w-10 text-destructive" />
        <p className="text-sm text-muted-foreground">{message || "Failed to load data"}</p>
        <Button variant="outline" onClick={onRetry}>
          Try Again
        </Button>
      </CardContent>
    </Card>
  )
}

interface PageQuery {
  isPending: boolean
  isError: boolean
  data: unknown
  error: Error | null
  refetch: () => unknown
}

/**
 * What a page shows until every query it needs has data: the error card if one
 * failed with nothing to show, the spinner while any is pending, else null.
 *
 * isPending, not isLoading: a query disabled until the user arrives is pending
 * but not loading, so an isLoading gate let the empty state flash first. That
 * also means it suits only queries that are always enabled once a user exists;
 * a flag-gated one stays pending forever. `data === undefined`, not `!data`: a
 * failed background refetch keeps the stale page, even a null settings doc.
 */
export function pageState(queries: PageQuery[]): ReactElement | null {
  const failed = queries.filter((q) => q.isError && q.data === undefined)
  if (failed.length > 0) {
    return (
      <PageError
        message={failed[0].error?.message}
        onRetry={() => failed.forEach((q) => void q.refetch())}
      />
    )
  }
  return queries.some((q) => q.isPending) ? <PageLoader /> : null
}
