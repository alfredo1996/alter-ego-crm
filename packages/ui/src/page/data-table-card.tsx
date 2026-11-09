import { ContentCard } from "./content-card"
import { cn } from "../utils"

import type { HTMLAttributes } from "react"

/**
 * A card with no padding around a table (or a list) that runs to its edges; the first
 * and last cells line up with a card's 22 px padding.
 */
export function DataTableCard({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <ContentCard
      as="div"
      padding="none"
      className={cn("overflow-hidden sm:[&_tr>:first-child]:pl-[22px] sm:[&_tr>:last-child]:pr-[22px]", className)}
      {...props}
    />
  )
}
