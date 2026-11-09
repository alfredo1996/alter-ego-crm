"use client"

import { formatYearMonth } from "@alter-ego/kernel/dates"
import { ContentCard, stretchedLink } from "@alter-ego/ui/page/content-card"
import { StatusDot } from "@alter-ego/ui/page/meta-row"
import { StatusPill } from "@alter-ego/ui/page/status-pill"
import { Button } from "@alter-ego/ui/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@alter-ego/ui/ui/dropdown-menu"
import { cn } from "@alter-ego/ui/utils"
import { format } from "date-fns"
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react"
import Link from "next/link"
import { useRef } from "react"


import { rateAt } from "@/lib/engagement-burndown"
import { engagementLabel, engagementRateLabel } from "@/lib/engagements"
import { eurCents, isInvoiceOverdue, outstanding } from "@/lib/invoices"
import { MEETING_HEALTH } from "@/lib/meetings"
import { STAGE_LABELS, nextFollowUp, weightedMonthlyValue } from "@/lib/opportunities"
import { shortDay } from "@/lib/solutions"
import { isTaskOverdue } from "@/lib/tasks"
import { isModuleOn } from "@/modules"

import type { Client, Engagement, Invoice, Meeting, Opportunity, Task } from "@/types"
import type { Tone } from "@alter-ego/ui/page/status-pill"
import type { ReactNode } from "react"

export type ClientStatus = "active" | "prospect" | "inactive"

export const CLIENT_STATUS: Record<ClientStatus, { label: string; tone: Tone }> = {
  active: { label: "Active", tone: "success" },
  prospect: { label: "Prospect", tone: "info" },
  inactive: { label: "Inactive", tone: "neutral" },
}

/**
 * Inactive by its own flag; otherwise active while it has an active contract, and a prospect with
 * none, closed ones included (the MCP's rule, crm-write.ts). The catalog and the client's page share it.
 */
export function clientStatus(client: Pick<Client, "id" | "isActive">, engagements: Pick<Engagement, "clientId" | "isActive">[]): ClientStatus {
  if (!client.isActive) return "inactive"
  return engagements.some((e) => e.clientId === client.id && e.isActive) ? "active" : "prospect"
}

/** A contract's € a month at plan: the rate in force this month (list_clients' formula). */
export const monthlyAtPlan = (e: Engagement, yearMonth: string) => e.defaultDaysPerMonth * rateAt(e, yearMonth)

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const day = (date: string) => shortDay(new Date(`${date}T00:00:00`))
/** Above the stretched title link: a link or button inside the card stays its own target. */
const ABOVE = "relative z-10"
const LINK = "rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"

/** One of the card's two figures: label, value, then a line or a pill. A link when it leads somewhere. */
function Figure({ label, value, detail, href, "aria-label": name }: { label: string; value: ReactNode; detail: ReactNode; href?: string; "aria-label"?: string }) {
  const body = (
    <>
      <span className="text-[12.5px] text-muted-foreground">{label}</span>
      <span className="text-[19px] leading-tight font-semibold tracking-[-0.01em] tabular-nums sm:text-xl">{value}</span>
      <span className="text-meta text-subtle-foreground">{detail}</span>
    </>
  )
  const box = "flex min-w-0 flex-col items-start gap-1 [overflow-wrap:anywhere]"
  return href ? (
    <Link href={href} aria-label={name} className={cn(box, ABOVE, LINK, "hover:[&>span:nth-child(2)]:underline")}>
      {body}
    </Link>
  ) : (
    <div className={box}>{body}</div>
  )
}

interface ClientCardProps {
  client: Client
  status: ClientStatus
  /** The client's own records: contracts (any), invoices, open deals, open tasks and meetings. */
  contracts: Engagement[]
  invoices: Invoice[]
  deals: Opportunity[]
  openTasks: Task[]
  meetings: Meeting[]
  solutions: number
  /** The plan's burn-down: the month a contract's days run out, if they do. */
  exhaustionMonth: (engagementId: string) => string | null
  onEdit: (from: HTMLElement | null) => void
  onDelete: (from: HTMLElement | null) => void
}

