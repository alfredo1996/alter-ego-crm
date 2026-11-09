import { badgeVariants } from "../ui/badge"
import { cn } from "../utils"

import type { ReactNode } from "react"

/** The five state tones (plan §1.5): soft pairs for pills, solid colours for dots. */
export type Tone = "success" | "warning" | "info" | "danger" | "neutral"

/** A soft rounded-full state label. It always carries a word: never colour alone. */
export function StatusPill({ tone = "neutral", className, children }: { tone?: Tone; className?: string; children: ReactNode }) {
  // A span on the Badge's tones, so it sits inside a line of text.
  return <span className={cn(badgeVariants({ variant: tone }), className)}>{children}</span>
}

interface TagChipProps {
  children: ReactNode
  /** A colour dot before the text, e.g. a category's colour. */
  dot?: string
  /** Geist Mono for identifiers and stack (the default); sans for words like a category. */
  mono?: boolean
  className?: string
}

/** A 12px chip on muted: a tag, a stack item, a document ref. */
export function TagChip({ children, dot, mono = true, className }: TagChipProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-md bg-muted px-2 py-[3px] text-xs leading-4 text-subtle-foreground",
        mono && "font-mono",
        className,
      )}
    >
      {dot && <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ backgroundColor: dot }} />}
      {children}
    </span>
  )
}

/** Chips up to `max`, then "+N" for the rest. */
export function TagList({ items, max = items.length, className }: { items: string[]; max?: number; className?: string }) {
  const rest = items.length - max
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {items.slice(0, max).map((item) => (
        <TagChip key={item}>{item}</TagChip>
      ))}
      {rest > 0 && (
        <span className="px-1 text-xs text-muted-foreground">
          +{rest}
          <span className="sr-only"> more</span>
        </span>
      )}
    </div>
  )
}
