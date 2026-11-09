"use client"

import { eur } from "@alter-ego/kernel/currency"
import { formatYearMonth } from "@alter-ego/kernel/dates"
import { ContentCard } from "@alter-ego/ui/page/content-card"
import { StatusPill } from "@alter-ego/ui/page/status-pill"
import { Button } from "@alter-ego/ui/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@alter-ego/ui/ui/dropdown-menu"
import { cn } from "@alter-ego/ui/utils"
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react"
import { useRef } from "react"

import { AssignmentMeter } from "@/components/crm/assignment-meter"
import { quarterCost, quarterNote, summarizeFee } from "@/lib/collaborators"
import { contractUnit, rateIn } from "@/lib/engagements"


import type { AssignmentUsage } from "@/lib/assignments"
import type { QuarterBlock } from "@/lib/collaborator-invoices"
import type { Assignment, Collaborator, CollaboratorFee, Engagement } from "@/types"

const mon = (m: string) => formatYearMonth(m, "MMM yyyy")
const TYPE_LABEL = { freelancer: "Freelancer", company: "Company" } as const

export interface QuarterRef {
  year: number
  q: 1 | 2 | 3 | 4
}

/** "€2,400 a month since Jan 2026 · €2,600 from Mar 2027 · no end": the fee today, its next change, its end. */
export function feeLine(fee: CollaboratorFee | null, currentMonth: string): string {
  if (!fee) return "No fixed fee"
  const { today, next, ends } = summarizeFee(fee, currentMonth)
  if (currentMonth < fee.from) return `${eur(fee.amount)} a month from ${mon(fee.from)}${ends ? ` · ends ${mon(ends)}` : ""}`
  if (ends && ends < currentMonth) return `${eur(fee.changes.at(-1)?.amount ?? fee.amount)} a month · ended ${mon(ends)}`
  const started = [...fee.changes].reverse().find((c) => c.from <= currentMonth)?.from ?? fee.from
  const parts = [`${eur(today)} a month ${started < currentMonth ? "since" : "from"} ${mon(started)}`]
  if (next) parts.push(`${eur(next.amount)} from ${mon(next.from)}`)
  parts.push(ends ? `ends ${mon(ends)}` : "no end")
  return parts.join(" · ")
}

function Figure({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="flex min-w-0 flex-col items-start gap-1">
      <span className="text-[12.5px] text-muted-foreground">{label}</span>
      <span className="text-[19px] leading-tight font-semibold tracking-[-0.01em] tabular-nums sm:text-xl">{value}</span>
      <span className="text-meta text-subtle-foreground">{detail}</span>
    </div>
  )
}

/** One contract the collaborator is on: the assignment, its contract's name, and what it has used. */
export interface OnContract {
  assignment: Assignment
  engagement: Pick<Engagement, "unit">
  name: string
  usage: AssignmentUsage
}

/** Planned variable cost and days in a quarter, from their assignments. */
export interface VariablePlan {
  cost: number
  days: number
}

/** The card's invoiced against plan: the latest quarter with ended months, a line per month and a pill. */
function InvoicedBlock({ block, earlier }: { block: QuarterBlock; earlier?: QuarterBlock | null }) {
  const short = (ym: string) => formatYearMonth(ym, "MMM")
  return (
    <div role="group" aria-label="Invoiced against plan" className="space-y-2 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
        <p className="tabular-nums">
          <span className="text-muted-foreground">{block.title}: invoiced </span>
          <span className="font-medium">{eur(block.invoiced)}</span> of {eur(block.plan)}
        </p>
        <StatusPill tone={block.missing.length ? "warning" : "success"}>
          {block.missing.length ? `${block.missing.map(short).join(", ")} not invoiced` : "All invoiced"}
        </StatusPill>
      </div>
      <ul className="space-y-1 tabular-nums text-subtle-foreground">
        {block.months.map((m) => {
          const what = [short(m.yearMonth), m.invoices.map((i) => i.ref).filter(Boolean).join(", "), m.days > 0 ? `${m.days} ${m.days === 1 ? "day" : "days"}` : ""]
          return (
            <li key={m.yearMonth} className="flex justify-between gap-3">
              <span>{what.filter(Boolean).join(" · ")}</span>
              <span className={cn(m.gap > 0 && "text-warning-soft-foreground")}>
                {m.gap > 0 ? `${m.invoiced > 0 ? eur(m.invoiced) : "—"} of ${eur(m.plan)}` : `${eur(m.invoiced)} ✓`}
              </span>
            </li>
          )
        })}
      </ul>
      {earlier && (
        <p className="tabular-nums text-warning-soft-foreground">
          {earlier.title}: {eur(earlier.gap)} not invoiced ({earlier.missing.map(short).join(", ")})
        </p>
      )}
    </div>
  )
}

