"use client"

import { formatYearMonth, isoDate } from "@alter-ego/kernel/dates"
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
import { useQueryClient } from "@tanstack/react-query"
import { format, parseISO } from "date-fns"
import { Clock, Loader2, MoreHorizontal, Pencil, Trash2 } from "lucide-react"
import Link from "next/link"
import { useId, useRef, useState, type RefObject } from "react"

import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog"
import { AmendContractDialog } from "@/components/crm/amend-contract-dialog"
import { ContractMarginTable, MarginPill, type ContractMargin } from "@/components/crm/contract-margin"
import { EngagementFormDialog } from "@/components/crm/engagement-form-dialog"
import { useCreateClient } from "@/hooks/use-clients"
import { useCreateEngagement, useDeleteEngagement, useUpdateEngagement } from "@/hooks/use-engagements"
import { fetchTimecards, useTimecards } from "@/hooks/use-timecards"
import {
  allocationsAfterEnd,
  closingEndDate,
  contractDays,
  contractEndDate,
  contractUnit,
  countIn,
  endBeforeAmendmentError,
  endFields,
  engagementLabel,
  engagementRateLabel,
  hoursToDays,
  inContractUnit,
  isOverBudget,
  rateIn,
  rateSteps,
  runOutMonth,
  timecardsAfterEnd,
  unitNoun,
} from "@/lib/engagements"
import { eurCents } from "@/lib/invoices"
import { MEETING_HEALTH, formatMeetingDate } from "@/lib/meetings"


import type { EngagementBurnDown } from "@/lib/engagement-burndown"
import type { ContractUsage } from "@/lib/engagements"
import type { BillingLine, PlannedMonth } from "@/lib/invoices"
import type { Allocation, Client, ContractUnit, Engagement, Invoice, Meeting } from "@/types"

export type ContractAction = "edit" | "amend" | "delete"

/** What a card needs of the shared dialogs: open one, and whether its own is on its way or failed. */
export interface ContractActions {
  ask: (action: ContractAction, engagement: Engagement, opener: HTMLElement | null) => void
  status: (engagementId: string) => { action: ContractAction; status: "loading" | "failed" } | undefined
}

/**
 * The contract dialogs (New, Edit, Amend, Delete or Close), one set per page. Edit, Amend and Delete
 * open only once the hours and invoices are fetched anew: hours lock the rate, forbid a delete and,
 * with the invoices, decide what an amendment reprices, and chat may have just written either.
 * Meanwhile the card's button spins; a failure shows in the card. Focus goes back to the button
 * that opened a dialog, or to the More button when a menu item did (the item is gone by then).
 */
