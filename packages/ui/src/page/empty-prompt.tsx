import { cn } from "../utils"

import type { ReactNode } from "react"

interface EmptyPromptProps {
  /** The question or the fact: "Which client do you bill first?" */
  title: ReactNode
  /** One line of hint. */
  description?: ReactNode
  /** One action. */
  action?: ReactNode
  /** `inline`: a list's empty row, a line with its button on the right. */
  variant?: "block" | "inline"
  /** The block's heading id, for a section it stands in for (aria-labelledby, anchors). */
  titleId?: string
  className?: string
}

const DASHED = "border-[1.5px] border-dashed border-border-strong bg-surface-subtle"

/** One compact dashed prompt in place of empty content. Never a page-tall illustration. */
export function EmptyPrompt({ title, description, action, variant = "block", titleId, className }: EmptyPromptProps) {
  if (variant === "inline") {
    return (
      <div
        className={cn(
          "flex flex-wrap items-center justify-between gap-2.5 rounded-xl py-2.5 pr-2.5 pl-[18px] text-sm text-subtle-foreground",
          DASHED,
          className,
        )}
      >
        <p>{title}</p>
        {action}
      </div>
    )
  }
  return (
    // The question and its hint stay together, so a caller's sm:flex-row puts the action beside them.
    <div className={cn("flex flex-col items-start gap-2.5 rounded-xl p-(--card-padding)", DASHED, className)}>
      <div className="flex flex-col gap-2.5">
        <h2 id={titleId} className="text-[17px] font-semibold tracking-tight">
          {title}
        </h2>
        {description && <p className="text-sm text-subtle-foreground">{description}</p>}
      </div>
      {action}
    </div>
  )
}
