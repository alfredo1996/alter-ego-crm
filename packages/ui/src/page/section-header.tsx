import { cn } from "../utils"

import type { ReactNode } from "react"

const TITLE = {
  // A page section: 20px over a hairline.
  section: "text-lg font-semibold tracking-tight sm:text-xl",
  // A card's own title.
  card: "text-[17px] font-semibold tracking-tight",
  eyebrow: "text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground",
}

interface SectionHeaderProps {
  title: ReactNode
  /** For anchors and aria-labelledby. */
  id?: string
  level?: 2 | 3
  /** A count or a short description beside the title; a long one wraps under it. */
  description?: ReactNode
  actions?: ReactNode
  variant?: keyof typeof TITLE
  className?: string
}

/** A heading with its count and its actions on the right. */
export function SectionHeader({ title, id, level = 2, description, actions, variant = "section", className }: SectionHeaderProps) {
  const Heading = level === 2 ? "h2" : "h3"
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-x-3 gap-y-2",
        variant === "section" && "border-b border-hairline pb-2",
        className,
      )}
    >
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
        <Heading id={id} className={TITLE[variant]}>
          {title}
        </Heading>
        {description && <p className="text-meta text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  )
}
