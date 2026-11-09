import { cn } from "../utils"

import type { Tone } from "./status-pill"
import type { ReactNode } from "react"

type SegmentedProgressProps = (
  | {
      /** May be fractional: 1.5 fills one segment and half the next (a 15% deal on ten). */
      done: number
      total: number
      tones?: never
    }
  | {
      /** One segment per item, coloured by its state (Month End's steps), in place of done/total. */
      tones: Tone[]
      done?: never
      total?: never
    }
) & {
  /** The screen reader's version, e.g. "7 of 9 sections written": the segments and "7/9" are decorative. */
  label?: string
  /** What a card shows beside the segments in place of "7/9", e.g. "70%". */
  text?: ReactNode
  /**
   * `card`: small segments then "7/9". `banner`: 26 px segments, full width on a phone, beside its own
   * visible sentence. `bar`: 8 px segments across the full width, the label read out after them.
   */
  size?: "card" | "banner" | "bar"
  className?: string
}

/** A segment's colour by tone. Neutral (not needed) is hollow in the muted text colour, like StatusDot outline. */
const TONE_BG: Record<Tone, string> = {
  success: "bg-success",
  warning: "bg-warning",
  info: "bg-info",
  danger: "bg-danger",
  neutral: "border-[1.5px] border-muted-foreground",
}

/** n segments, the done ones dark or each in its tone: a card footer's "▬▬▬ 7/9", or a page's progress line. */
export function SegmentedProgress({ done = 0, total = 0, tones, label, text, size = "card", className }: SegmentedProgressProps) {
  const segments = tones
    ? tones.map((tone) => ({ className: TONE_BG[tone], style: undefined }))
    : Array.from({ length: total }, (_, i) => {
        // How full the segment is, 0 to 1.
        const on = Math.min(Math.max(done - i, 0), 1)
        return { className: on === 1 ? "bg-primary" : "bg-border", style: partial(on) }
      })
  const columns = { gridTemplateColumns: `repeat(${segments.length}, minmax(0, 1fr))` }
  if (size === "bar") {
    return (
      <>
        <span aria-hidden className={cn("grid gap-[3px] sm:gap-1", className)} style={columns}>
          {segments.map((s, i) => (
            <span key={i} className={cn("h-[7px] rounded-[3px] sm:h-2", s.className)} style={s.style} />
          ))}
        </span>
        {label && <span className="sr-only">{label}</span>}
      </>
    )
  }
  if (size === "banner") {
    return (
      <span aria-hidden className={cn("grid gap-[3px] sm:inline-flex", className)} style={columns}>
        {segments.map((s, i) => (
          <span key={i} className={cn("h-1.5 rounded-[3px] sm:w-[26px]", s.className)} style={s.style} />
        ))}
      </span>
    )
  }
  return (
    <span className={cn("inline-flex items-center gap-2 tabular-nums", className)}>
      <span aria-hidden className="inline-flex gap-0.5">
        {segments.map((s, i) => (
          <span key={i} className={cn("h-[5px] w-[9px] rounded-[2px]", s.className)} style={s.style} />
        ))}
      </span>
      <span aria-hidden>{text ?? (tones ? null : `${done}/${total}`)}</span>
      {label && <span className="sr-only">{label}</span>}
    </span>
  )
}

/** A part-filled segment: dark up to its fill, the track after. */
function partial(fill: number) {
  if (fill === 0 || fill === 1) return undefined
  return { background: `linear-gradient(90deg, hsl(var(--primary)) ${fill * 100}%, hsl(var(--border)) 0)` }
}

const BAR_TONE = {
  default: "bg-primary",
  warning: "bg-warning",
  danger: "bg-danger",
  success: "bg-success",
}

interface ProgressBarProps {
  /** 0 to 1; clamped. */
  value: number
  tone?: keyof typeof BAR_TONE
  /** What it measures: "Groceries". The visible words beside it say how far, so this is the name only. */
  label: string
  /** A CSS colour for the fill, in place of `tone`: a savings goal's own colour. */
  color?: string
  className?: string
}

/** A thin continuous bar for money against a limit or a target. State is said in words beside it, not by its colour. */
export function ProgressBar({ value, tone = "default", label, color, className }: ProgressBarProps) {
  const fill = Math.min(Math.max(value, 0), 1)
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(fill * 100)}
      className={cn("h-1.5 overflow-hidden rounded-[3px] bg-hairline", className)}
    >
      <div className={cn("h-full rounded-[3px]", !color && BAR_TONE[tone])} style={{ width: `${fill * 100}%`, backgroundColor: color }} />
    </div>
  )
}
