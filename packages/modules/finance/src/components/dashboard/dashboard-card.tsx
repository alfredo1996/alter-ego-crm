
import { ContentCard } from "@alter-ego/ui/page/content-card"
import { SectionHeader } from "@alter-ego/ui/page/section-header"
import { cn } from "@alter-ego/ui/utils"
import { ChevronRight } from "lucide-react"
import Link from "next/link"

import type { ReactNode } from "react"

interface DashboardCardProps {
  id: string
  title: string
  /** A count or a period beside the title. */
  description?: ReactNode
  /** "View all" goes here; `what` finishes its accessible name ("View all budgets"). */
  href?: string
  what?: string
  /** Under the list: a count on the left, a total on the right. */
  footer?: ReactNode
  /** No card chrome below sm: the phone draws the section bare, its rows being cards of their own. */
  bareOnPhone?: boolean
  className?: string
  children: ReactNode
}

/** One compact card of the Dashboard: a titled section with a "View all" link, its list and a total line. */
export function DashboardCard({ id, title, description, href, what, footer, bareOnPhone, className, children }: DashboardCardProps) {
  return (
    <ContentCard as="section" labelledBy={id} className={cn("flex min-w-0 flex-col gap-4", bareOnPhone && "max-sm:gap-2.5 max-sm:border-0 max-sm:bg-transparent max-sm:p-0 max-sm:shadow-none", className)}>
      <SectionHeader
        variant="card"
        // One line: a long description wraps inside the title block, and "View all" stays at the right of it.
        className="flex-nowrap items-start [&>:first-child]:flex-1"
        id={id}
        title={title}
        description={description}
        actions={
          href && (
            <Link
              href={href}
              className="-my-2.5 -mr-2 inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm text-foreground/80 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              View all
              {what && <span className="sr-only"> {what}</span>}
              <ChevronRight aria-hidden className="size-3.5" />
            </Link>
          )
        }
      />
      {children}
      {footer && <div className="flex justify-between gap-2.5 border-t border-hairline pt-3 text-[13px] text-muted-foreground tabular-nums">{footer}</div>}
    </ContentCard>
  )
}