interface Props {
  collaborator: Collaborator
  onContracts?: OnContract[]
  /** Their variable cost this quarter and next; the fixed fee is added to each figure. */
  variable?: { thisQuarter: VariablePlan; nextQuarter: VariablePlan }
  /** What they invoiced against the plan in the latest quarter with ended months; null = nothing planned or invoiced. */
  invoiced?: QuarterBlock | null
  /** The quarter before it, while it still has months not invoiced. */
  earlier?: QuarterBlock | null
  currentMonth: string
  thisQuarter: QuarterRef
  nextQuarter: QuarterRef
  onEdit: (from: HTMLElement | null) => void
  onDelete: (from: HTMLElement | null) => void
}

/** A collaborator: who and what kind, the fee today, and its fixed cost this quarter and next. */
export function CollaboratorCard({ collaborator: c, onContracts = [], variable, invoiced, earlier, currentMonth, thisQuarter, nextQuarter, onEdit, onDelete }: Props) {
  const more = useRef<HTMLButtonElement>(null)
  const titleId = `collaborator-${c.id}`
  // The mockup's inactive card swaps Next quarter for its Notes, which then are not repeated below.
  const notesInPlace = !c.isActive && !!c.notes
  const label = (r: QuarterRef) => `Q${r.q} ${r.year}`
  const total = (r: QuarterRef, v?: VariablePlan) => quarterCost(c, r.year, r.q) + (c.isActive ? (v?.cost ?? 0) : 0)
  const detail = (r: QuarterRef, v?: VariablePlan) =>
    `${label(r)}, ${c.isActive && v && v.days > 0 ? `${Number(v.days.toFixed(2))} days planned` : quarterNote(c, r.year, r.q)}`
  return (
    <ContentCard labelledBy={titleId} className="flex min-w-0 flex-col gap-3 sm:gap-3.5">
      <div className="flex min-h-7 items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={titleId} className="text-lg leading-snug font-semibold tracking-[-0.01em] [overflow-wrap:anywhere] sm:text-[19px]">
            {c.name}
          </h2>
          <p className="text-meta text-muted-foreground">{TYPE_LABEL[c.type]}</p>
        </div>
        <span className="flex shrink-0 items-center gap-1">
          <StatusPill tone={c.isActive ? "success" : "neutral"}>{c.isActive ? "Active" : "Inactive"}</StatusPill>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button ref={more} variant="ghost" size="icon" className="-my-1 -mr-2.5 pointer-coarse:-my-2" aria-label={`More actions for ${c.name}`}>
                <MoreHorizontal aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => onEdit(more.current)}>
                <Pencil aria-hidden /> Edit Collaborator
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onSelect={() => onDelete(more.current)}>
                <Trash2 aria-hidden /> Delete Collaborator
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </span>
      </div>

      <p className="text-sm leading-[1.45] text-subtle-foreground tabular-nums [overflow-wrap:anywhere]">{feeLine(c.fee, currentMonth)}</p>

      {onContracts.map((o) => (
        <div key={o.assignment.id} className="space-y-1.5 text-sm">
          <p className="leading-[1.45] text-subtle-foreground tabular-nums [overflow-wrap:anywhere]">
            On {o.name} at {rateIn(o.assignment.dailyRate, contractUnit(o.engagement))}, {mon(o.assignment.from)} to {o.assignment.until ? mon(o.assignment.until) : "contract end"}
          </p>
          <AssignmentMeter label={`${contractUnit(o.engagement) === "hour" ? "Hours" : "Days"} used on ${o.name}`} usage={o.usage} unit={contractUnit(o.engagement)} />
        </div>
      ))}

      <div className="grid grid-cols-2 gap-3 border-y border-hairline py-3 sm:gap-4 sm:py-3.5">
        <Figure label="This quarter" value={eur(total(thisQuarter, variable?.thisQuarter))} detail={detail(thisQuarter, variable?.thisQuarter)} />
        {notesInPlace ? (
          <div className="flex min-w-0 flex-col items-start gap-1">
            <span className="text-[12.5px] text-muted-foreground">Notes</span>
            <span className="text-sm leading-[1.45] text-subtle-foreground [overflow-wrap:anywhere]">{c.notes}</span>
          </div>
        ) : (
          <Figure label="Next quarter" value={eur(total(nextQuarter, variable?.nextQuarter))} detail={detail(nextQuarter, variable?.nextQuarter)} />
        )}
      </div>

      {invoiced && <InvoicedBlock block={invoiced} earlier={earlier} />}

      {c.notes && !notesInPlace && <p className="text-meta leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">{c.notes}</p>}
    </ContentCard>
  )
}
