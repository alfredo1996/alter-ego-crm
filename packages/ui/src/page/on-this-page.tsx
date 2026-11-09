"use client"

import { useEffect, useState, type ReactNode } from "react"

import { cn } from "../utils"

export interface OnThisPageItem {
  /** The section's id: the link is #id. */
  id: string
  label: string
  /** The chip's label below lg, when the index's is long ("Purpose" for "Purpose and Target"). */
  short?: string
  /** done: a filled check. empty: a dashed ring, muted (nothing there yet). */
  state?: "done" | "empty"
  /** How many the section holds, at the row's end (beside the chip's label on a phone). Not in the link's name. */
  count?: number | string
  /**
   * A state the section is in (Month End's steps): its mark at every width, its word after the label
   * in the link's name ("Hours, to do"). In place of `state`.
   */
  status?: { tone: StatusTone; label: string }
}

type StatusTone = "danger" | "warning" | "success" | "neutral"

interface OnThisPageProps {
  items: OnThisPageItem[]
  "aria-label": string
  /** The column's eyebrow, from lg. */
  title?: string
  /** A muted note under the column's links, from lg. */
  footer?: ReactNode
  className?: string
}

/** done: a dark disc with a check; empty: a dashed ring. Beside a word, never alone. */
function Mark({ state }: { state: OnThisPageItem["state"] }) {
  if (!state) return null
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="hidden size-3.5 shrink-0 lg:block">
      {state === "done" ? (
        <>
          <circle cx="12" cy="12" r="10" className="fill-primary" />
          <path d="m7.5 12.5 3 3 6-6.5" fill="none" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="stroke-primary-foreground" />
        </>
      ) : (
        <circle cx="12" cy="12" r="9" fill="none" strokeWidth="2" strokeDasharray="3 3" className="stroke-border-strong" />
      )}
    </svg>
  )
}

/** A state's mark (MonthEnd.dc): a red disc with "!", an amber triangle with "!", a green disc with a check, a ring. */
function StatusMark({ tone }: { tone: StatusTone }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="size-[13px] shrink-0 lg:size-3.5">
      {tone === "warning" ? (
        <>
          <path d="M12 2.8 22.2 20.6H1.8Z" strokeWidth="1.6" strokeLinejoin="round" className="fill-warning stroke-warning" />
          <path d="M12 9.2v4.8" strokeWidth="2.2" strokeLinecap="round" className="stroke-white" />
          <circle cx="12" cy="17.3" r="1.3" className="fill-white" />
        </>
      ) : tone === "neutral" ? (
        <circle cx="12" cy="12" r="9" fill="none" strokeWidth="2" className="stroke-muted-foreground" />
      ) : (
        <>
          <circle cx="12" cy="12" r="10" className={tone === "danger" ? "fill-danger" : "fill-success"} />
          {tone === "danger" ? (
            <>
              <path d="M12 7v6" strokeWidth="2.4" strokeLinecap="round" className="stroke-white" />
              <circle cx="12" cy="16.8" r="1.4" className="fill-white" />
            </>
          ) : (
            <path d="m7.5 12.5 3 3 6-6.5" fill="none" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="stroke-white" />
          )}
        </>
      )}
    </svg>
  )
}

/**
 * A page's index (Solution.dc): from lg a sticky column of links, each with its mark; below lg the
 * same links as chips in a row that scrolls sideways. One nav either way. The section on screen is
 * aria-current="location". Plain anchors, no smooth scroll (plan §1.7): sections take `scroll-mt-20`.
 * It finds the sections by id once: a page that remounts them under the same ids keys the index with them.
 */
export function OnThisPage({ items, "aria-label": label, title = "On this page", footer, className }: OnThisPageProps) {
  const [current, setCurrent] = useState(items[0]?.id)
  const ids = items.map((i) => i.id).join(" ")
  useEffect(() => {
    const sections = ids.split(" ").flatMap((id) => document.getElementById(id) ?? [])
    if (typeof IntersectionObserver === "undefined" || sections.length === 0) return
    // ponytail: current = the first section in the band under the top bar, down to 40% of the screen;
    // between two sections the last one stays.
    const seen = new Set<string>()
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) seen.add(e.target.id)
          else seen.delete(e.target.id)
        }
        const first = sections.find((s) => seen.has(s.id))
        if (first) setCurrent(first.id)
      },
      { rootMargin: "-80px 0px -60% 0px" },
    )
    sections.forEach((s) => observer.observe(s))
    return () => observer.disconnect()
  }, [ids])

  return (
    <nav
      aria-label={label}
      className={cn(
        // -my-1 py-1: a scroller clips both ways, and the chips' focus ring sits 4 px out.
        "-mx-4 -my-1 overflow-x-auto px-4 py-1 sm:-mx-6 sm:px-6",
        "lg:sticky lg:top-10 lg:mx-0 lg:my-0 lg:w-[220px] lg:shrink-0 lg:self-start lg:overflow-visible lg:px-0 lg:py-0",
        className,
      )}
    >
      <p className="hidden px-2.5 pb-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground lg:block">
        {title}
      </p>
      <ul className="flex w-max gap-2 lg:w-auto lg:flex-col lg:gap-0.5">
        {items.map((item) => (
          <li key={item.id}>
            <a
              href={`#${item.id}`}
              // One name at every width, whichever label shows.
              aria-label={item.status ? `${item.label}, ${item.status.label}` : item.state === "empty" ? `${item.label} (empty)` : item.label}
              aria-current={item.id === current ? "location" : undefined}
              onClick={() => setCurrent(item.id)}
              className={cn(
                // A chip on a phone, a row in the column.
                "group flex min-h-10 pointer-coarse:min-h-11 items-center gap-2.5 rounded-full border px-3.5 text-[13.5px] whitespace-nowrap transition-colors motion-reduce:transition-none",
                "lg:min-h-9 lg:rounded-lg lg:border-0 lg:px-2.5 lg:text-sm lg:whitespace-normal",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                item.state === "empty"
                  ? "border-[1.5px] border-dashed border-border-strong text-muted-foreground"
                  : "text-subtle-foreground hover:text-foreground",
                "aria-[current=location]:border-solid aria-[current=location]:border-primary aria-[current=location]:bg-primary aria-[current=location]:text-primary-foreground",
                "lg:hover:bg-muted lg:aria-[current=location]:bg-muted lg:aria-[current=location]:font-medium lg:aria-[current=location]:text-foreground",
              )}
            >
              {item.status ? <StatusMark tone={item.status.tone} /> : <Mark state={item.state} />}
              <span className={cn(item.short && "hidden lg:inline")}>{item.label}</span>
              {item.short && <span className="lg:hidden">{item.short}</span>}
              {item.count !== undefined && (
                <span className="font-mono text-xs text-muted-foreground tabular-nums group-aria-[current=location]:text-primary-foreground/75 lg:ml-auto lg:group-aria-[current=location]:text-muted-foreground">
                  {item.count}
                </span>
              )}
            </a>
          </li>
        ))}
      </ul>
      {footer && (
        <p className="mt-3 hidden border-t border-hairline px-2.5 pt-3 text-[12.5px] leading-normal text-muted-foreground lg:block">{footer}</p>
      )}
    </nav>
  )
}
