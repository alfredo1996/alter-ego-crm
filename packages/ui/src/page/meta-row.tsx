import { cn } from "../utils"

import type { Tone } from "./status-pill"
import type { ReactNode } from "react"

/** A muted line of facts, wrapping on a phone. */
export function MetaRow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-x-[18px] gap-y-1.5 text-sm text-subtle-foreground", className)}>
      {children}
    </div>
  )
}

/** A tone's solid dot colour. */
export const DOT: Record<Tone, string> = {
  success: "bg-success",
  warning: "bg-warning",
  info: "bg-info",
  danger: "bg-danger",
  neutral: "bg-muted-foreground",
}

interface StatusDotProps {
  tone?: Tone
  /** Hollow: not started, pre-sales. */
  outline?: boolean
  /** The word the dot stands for: the dot itself is decorative. */
  children: ReactNode
}

/** An 8px dot with its word beside it. */
export function StatusDot({ tone = "neutral", outline = false, children }: StatusDotProps) {
  return (
    <span className="inline-flex items-center gap-[7px]">
      <span
        aria-hidden
        className={cn("size-2 shrink-0 rounded-full", outline ? "border-[1.5px] border-muted-foreground" : DOT[tone])}
      />
      {children}
    </span>
  )
}
