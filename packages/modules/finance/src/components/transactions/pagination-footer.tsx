import { Button } from "@alter-ego/ui/ui/button"
import { ChevronLeft, ChevronRight } from "lucide-react"


interface PaginationFooterProps {
  page: number
  pageSize: number
  /** Rows on this page. */
  shown: number
  total: number
  onPageChange: (page: number) => void
}

/** "1–50 of 52" and Previous / Page 1 of 2 / Next, for the foot of a transaction list's card. */
export function PaginationFooter({ page, pageSize, shown, total, onPageChange }: PaginationFooterProps) {
  const totalPages = Math.ceil(total / pageSize)
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 py-3 pr-4 pl-5">
      <span className="text-[13px] text-muted-foreground">
        <span className="tabular-nums">
          {page * pageSize + 1}–{page * pageSize + shown}
        </span>{" "}
        of {total}
      </span>
      {totalPages > 1 && (
        <div className="flex items-center gap-2">
          <Button variant="outline" size="lg" disabled={page === 0} onClick={() => onPageChange(Math.max(0, page - 1))}>
            <ChevronLeft className="h-4 w-4" />
            Previous
          </Button>
          <span className="px-1.5 text-[13px] text-muted-foreground">
            Page {page + 1} of {totalPages}
          </span>
          <Button variant="outline" size="lg" disabled={page >= totalPages - 1} onClick={() => onPageChange(page + 1)}>
            Next
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  )
}