/**
 * A client in the catalog (Clients.dc): who you talk to and its state, the name (the link to its
 * page, stretched over the card), the last meeting's light, the main contract, then two figures:
 * what it brings a month and what it owes, or for a prospect its deals and next step. Contracts,
 * tasks and meetings are worked on the client's page; Edit and Delete wait behind More.
 */
export function ClientCard({
  client,
  status,
  contracts,
  invoices,
  deals,
  openTasks,
  meetings,
  solutions,
  exhaustionMonth,
  onEdit,
  onDelete,
}: ClientCardProps) {
  const more = useRef<HTMLButtonElement>(null)
  const titleId = `client-${client.id}`
  const currentMonth = format(new Date(), "yyyy-MM")
  const active = contracts
    .filter((e) => e.isActive)
    .sort((a, b) => monthlyAtPlan(b, currentMonth) - monthlyAtPlan(a, currentMonth))
  const main = active[0]
  const last = meetings[0]
  // A left-out module's figures and links are not on the card: its routes redirect.
  const hasInvoicing = isModuleOn("invoicing")
  const hasSolutions = isModuleOn("solutions")
  const owed = outstanding(invoices)
  const overdue = invoices.filter((i) => isInvoiceOverdue(i)).sort((a, b) => a.dueDate!.getTime() - b.dueDate!.getTime())
  const due = invoices
    .filter((i) => !i.paidDate && i.amount > 0 && i.dueDate)
    .sort((a, b) => a.dueDate!.getTime() - b.dueDate!.getTime())[0]?.dueDate
  const lateTask = openTasks.filter((t) => isTaskOverdue(t)).sort((a, b) => a.dueDate!.getTime() - b.dueDate!.getTime())[0]
  const next = nextFollowUp(deals)
  const top = deals[0]
  const runsOut = main ? exhaustionMonth(main.id) : null

  const unpaid = (
    <Figure
      label="Unpaid"
      value={eurCents(owed)}
      href={`/clients/${client.id}#invoices`}
      aria-label={
        overdue.length > 0
          ? `Invoices: ${eurCents(owed)} unpaid · ${overdue.length} overdue`
          : owed > 0
            ? `Invoices: ${eurCents(owed)} unpaid${due ? `, due ${shortDay(due)}` : ""}`
            : "Invoices: nothing unpaid"
      }
      detail={
        overdue.length > 0 ? (
          <StatusPill tone="danger">Overdue · due {shortDay(overdue[0].dueDate!)}</StatusPill>
        ) : owed > 0 ? (
          <StatusPill tone="warning">{due ? `Due ${shortDay(due)}` : "Not due yet"}</StatusPill>
        ) : invoices.length > 0 ? (
          <StatusPill tone="success">All paid</StatusPill>
        ) : (
          <StatusPill>Nothing invoiced yet</StatusPill>
        )
      }
    />
  )

  return (
    <ContentCard
      labelledBy={titleId}
      className="flex min-w-0 flex-col gap-3 transition-colors hover:border-border-strong motion-reduce:transition-none sm:gap-3.5"
    >
      <div className="flex min-h-7 items-center justify-between gap-3">
        <span className="min-w-0 text-meta text-muted-foreground [overflow-wrap:anywhere]">{client.contactName || client.email}</span>
        <span className="flex shrink-0 items-center gap-1">
          <StatusPill tone={CLIENT_STATUS[status].tone}>{CLIENT_STATUS[status].label}</StatusPill>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                ref={more}
                variant="ghost"
                size="icon"
                className={cn(ABOVE, "-my-1 -mr-2.5 pointer-coarse:-my-2")}
                aria-label={`More actions for ${client.name}`}
              >
                <MoreHorizontal aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => onEdit(more.current)}>
                <Pencil aria-hidden /> Edit Client
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onSelect={() => onDelete(more.current)}>
                <Trash2 aria-hidden /> Delete Client
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </span>
      </div>

      {/* Still the h2, and the card's name: tests find a client by it. */}
      <h2 className="text-lg leading-snug font-semibold tracking-[-0.01em] sm:text-[19px]">
        <Link id={titleId} href={`/clients/${client.id}`} className={cn(stretchedLink, LINK, "[overflow-wrap:anywhere]")}>
          {client.name}
        </Link>
      </h2>

      <p className="text-sm text-subtle-foreground">
        {!last ? (
          <StatusDot outline>No meetings yet</StatusDot>
        ) : last.health ? (
          <StatusDot tone={MEETING_HEALTH[last.health].tone}>
            <span>
              Last meeting {MEETING_HEALTH[last.health].label.toLowerCase()} · <span className="font-mono text-meta">{day(last.date)}</span>
            </span>
          </StatusDot>
        ) : (
          <StatusDot outline>
            <span>
              Last meeting <span className="font-mono text-meta">{day(last.date)}</span> · no health set
            </span>
          </StatusDot>
        )}
      </p>

      <p className="text-sm leading-[1.45] text-subtle-foreground tabular-nums [overflow-wrap:anywhere]">
        {main ? (
          <>
            <span className="font-medium text-foreground">{engagementLabel(main)}</span>
            {main.name?.trim() && ` · ${engagementRateLabel(main)}`}
            {" · "}
            {runsOut
              ? `${runsOut < currentMonth ? "ran out" : "runs out"} ${formatYearMonth(runsOut, "MMM yyyy")}`
              : main.endMonth
                ? `ends ${formatYearMonth(main.endMonth, "MMM yyyy")}`
                : "no end date"}
            {active.length > 1 && ` · +${active.length - 1} more`}
          </>
        ) : (
          <>
            {contracts.length > 0 ? "No active contract" : "No contract yet"}
            {deals.length > 0 && ` · ${count(deals.length, "deal")} in the pipeline`}
          </>
        )}
      </p>

      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] gap-3 border-y border-hairline py-3 sm:grid-cols-2 sm:gap-4 sm:py-3.5">
        {main ? (
          <Figure label="Monthly" value={eurCents(active.reduce((sum, e) => sum + monthlyAtPlan(e, currentMonth), 0))} detail={count(active.length, "active contract")} />
        ) : (
          <Figure
            label="Weighted"
            href={deals.length > 0 ? `/pipeline?client=${client.id}` : undefined}
            value={
              <>
                {eurCents(deals.reduce((sum, o) => sum + weightedMonthlyValue(o), 0))}
                <span className="text-meta font-normal tracking-normal text-subtle-foreground">/month</span>
              </>
            }
            detail={top ? `${top.title} · ${STAGE_LABELS[top.stage]} ${top.probability}%` : "No open deals"}
          />
        )}
        {hasInvoicing && (main || invoices.length > 0) ? (
          unpaid
        ) : (
          <Figure
            label="Next step"
            value={next?.nextActionDate ? shortDay(next.nextActionDate) : "None"}
            detail={next ? next.nextActionNote || "Follow up" : "No follow-up set"}
          />
        )}
      </div>

      {/* Running text, not flex: the separators keep their spaces for a screen reader and a copy. */}
      <p className="text-meta leading-relaxed text-muted-foreground">
        {openTasks.length > 0 ? count(openTasks.length, "open task") : "No open tasks"}
        {lateTask && (
          <>
            {" "}
            <StatusPill tone="danger" className="align-middle">
              Overdue since {shortDay(lateTask.dueDate!)}
            </StatusPill>
          </>
        )}
        {hasSolutions && (
          <>
            {" · "}
            {solutions > 0 ? (
              // Edited on /solutions, filtered to this client.
              <Link
                href={`/solutions?client=${client.id}`}
                className={cn(ABOVE, LINK, "text-subtle-foreground underline underline-offset-4 hover:text-foreground pointer-coarse:-my-3 pointer-coarse:py-3")}
              >
                {count(solutions, "solution")}
              </Link>
            ) : (
              "No solutions"
            )}
          </>
        )}
        {main ? top && ` · Open deal: ${top.title}, ${top.probability}%` : hasInvoicing && invoices.length === 0 && " · Nothing invoiced yet"}
      </p>
    </ContentCard>
  )
}
