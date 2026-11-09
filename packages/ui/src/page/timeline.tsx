"use client"

import { useState } from "react"

import { DOT } from "./meta-row"
import { Button } from "../ui/button"
import { cn } from "../utils"

import type { Tone } from "./status-pill"
import type { ReactNode } from "react"

export interface TimelineItem {
  key: string
  /** Shown in mono: "2026-07-15". */
  date: ReactNode
  content: ReactNode
  /** A hollow dot: where it started. */
  outline?: boolean
  /** The dot's colour, e.g. a meeting's light; the content says it in words too. */
  tone?: Tone
  /** On the entry's right, e.g. its Edit button. */
  actions?: ReactNode
}

interface TimelineProps {
  /** Newest first. */
  items: TimelineItem[]
  /** A phone shows this many, then "Show N older entries". */
  phoneLimit?: number
  className?: string
}

/** Dated entries down a line (Solution.dc's History): a dot, the date in mono, the text beside it (under it on a phone). */
export function Timeline({ items, phoneLimit, className }: TimelineProps) {
  const [all, setAll] = useState(false)
  const shown = all || phoneLimit === undefined ? items.length : Math.min(phoneLimit, items.length)
  const older = items.length - shown
  return (
    <div className={className}>
      <ol className="flex flex-col">
        {items.map((item, i) => {
          const last = i === items.length - 1
          // The last one a phone shows ends the line there.
          const phoneLast = !last && i === shown - 1
          return (
            <li key={item.key} className={cn("flex gap-3.5 sm:gap-4", i >= shown && "max-sm:hidden")}>
              <div aria-hidden className="flex flex-col items-center">
                <span
                  className={cn(
                    "mt-1.5 size-2.5 shrink-0 rounded-full sm:mt-[7px]",
                    item.outline ? "border-2 border-primary bg-background" : item.tone ? DOT[item.tone] : "bg-primary",
                  )}
                />
                {!last && <span className={cn("w-[1.5px] flex-1 bg-border", phoneLast && "max-sm:hidden")} />}
              </div>
              <div
                className={cn(
                  "flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:flex-wrap sm:gap-x-4 sm:gap-y-1",
                  !last && "pb-4 sm:pb-[18px]",
                  phoneLast && "max-sm:pb-0",
                )}
              >
                <span className="font-mono text-[12.5px] text-muted-foreground sm:min-w-24 sm:text-meta sm:leading-6">{item.date}</span>
                <span className="text-[15px] leading-normal text-foreground/90 [overflow-wrap:anywhere] sm:flex-[1_1_360px] sm:leading-6">
                  {item.content}
                </span>
              </div>
              {item.actions && <div className="-mt-2 shrink-0">{item.actions}</div>}
            </li>
          )
        })}
      </ol>
      {older > 0 && (
        <Button variant="link" className="h-11 px-0 text-subtle-foreground sm:hidden" onClick={() => setAll(true)}>
          Show {older} older {older === 1 ? "entry" : "entries"}
        </Button>
      )}
    </div>
  )
}