export function useContractActions({
  userId,
  clients,
  engagements,
  allocations,
  invoices,
  fallbackFocus,
}: {
  userId: string | undefined
  clients: Client[]
  engagements: Engagement[]
  allocations: Allocation[]
  invoices: Invoice[]
  /** Where focus goes when the opener is gone (a closed contract folds away with its buttons). */
  fallbackFocus?: RefObject<HTMLElement | null>
}) {
  const createClient = useCreateClient(userId)
  const createEngagement = useCreateEngagement(userId)
  const updateEngagement = useUpdateEngagement(userId)
  const deleteEngagement = useDeleteEngagement(userId)
  const queryClient = useQueryClient()

  // New Contract; Edit opens through `asked`. editingEngagement outlives the dialog, so its title holds while it fades.
  const [engagementFormOpen, setEngagementFormOpen] = useState(false)
  const [editingEngagement, setEditingEngagement] = useState<Engagement | null>(null)
  // A new contract from a client's page starts on that client.
  const [prefill, setPrefill] = useState<{ clientId: string } | null>(null)
  const [asked, setAsked] = useState<{
    action: ContractAction
    engagement: Engagement
    /** Which click: a slower answer to an earlier one never opens or fails this one. */
    ask: number
    status: "loading" | "open" | "failed"
  } | null>(null)
  // No DialogTrigger on these dialogs: focus goes back to the button that opened one by hand.
  const opener = useRef<HTMLElement | null>(null)
  const asks = useRef(0)
  const restoreFocus = (event: Event) => {
    event.preventDefault()
    if (opener.current?.isConnected) opener.current.focus()
    else fallbackFocus?.current?.focus()
  }
  const shown = (action: ContractAction) => (asked?.status === "open" && asked.action === action ? asked.engagement : null)
  const deletingEngagement = shown("delete")
  // By id: after a Remove the dialog stays open on the contract as it now reads.
  const amending = engagements.find((e) => e.id === shown("amend")?.id) ?? null
  // Only the dialogs read the hours (past a new end, the rate lock, a delete, a reprice); a page that
  // never shows them never waits for them. The client page has them already, from the same query.
  const { data: timecards = [] } = useTimecards(asked || editingEngagement ? userId : undefined)

  function ask(action: ContractAction, engagement: Engagement, from: HTMLElement | null) {
    if (!userId) return
    opener.current = from
    if (action === "edit") setEditingEngagement(engagement)
    const ask = ++asks.current
    const settle = (status: "open" | "failed") => setAsked((cur) => (cur?.ask === ask ? { ...cur, status } : cur))
    setAsked({ action, engagement, ask, status: "loading" })
    Promise.all([
      fetchTimecards(queryClient, userId),
      queryClient.refetchQueries({ queryKey: ["invoices", userId] }, { throwOnError: true }),
    ]).then(
      () => settle("open"),
      () => settle("failed"),
    )
  }

  function newContract(from: HTMLElement | null, clientId?: string) {
    opener.current = from
    setAsked(null)
    setEditingEngagement(null)
    setPrefill(clientId ? { clientId } : null)
    setEngagementFormOpen(true)
  }

  async function handleCreateClient(name: string): Promise<string> {
    const created = await createClient.mutateAsync({ name })
    return created.id
  }

  // A contract with hours is closed, never deleted: its hours are what the invoices are checked
  // against. The dialog has three modes: Delete (no hours), Close (hours, active), explain (hours, closed).
  const deletingHours = deletingEngagement
    ? Math.round(
        timecards.filter((t) => t.engagementId === deletingEngagement.id).reduce((h, t) => h + t.hours, 0) * 100,
      ) / 100
    : 0
  const closing = deletingHours > 0 && !!deletingEngagement?.isActive
  const hoursSentence = deletingEngagement
    ? `“${engagementLabel(deletingEngagement)}” has ${deletingHours} h logged, so it can’t be deleted: its hours are what the client’s invoices are checked against.`
    : ""
  // What a closed contract keeps still counts, as the form and update_engagement warn: hours past
  // its last day bill once their day passes (no last day: all of them), plan rows past its month stay revenue.
  const lastDay =
    !deletingEngagement || deletingHours === 0
      ? null
      : closing
        ? closingEndDate(deletingEngagement, isoDate(new Date()))
        : contractEndDate(deletingEngagement)
  // Refused, as Edit and update_engagement refuse it: closing today must not strand a later amendment.
  const closeError = closing ? endBeforeAmendmentError(deletingEngagement, lastDay?.slice(0, 7) ?? null, "app") : null
  const lateHours =
    deletingEngagement && deletingHours > 0 ? timecardsAfterEnd(timecards, deletingEngagement.id, lastDay ?? "") : []
  const lateTotal = Math.round(lateHours.reduce((h, t) => h + t.hours, 0) * 100) / 100
  const lateDays = deletingEngagement && lastDay ? allocationsAfterEnd(allocations, deletingEngagement.id, lastDay.slice(0, 7)) : []
  const leftoverSentence =
    (lateHours.length > 0
      ? ` ${lastDay ? `${lateTotal} h dated after its last day` : `With no last day, all ${lateTotal} h`} (` +
        [...new Set([lateHours[0], lateHours.at(-1)!].map((t) => format(parseISO(t.date), "d MMM")))].join(" – ") +
        `) still bill once their day passes: clear them on Plan if they won’t happen` +
        (lateTotal === deletingHours ? ", and it can then be deleted." : ".")
      : "") +
    (lateDays.length > 0
      ? ` ${inContractUnit(lateDays.reduce((d, a) => d + a.days, 0), contractUnit(deletingEngagement!))} ${unitNoun(contractUnit(deletingEngagement!))} planned after ${formatYearMonth(lastDay!.slice(0, 7), "MMM yyyy")} still count as revenue: zero them in the Plan grid if they won’t happen.`
      : "")

  const dialogs = (
    <>
      <p aria-live="polite" className="sr-only">
        {asked?.status === "loading" ? "Loading the logged hours…" : ""}
      </p>

      <EngagementFormDialog
        open={engagementFormOpen || !!shown("edit")}
        onOpenChange={(open) => {
          if (open) return
          setEngagementFormOpen(false)
          setAsked(null)
        }}
        onCloseAutoFocus={restoreFocus}
        engagement={editingEngagement}
        prefill={prefill}
        allocations={allocations}
        timecards={timecards}
        clients={clients}
        onCreateClient={handleCreateClient}
        isPending={createEngagement.isPending || updateEngagement.isPending}
        onSubmit={(values) => {
          if (editingEngagement) {
            updateEngagement.mutate({ id: editingEngagement.id, input: values }, { onSuccess: () => setAsked(null) })
          } else {
            createEngagement.mutate(values, { onSuccess: () => setEngagementFormOpen(false) })
          }
        }}
      />

      <AmendContractDialog
        engagement={amending}
        clientName={clients.find((c) => c.id === amending?.clientId)?.name ?? ""}
        onOpenChange={(open) => !open && setAsked(null)}
        onCloseAutoFocus={restoreFocus}
        engagements={engagements}
        allocations={allocations}
        invoices={invoices}
        timecards={timecards}
        isPending={updateEngagement.isPending}
        onSubmit={(input, onSuccess) => amending && updateEngagement.mutate({ id: amending.id, input }, { onSuccess })}
      />

      {/* Opens once the hours are in: never offer Delete on data that has not loaded. */}
      <ConfirmDeleteDialog
        open={!!deletingEngagement}
        onOpenChange={(open) => !open && setAsked(null)}
        onCloseAutoFocus={restoreFocus}
        title={closing ? "Close Contract" : "Delete Contract"}
        description={
          deletingHours === 0
            ? "It leaves the plan and the projection, along with its allocations. Its tasks and meetings stay with the client. So do its invoices."
            : closeError
              ? `${hoursSentence} ${closeError}`
            : closing
              ? `${hoursSentence} Close it instead — it keeps its hours and invoices, and takes no new hours after its last day.${leftoverSentence}`
              : `${hoursSentence} It is closed already, which keeps them as history.${leftoverSentence}`
        }
        isPending={deleteEngagement.isPending || updateEngagement.isPending}
        confirmLabel={closing ? "Close Contract" : "Delete"}
        pendingLabel={closing ? "Closing..." : "Deleting..."}
        onConfirm={
          !deletingEngagement ? undefined
          : deletingHours === 0 ? () =>
              deleteEngagement.mutate(deletingEngagement.id, {
                onSuccess: () => setAsked(null),
                // Hours logged since the click: the adapter refused. The action has closed the
                // dialog, so fetch them again and reopen it, as Close.
                onError: () => ask("delete", deletingEngagement, opener.current),
              })
          : closing && !closeError ? () =>
              // The same close as update_engagement, so the page and chat end a contract alike.
              updateEngagement.mutate(
                {
                  id: deletingEngagement.id,
                  input: { isActive: false, ...endFields(closingEndDate(deletingEngagement, isoDate(new Date()))) },
                },
                { onSuccess: () => setAsked(null) },
              )
          : undefined
        }
      />
    </>
  )

  const actions: ContractActions = {
    ask,
    status: (engagementId) =>
      asked && asked.status !== "open" && asked.engagement.id === engagementId
        ? { action: asked.action, status: asked.status }
        : undefined,
  }
  return { actions, newContract, cancel: () => setAsked(null), dialogs }
}

