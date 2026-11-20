"use client"

interface SelectAllBannerProps {
  /** Rows on the shown page, and whether they are all selected. */
  pageCount: number
  pageSelected: boolean
  /** Rows matching, over every page, and how many are selected. */
  total: number
  selectedCount: number
  selecting: boolean
  onSelectAll: () => void
  onClear: () => void
}

/**
 * Offered once a whole page is selected: lets the user act on the whole result set (e.g. an entire
 * month, or every row of an account), not just the visible page.
 */
export function SelectAllBanner({ pageCount, pageSelected, total, selectedCount, selecting, onSelectAll, onClear }: SelectAllBannerProps) {
  if (pageCount === 0 || !pageSelected || total <= pageCount) return null
  return (
    <div className="mb-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
      {selectedCount >= total ? (
        <span className="flex flex-wrap items-center gap-2">
          All <strong>{total}</strong> transactions are selected.
          <button onClick={onClear} className="font-medium text-primary hover:underline">
            Clear selection
          </button>
        </span>
      ) : (
        <span className="flex flex-wrap items-center gap-2">
          All {pageCount} on this page are selected.
          <button onClick={onSelectAll} disabled={selecting} className="font-medium text-primary hover:underline disabled:opacity-50">
            {selecting ? "Selecting…" : `Select all ${total} matching`}
          </button>
        </span>
      )}
    </div>
  )
}
