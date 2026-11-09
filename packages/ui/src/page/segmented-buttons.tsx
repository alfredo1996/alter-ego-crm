import { cn } from "../utils"

import type { CSSProperties, ReactNode } from "react"

interface SegmentedButtonsProps<T extends string> {
  /** `icon`: before the label, decorative. `description`: a second line under the label (a stacked option). */
  options: { value: T; label: string; icon?: ReactNode; description?: string }[]
  value: T
  onChange: (value: T) => void
  /** Name the group by `aria-label`, or by a visible label's id with `aria-labelledby`. */
  "aria-label"?: string
  "aria-labelledby"?: string
  /** Something that sits in the track after the buttons, like a menu for "Other". */
  trailing?: ReactNode
  className?: string
}

/**
 * A choice made with buttons: the segmented look over `aria-pressed` buttons, so a test clicks them
 * as buttons. For views that switch panels, use Tabs (StatusTabs); this is for a setting.
 */
export function SegmentedButtons<T extends string>({ options, value, onChange, "aria-label": label, "aria-labelledby": labelledBy, trailing, className }: SegmentedButtonsProps<T>) {
  // Options with a description fill the width in equal columns, each a two-line button.
  const stacked = options.some((o) => o.description)
  return (
    <div
      role="group"
      aria-label={label}
      aria-labelledby={labelledBy}
      className={cn("max-w-full rounded-[10px] bg-muted p-[3px]", stacked ? "grid gap-[3px]" : "inline-flex", className)}
      style={stacked ? ({ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` } satisfies CSSProperties) : undefined}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn(
            "min-h-[38px] rounded-lg px-3 text-[13px] transition-colors motion-reduce:transition-none pointer-coarse:min-h-11",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            stacked ? "flex min-h-[52px] flex-col items-start justify-center gap-0.5 py-2 text-left" : "inline-flex items-center gap-1.5",
            o.value === value
              ? "bg-background font-medium text-foreground shadow-xs"
              : "text-subtle-foreground hover:text-foreground",
          )}
        >
          {o.icon}
          {o.description ? (
            <>
              <span className="text-sm">{o.label}</span>
              <span className="text-[12.5px] font-normal text-muted-foreground">{o.description}</span>
            </>
          ) : (
            o.label
          )}
        </button>
      ))}
      {trailing}
    </div>
  )
}