/**
 * The days line under the name: "8 days/month × €520 · 80 days · runs out Apr 2027", then each later
 * refill and the newest rate. One text node: tests and people read it as one sentence.
 */
function metaLine(engagement: Engagement, exhaustionMonth: string | null, currentMonth: string, runsOut: string | null): string {
  const total = contractDays(engagement)
  const signed = engagement.contractedDays ?? 0
  const unit = contractUnit(engagement)
  const q = (n: number) => inContractUnit(n, unit)
  const budget = total === null ? "" : `${countIn(total, unit)}${total !== signed ? ` (${q(signed)} + ${q(total - signed)})` : ""}`
  const latestRate = rateSteps(engagement.amendments).at(-1)
  // Days dated after the budget ran out: the "ran out" is not the end.
  const refills = exhaustionMonth
    ? (engagement.amendments ?? []).filter((a) => a.addedDays !== null && a.from > exhaustionMonth)
    : []
  return [
    engagement.name?.trim() && engagementRateLabel(engagement),
    total === null
      ? "Time and materials, no cap"
      : runsOut
        ? `${budget} · ${runsOut < currentMonth ? "ran out" : "runs out"} ${formatYearMonth(runsOut, "MMM yyyy")}`
        : `${budget} contracted`,
    ...refills.map((a) => `+${countIn(a.addedDays!, unit)} from ${formatYearMonth(a.from, "MMM yyyy")}`),
    latestRate && `${rateIn(latestRate.dailyRate, unit)} from ${formatYearMonth(latestRate.from, "MMM yyyy")}`,
  ]
    .filter(Boolean)
    .join(" · ")
}


