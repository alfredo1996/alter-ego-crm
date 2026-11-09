"use client"

import { eurShort } from "@alter-ego/kernel/currency"
import { formatYearMonth, isoDate } from "@alter-ego/kernel/dates"
import { Button } from "@alter-ego/ui/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@alter-ego/ui/ui/dialog"
import { Input } from "@alter-ego/ui/ui/input"
import { Label } from "@alter-ego/ui/ui/label"
import { addDays, format, parseISO } from "date-fns"
import { useId, useRef, useState, type ReactNode } from "react"

import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog"
import { computeBurnDown, monthsFrom, rateAt, toRevenueSources } from "@/lib/engagement-burndown"
import {
  amendContract,
  contractDays,
  contractUsage,
  contractEndDate,
  contractUnit,
  countIn,
  engagementLabel,
  fromContractUnit,
  inContractUnit,
  rateIn,
  runOutMonth,
  toContractUnit,
} from "@/lib/engagements"
import { amendmentEffects, monthRun } from "@/lib/invoices"

import type { Allocation, ContractAmendment, ContractUnit, Engagement, Invoice, Timecard, UpdateEngagementInput } from "@/types"

const HEADING = "text-xs font-medium uppercase tracking-wide text-muted-foreground"
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/
const mon = (ym: string) => formatYearMonth(ym, "MMM yyyy")
const day = (iso: string) => format(parseISO(iso), "d MMM yyyy")

/** "€800/day · +40 days · until 31 Jan 2027 · Addendum 2": one history row, and a merge's before and after. Told in the contract's unit. */
export function amendmentTerms(a: ContractAmendment, unit: ContractUnit = "day"): string {
  return [
    a.dailyRate !== null ? rateIn(a.dailyRate, unit) : null,
    a.addedDays !== null ? `+${countIn(a.addedDays, unit)}` : null,
    a.lastDay ? `until ${day(a.lastDay)}` : null,
    a.note,
  ]
    .filter(Boolean)
    .join(" · ")
}

