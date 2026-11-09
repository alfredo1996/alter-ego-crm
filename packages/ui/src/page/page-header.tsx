import { ChevronLeft } from "lucide-react"
import Link from "next/link"

import { cn } from "../utils"

import type { ReactNode } from "react"

interface PageHeaderProps {
  title: ReactNode
  /** One line under the title. */
  subtitle?: ReactNode
  /** Buttons on the right; they wrap under the title when the row is too narrow. */
  actions?: ReactNode
  /**
   * A breadcrumb: a link back up, named "Back to {label}", then "/ {current}". `onNavigate` runs before it
   * leaves; its preventDefault() keeps the page (unsaved edits).
   */
  back?: { href: string; label: string; current?: ReactNode; onNavigate?: (e: { preventDefault: () => void }) => void }
  /** StatusPills over the title. */
  pills?: ReactNode
  /** A MetaRow (or any fact line) under the title. */
  meta?: ReactNode
  /**
   * A More menu: after the actions on a desktop; on a phone at the breadcrumb's right end, or, with no
   * breadcrumb, beside the title (Month End's Download CSV and Other Periods).
   */
  more?: ReactNode
  /** A list page's 30px title, or a detail page's 36px one. */
  size?: "list" | "detail"
  className?: string
}

/** The one h1 block on every page (plan §2, Components.dc). */
export function PageHeader({ title, subtitle, actions, back, pills, meta, more, size = "list", className }: PageHeaderProps) {
  return (
    <div className={cn("flex flex-col gap-3", more && "relative", className)}>
      {back && (
        <div className={cn("flex min-w-0 items-center gap-2 text-sm text-muted-foreground", more && "max-sm:pr-12")}>
          {/* -my-3 py-3: a 44 px target that adds no height. */}
          <Link
            href={back.href}
            onNavigate={back.onNavigate}
            className="-my-3 inline-flex shrink-0 items-center gap-1.5 rounded-md py-3 text-subtle-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
          >
            <ChevronLeft aria-hidden className="size-4" />
            <span className="sr-only">Back to </span>
            {back.label}
          </Link>
          {back.current && (
            <>
              <span aria-hidden>/</span>
              <span className="truncate">{back.current}</span>
            </>
          )}
        </div>
      )}
      {/* Wraps instead of squeezing: the title block is at most 42rem, so the actions stay on its right
          on a desktop and drop under it on a phone once a subtitle fills the line. They line up with the
          subtitle's last line, with a lone title's middle, or with a detail page's pills. */}
      <div
        className={cn(
          "flex flex-wrap justify-between gap-x-4 gap-y-3",
          size === "detail" ? "items-start" : subtitle || meta ? "items-end" : "items-center",
        )}
      >
        <div className={cn("flex min-w-0 max-w-2xl flex-col", size === "list" ? "gap-1.5" : "gap-2.5")}>
          {pills && <div className="flex flex-wrap items-center gap-2">{pills}</div>}
          <h1
            className={cn(
              "font-semibold tracking-tight [overflow-wrap:anywhere]",
              size === "list" ? "text-[26px] leading-[1.2] sm:text-3xl" : "text-[28px] leading-[1.15] sm:text-4xl",
              // Clear of the More menu beside it on a phone; the subtitle and meta below keep the full width.
              more && !back && "max-sm:pr-12",
            )}
          >
            {title}
          </h1>
          {subtitle && <p className="text-sm text-muted-foreground sm:text-[15px]">{subtitle}</p>}
          {meta}
        </div>
        {(actions || more) && (
          // With a More menu, a phone lifts it beside the breadcrumb: `contents` leaves no empty box behind
          // when the actions are desktop-only, and the menu centres on the breadcrumb's line.
          <div className={cn("flex flex-wrap items-center gap-2", more && "max-sm:contents")}>
            {actions}
            {/* Centred on the breadcrumb's line, or on a list title's (31 px) with none. */}
            {more && <div className={cn("max-sm:absolute max-sm:right-0", back ? "max-sm:-top-3" : "max-sm:-top-1.5")}>{more}</div>}
          </div>
        )}
      </div>
    </div>
  )
}