/**
 * The contract's days as one bar: a block per month, as wide as its days, dark for the days used and
 * light for the days the plan still holds. Decorative, with the same story as its label.
 */
function DaysBar({
  usage,
  unit,
  exhaustionMonth,
  currentMonth,
}: {
  usage: ContractUsage
  unit: ContractUnit
  exhaustionMonth: string | null
  currentMonth: string
}) {
  const { total, used, left, months } = usage
  if (months.length === 0) return null
  // The bar is told in the contract's unit: an hourly one counts hours, never days.
  const q = (n: number) => inContractUnit(n, unit)
  const short = unit === "hour" ? "h" : "d"
  const noun = unitNoun(unit)
  const blockDays = (m: (typeof months)[number]) => Math.max(m.used, m.planned)
  const past = months.filter((m) => m.yearMonth < currentMonth)
  const now = months.find((m) => m.yearMonth === currentMonth)
  const ahead = months.filter((m) => m.yearMonth > currentMonth)
  const month = (ym: string) => formatYearMonth(ym, "MMMM")
  const ranOut = exhaustionMonth !== null && exhaustionMonth < currentMonth
  const overBudget = isOverBudget(usage)
  const label = [
    `Contract ${noun} by month.`,
    (past.length > 0 || now) &&
      `Used: ${[...past.map((m) => `${month(m.yearMonth)} ${q(m.used)}`), ...(now ? [`${month(now.yearMonth)} ${q(now.used)} of ${q(now.planned)} so far`] : [])].join(", ")}.`,
    ahead.length > 0 && `Planned: ${ahead.map((m) => `${month(m.yearMonth)} ${q(m.planned)}`).join(", ")}.`,
    exhaustionMonth && `The ${q(total)} ${noun} ${ranOut ? "ran" : "run"} out in ${formatYearMonth(exhaustionMonth, "MMMM yyyy")}.`,
  ]
    .filter(Boolean)
    .join(" ")
  const first = months[0].yearMonth
  const last = months.at(-1)!.yearMonth
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm">
        <p>
          <span className="font-semibold tabular-nums">
            {unit === "hour" ? `${q(used)} h of ${q(total)} h used` : `${q(used)} of ${q(total)} days used`}
          </span>
          <span className="text-subtle-foreground tabular-nums"> · {total ? Math.round((used / total) * 100) : 0}%</span>
        </p>
        <p className="text-subtle-foreground tabular-nums">
          {overBudget ? (
            <span className="font-medium text-danger">
              {countIn(used - total, unit)} over budget
            </span>
          ) : (
            `${countIn(left, unit)} left at plan`
          )}
          {exhaustionMonth && (
            <>
              {` · ${ranOut ? "ran" : "runs"} out `}
              <span className="font-semibold text-foreground">{formatYearMonth(exhaustionMonth, "MMM yyyy")}</span>
            </>
          )}
        </p>
      </div>
      <div role="img" aria-label={label} className="flex flex-col gap-1.5">
        <div aria-hidden className="flex gap-1">
          {months.map((m) => {
            const width = blockDays(m)
            const fill = width ? Math.min(m.used / width, 1) : 0
            return (
              <span
                key={m.yearMonth}
                className={cn("h-2.5 min-w-1 rounded-[3px]", fill === 1 ? "bg-primary" : "bg-border")}
                style={{
                  flex: `${width} 1 0%`,
                  ...(fill > 0 && fill < 1 && {
                    background: `linear-gradient(90deg, hsl(var(--primary)) ${fill * 100}%, hsl(var(--border)) 0)`,
                  }),
                }}
              />
            )
          })}
        </div>
        {/* A label under each block from sm up; a phone has room for the two ends only. */}
        <div aria-hidden className="hidden gap-1 font-mono text-[11px] leading-4 text-muted-foreground sm:flex">
          {months.map((m) => {
            const strong = m.yearMonth === currentMonth || m.yearMonth === exhaustionMonth
            return (
              <span key={m.yearMonth} className={cn("min-w-1 truncate", strong && "font-semibold text-foreground")} style={{ flex: `${blockDays(m)} 1 0%` }}>
                {formatYearMonth(m.yearMonth, "MMM")}
                <br />
                {m.yearMonth === currentMonth ? `${q(m.used)} of ${q(m.planned)}` : `${q(m.yearMonth < currentMonth ? m.used : m.planned)} ${short}`}
              </span>
            )
          })}
        </div>
        <div aria-hidden className="flex justify-between font-mono text-[11px] text-muted-foreground sm:hidden">
          <span>{formatYearMonth(first, "MMM yyyy")}</span>
          {last !== first && <span className="font-semibold text-foreground">{formatYearMonth(last, "MMM yyyy")}</span>}
        </div>
      </div>
      <p aria-hidden className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-subtle-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-[2px] bg-primary" />
          Used
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-[2px] bg-border" />
          Planned
        </span>
        <span className="text-muted-foreground">
          <span className="max-sm:hidden">
            {formatYearMonth(first, "MMM yyyy")} to {formatYearMonth(last, "MMM yyyy")},{" "}
          </span>
          one block per month<span className="max-sm:hidden">, width by {noun}</span>
        </span>
      </p>
    </div>
  )
}