// amendContract and amendmentEffects speak to chat: ISO dates, the tool's parameters, the other
// tools, the engine's words. The same refusals and warnings here, in this dialog's words.
const ISO_DATE = /\b(\d{4}-(?:0[1-9]|1[0-2]))(-(?:0[1-9]|[12]\d|3[01]))?\b/g
const SCREEN_WORDS: [RegExp, string][] = [
  [/^dailyRate/, "New Day Rate"],
  [/^addDays/, "Add Days"],
  [/^from is a month as YYYY-MM, 01 to 12:/, "From is a month as YYYY-MM:"],
  [/Pass a new end \(endDate or endMonth\)/, "Set a New End Date"],
  [/use update_engagement/g, "use Edit Contract"],
  [/with update_engagement/g, "with Edit Contract"],
  [/in the web app's Edit Contract \(Clients\)/, "in Edit Contract"],
  [/fixed in the app/, "fixed in Edit Contract"],
  [/use remove\./, "use Remove."],
  // A refused Remove, its month named by the dialog: which amendment goes first, and why.
  [
    /^Removing (\w{3} \d{4}) puts the end back to ([^,]+), and the (.+) (amendments?) would then never apply: remove (?:them|it) first\./,
    "Remove the $3 $4 first: without $1 the contract ends $2, before $3.",
  ],
  // The month's invoice is the client's, every contract's days: not this contract's price.
  [/ is invoiced( ahead)? at (€[\d,.]+)/g, " is invoiced$1 ($2 across the client's contracts)"],
  [/reads as invoiced ahead/g, "is invoiced ahead"],
  [/\bstays capped\b/g, "bills less than planned"],
  [/\bstay capped\b/g, "bill less than planned"],
  [/the gap months/g, "the months in between"],
]
export const inDialogWords = (text: string) =>
  SCREEN_WORDS.reduce(
    (s, [from, to]) => s.replace(from, to),
    text.replace(ISO_DATE, (_, ym: string, d?: string) => (d ? day(ym + d) : mon(ym))),
  )

interface Props {
  /** The contract to amend; null keeps the dialog closed. */
  engagement: Engagement | null
  clientName: string
  onOpenChange: (open: boolean) => void
  /** Every contract, allocation, invoice and timecard: amendmentEffects reads the client's billing and the walk. */
  engagements: Engagement[]
  allocations: Allocation[]
  invoices: Invoice[]
  timecards: Pick<Timecard, "engagementId" | "date" | "hours">[]
  isPending: boolean
  /** One updateEngagement with amendContract's changes; onSuccess after it lands. */
  onSubmit: (changes: UpdateEngagementInput, onSuccess: () => void) => void
  /** No DialogTrigger: the caller puts focus back on the button that opened it. */
  onCloseAutoFocus?: (event: Event) => void
}

/**
 * Same work, new terms from a month on: a new day rate, more days, a later end. The
 * rules, the preview's warnings and their wording are amend_contract's (amendContract,
 * amendmentEffects), so the app and chat refuse and warn alike.
 */
export function AmendContractDialog({ engagement, onOpenChange, ...rest }: Props) {
  return (
    <Dialog open={!!engagement} onOpenChange={onOpenChange}>
      {/* Keyed: every opening starts from empty fields. */}
      {engagement && <AmendForm key={engagement.id} engagement={engagement} onOpenChange={onOpenChange} {...rest} />}
    </Dialog>
  )
}

function Field({ label, help, children }: { label: string; help: ReactNode; children: (ids: { id: string; describedBy: string }) => ReactNode }) {
  const id = useId()
  return (
    <div className="grid gap-1.5 sm:grid-cols-[9rem_1fr] sm:gap-x-4">
      <Label htmlFor={id} className="sm:pt-2.5">
        {label}
      </Label>
      <div className="min-w-0 space-y-1.5">
        {children({ id, describedBy: `${id}-help` })}
        <p id={`${id}-help`} className="text-[0.8rem] text-muted-foreground">
          {help}
        </p>
      </div>
    </div>
  )
}

function AmendForm({
  engagement: e,
  clientName,
  onOpenChange,
  engagements,
  allocations,
  invoices,
  timecards,
  isPending,
  onSubmit,
  onCloseAutoFocus,
}: Omit<Props, "engagement"> & { engagement: Engagement }) {
  const today = isoDate(new Date())
  const currentMonth = today.slice(0, 7)
  const nextMonth = monthsFrom(currentMonth, 2)[1]
  const ids = useId()
  // null: never touched, so From shows the default. "": cleared, the default again with the field left empty to retype.
  const [from, setFrom] = useState<string | null>(null)
  const [rate, setRate] = useState("")
  const [days, setDays] = useState("")
  const [lastDay, setLastDay] = useState("")
  const [note, setNote] = useState("")
  const [removing, setRemoving] = useState<ContractAmendment | null>(null)
  // No trigger for the Remove confirm either: its row's button on Cancel, the History heading once the row is gone.
  const removeFocus = useRef<HTMLElement | null>(null)
  const historyHeading = useRef<HTMLHeadingElement>(null)

  const list = e.amendments ?? []
  const end = contractEndDate(e)
  const afterEnd = end ? monthsFrom(end.slice(0, 7), 2)[1] : null
  // Next month, or the start of a contract not begun yet: amendContract refuses any month before it.
  const firstMonth = e.startMonth && e.startMonth > nextMonth ? e.startMonth : nextMonth
  const timeAndMaterials = e.contractedDays === null
  const unit = contractUnit(e)
  const hourly = unit === "hour"
  // Typed in the contract's unit, written in days.
  const shownRate = (dailyRate: number) => toContractUnit({ dailyRate, contractedDays: null, defaultDaysPerMonth: 0, unit }).rate
  const num = (s: string) => (s.trim() === "" ? undefined : Number(s))
  const typedRate = num(rate)
  const typedDays = num(days)
  const input = {
    // With only a new end, amendContract's own default: the renewal starts after the current end.
    from: from || (lastDay ? undefined : firstMonth),
    dailyRate: typedRate === undefined ? undefined : fromContractUnit({ unit, rate: typedRate, contracted: null, perMonth: 0 }).dailyRate,
    addDays: timeAndMaterials || typedDays === undefined ? undefined : fromContractUnit({ unit, rate: 1, contracted: typedDays, perMonth: 0 }).contractedDays!,
    lastDay: end && lastDay ? lastDay : undefined,
    note: note.trim() || undefined,
  }
  const empty = input.dailyRate === undefined && input.addDays === undefined && input.lastDay === undefined
  const context = { today, allocations }
  const result = empty ? null : amendContract(e, input, context)
  const ok = result && "changes" in result ? result : null
  // Only a whole month is shown in words: a browser without a month picker hands over what is typed so far.
  const shownFrom =
    ok?.entry?.from ?? (input.from && MONTH.test(input.from) ? input.from : lastDay && afterEnd ? afterEnd : firstMonth)
  const followsEnd = !from && !!lastDay && !!ok?.entry
  // A rate or days typed pins From where it shows, so a New End Date typed next never moves them.
  const pinFrom = () => {
    if (from === null) setFrom(shownFrom)
  }

  const effectsOf = (after: Engagement, at: string) =>
    amendmentEffects({ before: e, after, from: at, engagements, allocations, timecards, invoices, today })
  const after = ok ? { ...e, ...ok.changes } : null
  const effects = ok?.entry && after ? effectsOf(after, ok.entry.from) : null
  const repriced = effects?.invoicedRepriced ?? []
  const lastRepriced = repriced.at(-1)?.yearMonth
  // The outcome in one sentence, beside the button that confirms it: amendmentEffects' lines carry the detail.
  const repricedTotal = Math.round(repriced.reduce((sum, r) => sum + r.delta, 0) * 100) / 100
  const summary = lastRepriced
    ? `Saving reprices ${monthRun(repriced.map((r) => r.yearMonth))}, already invoiced` +
      (repricedTotal === 0
        ? "."
        : `: ${eurShort(Math.abs(repricedTotal))} ${repricedTotal > 0 ? "more" : "less"} for this contract.`) +
      " Issued invoices stay as they are; the difference shows in your next invoice suggestion."
    : null

  // The live preview: the amended contract through the resolver the Clients row and the Plan use.
  let preview = ""
  if (ok?.entry && after) {
    const burn = computeBurnDown({
      sources: toRevenueSources({ engagements: [after], opportunities: [], clients: [], scenario: "committed" }),
      allocations,
      fromMonth: currentMonth,
      months: 36,
    })[0]
    const total = contractDays(after)
    const usage = contractUsage({ engagement: after, timecards, cells: [], today })
    const runOut = runOutMonth(usage, burn?.exhaustionMonth ?? null)
    const lastNow = contractEndDate(after)
    preview = [
      `From ${mon(ok.entry.from)}: ${rateIn(rateAt(after, ok.entry.from), unit)}`,
      total === null
        ? "time and materials"
        : `${countIn(total, unit)}${total !== after.contractedDays ? ` (${inContractUnit(after.contractedDays ?? 0, unit)} + ${inContractUnit(total - (after.contractedDays ?? 0), unit)})` : ""}`,
      // Used stays what it is: an amendment moves the budget, not the hours. Past it, nothing runs out.
      runOut &&
        `${runOut < currentMonth ? "ran out" : "runs out"} ${mon(runOut)}`,
      lastNow && `ends ${day(lastNow)}`,
    ]
      .filter(Boolean)
      .join(" · ")
  }

  const removal = removing ? amendContract(e, { from: removing.from, remove: true }, context) : null
  const removalOk = removal && "changes" in removal ? removal : null
  const afterRemoval = removalOk ? { ...e, ...removalOk.changes } : null
  const removalEffects = afterRemoval && removing ? effectsOf(afterRemoval, removing.from) : null
  const endBack = afterRemoval && removalOk?.changes.endDate !== undefined ? contractEndDate(afterRemoval) : null
  const refused =
    removing && removal && "error" in removal
      ? inDialogWords(removal.error.replace(/^Removing it/, `Removing ${mon(removing.from)}`))
      : null

  const signedEnd = list.find((a) => a.lastDay)?.lastDayBefore ?? end
  const signed = [
    rateIn(e.dailyRate, unit),
    e.contractedDays === null ? "time and materials" : countIn(e.contractedDays, unit),
    e.startMonth && `from ${mon(e.startMonth)}`,
    signedEnd && `until ${day(signedEnd)}`,
  ]
    .filter(Boolean)
    .join(" · ")

  return (
    <DialogContent size="lg" className="gap-5" onCloseAutoFocus={onCloseAutoFocus}>
      <DialogHeader className="pr-6 text-left">
        <DialogTitle>Amend Contract</DialogTitle>
        <DialogDescription>
          {clientName} · {engagementLabel(e)}. New terms from a month on: a new {hourly ? "hourly" : "day"} rate, more {hourly ? "hours" : "days"} or a later end.
          Earlier months keep their price on invoices and in the Plan.
        </DialogDescription>
      </DialogHeader>

      <section aria-label="History" className="space-y-1.5">
        <h3 ref={historyHeading} tabIndex={-1} className={HEADING}>
          History
        </h3>
        <ol className="divide-y rounded-md border text-sm">
          <li className="px-3 py-2">
            <span className="font-medium">Signed</span> <span className="text-muted-foreground">· {signed}</span>
          </li>
          {list.map((a) => (
            <li key={a.from} className="flex items-center justify-between gap-2 py-1 pl-3 pr-1">
              <span className="min-w-0 py-1">
                <span className="font-medium">{mon(a.from)}</span>{" "}
                <span className="text-muted-foreground">· {amendmentTerms(a, unit)}</span>
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="shrink-0"
                aria-label={`Remove the ${mon(a.from)} amendment`}
                // Off while a write lands: the list it would rewrite is the one before it.
                disabled={isPending}
                onClick={(ev) => {
                  removeFocus.current = ev.currentTarget
                  setRemoving(a)
                }}
              >
                Remove
              </Button>
            </li>
          ))}
        </ol>
        {list.length === 0 && <p className="text-[0.8rem] text-muted-foreground">No amendments yet.</p>}
      </section>

      <form
        noValidate
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault()
          if (ok) onSubmit(ok.changes, () => onOpenChange(false))
        }}
      >
        <h3 className={HEADING}>New Amendment</h3>
        <Field
          label="From"
          help={
            `Months before ${mon(shownFrom)} keep their terms. Amendments start on the 1st.` +
            (followsEnd
              ? ` Set to ${mon(shownFrom)}, ${shownFrom === afterEnd ? "the month after the current end" : "the new end's month"}: change it if the new terms start earlier.`
              : "")
          }
        >
          {({ id, describedBy }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              type="month"
              // First, not a history row's Remove: Radix would focus that.
              autoFocus
              className="w-44"
              min={e.startMonth ?? undefined}
              value={from ?? shownFrom}
              onChange={(ev) => setFrom(ev.target.value)}
            />
          )}
        </Field>
        <Field
          label={hourly ? "New Hourly Rate" : "New Day Rate"}
          help={`Empty keeps ${rateIn(rateAt(e, shownFrom), unit)}, the rate in force in ${mon(shownFrom)}.`}
        >
          {({ id, describedBy }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              className="w-44"
              placeholder={String(shownRate(rateAt(e, shownFrom)))}
              value={rate}
              onChange={(ev) => {
                pinFrom()
                setRate(ev.target.value)
              }}
            />
          )}
        </Field>
        <Field
          label={hourly ? "Add Hours" : "Add Days"}
          help={
            timeAndMaterials
              ? "Time and materials has no budget to add to."
              : `Added to the ${countIn(contractDays(e) ?? 0, unit)}, from ${mon(shownFrom)}.` +
                (end && !lastDay ? ` If they won't fit by ${day(end)}, also set a New End Date.` : "")
          }
        >
          {({ id, describedBy }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              type="number"
              inputMode="decimal"
              min="0"
              step="0.5"
              className="w-44"
              disabled={timeAndMaterials}
              placeholder={timeAndMaterials ? undefined : hourly ? "e.g. 80" : "e.g. 10"}
              value={timeAndMaterials ? "" : days}
              onChange={(ev) => {
                pinFrom()
                setDays(ev.target.value)
              }}
            />
          )}
        </Field>
        <Field
          label="New End Date"
          help={end ? `Ends ${day(end)} now. An amendment only moves it later.` : "It has no end to extend."}
        >
          {({ id, describedBy }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              type="date"
              className="w-44"
              disabled={!end}
              min={end ? isoDate(addDays(parseISO(end), 1)) : undefined}
              value={end ? lastDay : ""}
              onChange={(ev) => setLastDay(ev.target.value)}
            />
          )}
        </Field>
        <Field label="Note" help="What the client signed, such as an addendum or a PO number. Shown in the history.">
          {({ id, describedBy }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              maxLength={200}
              placeholder="Addendum 2"
              value={note}
              onChange={(ev) => setNote(ev.target.value)}
            />
          )}
        </Field>

        <div aria-live="polite" className="space-y-1 rounded-md border bg-muted/40 px-3 py-2 text-sm">
          {empty ? (
            <p className="text-muted-foreground">Fill in a new {hourly ? "hourly" : "day"} rate, {hourly ? "hours" : "days"} to add or a new end date to see the result.</p>
          ) : result && "error" in result ? (
            <p role="alert" className="text-destructive">
              {inDialogWords(result.error)}
            </p>
          ) : (
            <>
              <p className="font-medium">{preview}</p>
              {ok?.before && ok.entry && (
                <p className="text-[0.8rem] text-muted-foreground">
                  The {mon(ok.entry.from)} amendment now reads {amendmentTerms(ok.entry, unit)} (was {amendmentTerms(ok.before, unit)}).
                </p>
              )}
              {ok?.changes.isActive && <p className="text-[0.8rem] text-muted-foreground">The contract is open again.</p>}
            </>
          )}
        </div>

        {effects && effects.warnings.length > 0 && (
          <ul
            id={`${ids}-warnings`}
            className="space-y-1.5 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[0.8rem] text-amber-800 dark:border-amber-500/40 dark:bg-amber-950/40 dark:text-amber-300"
          >
            {effects.warnings.map((w) => (
              <li key={w}>{inDialogWords(w)}</li>
            ))}
            {lastRepriced && (
              <li className="font-medium">To leave invoiced months alone, start from {mon(monthsFrom(lastRepriced, 2)[1])}.</li>
            )}
          </ul>
        )}

        {/* Pinned to the bottom with its question: on a phone the € outcome is read before the click. */}
        <div className="sticky -bottom-6 -mx-6 -mb-6 space-y-3 border-t bg-background px-6 py-4">
          {summary && (
            <p id={`${ids}-summary`} className="text-[0.8rem] font-medium text-amber-800 dark:text-amber-300">
              {summary}
            </p>
          )}
          {/* Not DialogFooter: this wrapper already pins the row and its summary. */}
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            {/* The label is the confirmation: an invoiced month's price moves only on this click. */}
            <Button
              type="submit"
              disabled={!ok || isPending}
              aria-describedby={summary ? `${ids}-summary ${ids}-warnings` : undefined}
            >
              {isPending ? "Saving…" : lastRepriced ? "Save and Reprice" : "Save Amendment"}
            </Button>
          </div>
        </div>
      </form>

      <ConfirmDeleteDialog
        open={!!removing}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={refused && removing ? `Can't Remove ${mon(removing.from)} Yet` : "Remove Amendment"}
        description={
          !removing || !afterRemoval
            ? (refused ?? "")
            : [
                `Removes the ${mon(removing.from)} amendment: ${amendmentTerms(removing, unit)}.`,
                removing.dailyRate !== null
                  ? `From ${mon(removing.from)} the rate goes back to ${rateIn(rateAt(afterRemoval, removing.from), unit)}.`
                  : null,
                endBack ? `The end goes back to ${day(endBack)}.` : null,
                removalEffects?.invoicedRepriced.length ? null : "No invoiced month changes.",
                ...(removalEffects?.warnings ?? []).map(inDialogWords),
              ]
                .filter(Boolean)
                .join(" ")
        }
        isPending={isPending}
        confirmLabel="Remove Amendment"
        pendingLabel="Removing…"
        cancelLabel={refused ? "OK" : "Cancel"}
        onCloseAutoFocus={(ev) => {
          ev.preventDefault()
          removeFocus.current?.focus()
        }}
        onConfirm={
          removalOk
            ? () => {
                removeFocus.current = historyHeading.current
                onSubmit(removalOk.changes, () => setRemoving(null))
              }
            : undefined
        }
      />
    </DialogContent>
  )
}
