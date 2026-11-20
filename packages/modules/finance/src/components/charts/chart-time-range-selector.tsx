"use client"


import { SegmentedButtons } from "@alter-ego/ui/page/segmented-buttons"
import { Button } from "@alter-ego/ui/ui/button"
import { X } from "lucide-react"

export type TimeRange = "1M" | "3M" | "6M" | "1Y" | "All"

const RANGES = (["1M", "3M", "6M", "1Y", "All"] as const).map((value) => ({ value, label: value }))

interface ChartTimeRangeSelectorProps {
  value: TimeRange
  onChange: (range: TimeRange) => void
  hasBrush?: boolean
  onClearBrush?: () => void
}

/** The chart's range as a segmented control, with Clear zoom beside it once a brush has picked one. */
export function ChartTimeRangeSelector({ value, onChange, hasBrush, onClearBrush }: ChartTimeRangeSelectorProps) {
  return (
    <div className="flex items-center gap-1">
      <SegmentedButtons options={RANGES} value={value} onChange={onChange} aria-label="Range" />
      {hasBrush && onClearBrush && (
        <Button variant="ghost" size="sm" className="ml-1 text-xs" onClick={onClearBrush}>
          <X className="mr-0.5 h-3 w-3" />
          Clear zoom
        </Button>
      )}
    </div>
  )
}