interface ContractCardProps {
  engagement: Engagement
  /** The plan's burn-down: when its days run out. */
  burn: EngagementBurnDown | undefined
  /** Its newest verbale that states a light. A closed contract shows none. */
  health: Meeting | undefined
  /** Days used and planned month by month: only a page that reads the hours has them. */
  usage?: ContractUsage | null
  /** The current month's hours and the plan's next months, from the client page. */
  progress?: { line: BillingLine | undefined; planned: PlannedMonth[] }
  /** Only a contract with a collaborator on it: this quarter's margin and who used what. */
  margin?: ContractMargin
  actions: ContractActions
}

/**
 * A contract (Client.dc): its name with its light, the days line, the days bar, and this month
 * against the plan. Log Time and Amend Contract in sight; Edit and Delete behind More.
 */
export function ContractCard({ engagement, burn, health, usage, progress, margin, actions }: ContractCardProps) {
  const titleId = useId()
  const more = useRef<HTMLButtonElement>(null)
  const currentMonth = format(new Date(), "yyyy-MM")
  const label = engagementLabel(engagement)
  const state = actions.status(engagement.id)
  const loading = (action: ContractAction) => state?.status === "loading" && state.action === action
  const lastDay = contractEndDate(engagement)
  const light = engagement.isActive && health?.health ? health : undefined
  // Worked past the budget, "runs out" is no longer news: the card says "over budget" instead.
  const exhaustionMonth = burn?.exhaustionMonth ?? null
  const runsOut = runOutMonth(usage, exhaustionMonth)
  const now = progress?.planned.find((p) => p.yearMonth === currentMonth)
  const upcoming = progress?.planned.filter((p) => p.yearMonth > currentMonth) ?? []
  const hours = progress?.line?.hours ?? 0
  const unit = contractUnit(engagement)
  const short = unit === "hour" ? "h" : "d"

  return (
    <ContentCard labelledBy={titleId} className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
            <h3 id={titleId} className="text-lg leading-snug font-semibold tracking-[-0.01em] [overflow-wrap:anywhere] sm:text-[19px]">
              {label}
            </h3>
            {!engagement.isActive && (
              <StatusPill>
                Closed
                {lastDay && ` · ended ${format(parseISO(lastDay), "d MMM yyyy")}`}
              </StatusPill>
            )}
            {margin && <MarginPill margin={margin.total} quarter={margin.quarter} />}
            {light?.health && (
              <span title={`Status from the meeting on ${formatMeetingDate(light.date)}`}>
                <StatusPill tone={MEETING_HEALTH[light.health].tone}>
                  {MEETING_HEALTH[light.health].label} · {formatMeetingDate(light.date, "d MMM")}
                </StatusPill>
              </span>
            )}
          </div>
          <p className="text-sm text-subtle-foreground [overflow-wrap:anywhere]">{metaLine(engagement, exhaustionMonth, currentMonth, runsOut)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {engagement.isActive && (
            <Button asChild variant="outline" size="lg" className="px-3.5">
              <Link href="/plan">
                <Clock aria-hidden />
                Log Time
              </Link>
            </Button>
          )}
          <Button
            variant="outline"
            size="lg"
            className="px-3.5"
            // Not disabled: a disabled button drops the keyboard focus to the page.
            aria-busy={loading("amend") || undefined}
            onClick={(ev) => actions.ask("amend", engagement, ev.currentTarget)}
          >
            {loading("amend") && <Loader2 aria-hidden className="animate-spin" />}
            Amend Contract
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                ref={more}
                variant="ghost"
                size="icon-lg"
                aria-label={`More actions for ${label}`}
                aria-busy={loading("edit") || loading("delete") || undefined}
              >
                {loading("edit") || loading("delete") ? <Loader2 aria-hidden className="animate-spin" /> : <MoreHorizontal aria-hidden />}
              </Button>
            </DropdownMenuTrigger>
            {/* The menu hands focus back to More while the hours load (or fail); a dialog that opens takes it, and gives it back to More. */}
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => actions.ask("edit", engagement, more.current)}>
                <Pencil aria-hidden /> Edit Contract
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onSelect={() => actions.ask("delete", engagement, more.current)}>
                <Trash2 aria-hidden /> Delete Contract
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {usage && <DaysBar usage={usage} unit={unit} exhaustionMonth={runsOut} currentMonth={currentMonth} />}

      {margin && <ContractMarginTable margin={margin} />}

      {progress && (progress.line || now || upcoming.length > 0) && (
        <div className="flex flex-col gap-1 border-t border-hairline pt-4 text-sm">
          {(progress.line || now) && (
            <p>
              {formatYearMonth(currentMonth, "MMMM")} in progress: {hours} h
              {unit === "day" && ` · ${Number(hoursToDays(hours).toFixed(2))} d`}
              {now && ` of ${inContractUnit(now.days, unit)} ${short} planned`}
            </p>
          )}
          {upcoming.length > 0 && (
            <p className="text-subtle-foreground">
              Planned: {upcoming.map((p) => `${formatYearMonth(p.yearMonth, "MMM")} ${inContractUnit(p.days, unit)} ${short}`).join(" · ")} —{" "}
              {eurCents(upcoming.reduce((sum, p) => sum + p.value, 0))} (from the plan, not hours)
            </p>
          )}
        </div>
      )}

      {state?.status === "failed" && (
        <p role="alert" className="text-sm text-destructive">
          Couldn&apos;t load the logged hours and invoices, so this contract can&apos;t be changed right now. Try again in a
          moment.
        </p>
      )}
    </ContentCard>
  )
}
