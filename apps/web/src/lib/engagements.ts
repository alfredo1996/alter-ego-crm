import { eur, eurShort } from "@alter-ego/kernel/currency"
import { formatYearMonth, isoDate, parseYearMonth } from "@alter-ego/kernel/dates"
import { endOfMonth } from "date-fns"

import { monthsFrom, rateAt, type AllocationCell, type DatedTerms } from "@/lib/engagement-burndown"
import { contractAmendmentSchema, MAX_ADDED_DAYS, MAX_AMENDMENT_RATE, MAX_AMENDMENTS } from "@/types/schemas"

import type { Allocation, ContractAmendment, ContractUnit, Engagement, Opportunity, Timecard, UpdateEngagementInput } from "@/types"

type Rated = Pick<Engagement, "defaultDaysPerMonth" | "dailyRate" | "unit">

/**
 * A stored amendments list as the money path may read it: a copy holding only the
 * entries that parse, [] for anything that is not a list. The rules check the
 * list's shape and size only, so a hand-written entry with a string rate or no
 * month is dropped here, and that month keeps the terms before it.
 */
export function normalizeAmendments(raw: unknown): ContractAmendment[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((a) => {
    const parsed = contractAmendmentSchema.safeParse(a)
    return parsed.success ? [parsed.data] : []
  })
}

/** A contract's whole day budget: the signed days plus every amendment's. null with no budget. */
export function contractDays(e: {
  contractedDays: number | null
  amendments?: readonly Pick<ContractAmendment, "addedDays">[]
}): number | null {
  if (e.contractedDays === null) return null
  return (e.amendments ?? []).reduce((sum, a) => sum + (a.addedDays ?? 0), e.contractedDays)
}

/** The amendments that set a day rate, oldest first: "€800/day from Jan 2027" on the row, the Plan and Edit. */
export function rateSteps(amendments: readonly DatedTerms[] = []): { from: string; dailyRate: number }[] {
  return amendments
    .flatMap((a) => (a.dailyRate === null ? [] : [{ from: a.from, dailyRate: a.dailyRate }]))
    .sort((a, b) => a.from.localeCompare(b.from))
}

export type AmendContractInput = {
  /** "YYYY-MM", the first month it applies to. With a new end and no from: the month after the current last day. */
  from?: string
  dailyRate?: number
  addDays?: number
  /** "YYYY-MM-DD": a new last day, later than the current one. */
  lastDay?: string
  note?: string
  /** Drops the amendment dated `from`, and puts back the end it moved while the end is still its lastDay. */
  remove?: boolean
}

export type AmendContractResult =
  | { error: string }
  | {
      changes: Pick<UpdateEngagementInput, "amendments" | "endMonth" | "endDate" | "isActive">
      /** The amendment written; null on remove. */
      entry: ContractAmendment | null
      /** The one it replaced (same month) or removed; null for a new month. */
      before: ContractAmendment | null
    }

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/
const mon = (ym: string) => formatYearMonth(ym, "MMM yyyy")

/**
 * Validates an amendment against the stored contract and returns the update that
 * records it: the whole list, sorted, plus the end and isActive when it extends the
 * contract. The one rule set for the dialog and amend_contract: the rules and a
 * partial zod schema cannot see the stored document, and MCP writes bypass the rules.
 *
 * One entry per month: a second one for the same month merges, the fields passed
 * replacing (addDays too, never added). Added days need a budget and an anchor:
 * on time and materials a budget would cap months already past, and without a start
 * the budget restarts at every window (#155). A new end only extends, and from the
 * month after the old end at the latest, so no gap fills with default days.
 */
export function amendContract(
  e: Pick<Engagement, "id" | "dailyRate" | "contractedDays" | "startMonth" | "endMonth" | "endDate" | "isActive" | "amendments"> &
    Partial<Pick<Engagement, "unit">>,
  input: AmendContractInput,
  { today, allocations }: { today: string; allocations: Pick<Allocation, "engagementId">[] },
): AmendContractResult {
  const list = e.amendments ?? []
  const end = contractEndDate(e)
  const unit = contractUnit(e)
  if (input.from !== undefined && !MONTH.test(input.from)) {
    return { error: `from is a month as YYYY-MM, 01 to 12: "${input.from}" is not one.` }
  }

  if (input.remove) {
    if ([input.dailyRate, input.addDays, input.lastDay, input.note].some((v) => v !== undefined)) {
      return { error: "remove takes only from, the month of the amendment to drop." }
    }
    const gone = input.from === undefined ? undefined : list.find((a) => a.from === input.from)
    if (!gone) {
      const dated = list.map((a) => mon(a.from)).join(", ")
      return {
        error:
          (input.from ? `No amendment from ${mon(input.from)} to remove.` : "Pass from (YYYY-MM), the month of the amendment to remove.") +
          (dated ? ` Amendments: ${dated}.` : " This contract has none."),
      }
    }
    // isActive stays: the entry does not record whether its extension reopened the contract.
    const restored = gone.lastDay !== null && end === gone.lastDay ? gone.lastDayBefore : null
    // The end put back must still cover every other amendment, which amendContract never writes past the end.
    const stranded = restored ? list.filter((a) => a !== gone && a.from > restored.slice(0, 7)) : []
    if (restored && stranded.length > 0) {
      const many = stranded.length > 1
      return {
        error:
          `Removing it puts the end back to ${restored}, and the ${stranded.map((a) => mon(a.from)).join(", ")} ` +
          `${many ? "amendments" : "amendment"} would then never apply: remove ${many ? "them" : "it"} first.`,
      }
    }
    return {
      changes: { amendments: list.filter((a) => a !== gone), ...(restored ? endFields(restored) : {}) },
      entry: null,
      before: gone,
    }
  }

  if (input.dailyRate === undefined && input.addDays === undefined && input.lastDay === undefined) {
    return { error: "Nothing to amend: pass dailyRate, addDays or a new end (endDate or endMonth). A note alone changes nothing." }
  }
  if (input.dailyRate !== undefined && !(input.dailyRate > 0 && input.dailyRate <= MAX_AMENDMENT_RATE)) {
    return {
      error:
        unit === "hour"
          ? `The hourly rate is more than 0 and at most ${rateIn(MAX_AMENDMENT_RATE, unit)}.`
          : `dailyRate is more than 0 and at most ${MAX_AMENDMENT_RATE} €/day.`,
    }
  }
  if (input.addDays !== undefined && !(input.addDays > 0 && input.addDays <= MAX_ADDED_DAYS)) {
    return {
      error:
        unit === "hour"
          ? `The hours added are more than 0 and at most ${inContractUnit(MAX_ADDED_DAYS, unit)}. To cut hours, set an earlier end with update_engagement.`
          : `addDays is more than 0 and at most ${MAX_ADDED_DAYS}. To cut days, set an earlier end with update_engagement.`,
    }
  }
  if (input.lastDay !== undefined) {
    if (end === null) {
      return { error: "This contract has no end to extend: it runs open-ended. To give it one use update_engagement." }
    }
    if (input.lastDay <= end) {
      return {
        error: `The new end ${input.lastDay} is not later than the current one (${end}): an amendment only extends a contract. To shorten it use update_engagement.`,
      }
    }
  }
  const afterEnd = end && monthsFrom(end.slice(0, 7), 2)[1]
  // A last day moved within its own month (the 15th to the 31st) dates the entry in that month.
  const from =
    input.from ?? (input.lastDay && afterEnd ? [afterEnd, input.lastDay.slice(0, 7)].sort()[0] : null)
  if (!from) return { error: "Pass from (YYYY-MM), the first month the new rate or days apply." }
  if (e.startMonth && from < e.startMonth) {
    return {
      error:
        `${mon(from)} is before the contract's start (${mon(e.startMonth)}): an amendment starts in a month the contract runs. ` +
        "A typo in the signed rate is fixed in the app before any hours, else with an amendment from the start month.",
    }
  }
  if (input.lastDay !== undefined && afterEnd) {
    if (from > input.lastDay.slice(0, 7)) {
      return { error: `The new end ${input.lastDay} is before ${mon(from)}, the amendment's first month.` }
    }
    if (from > afterEnd) {
      return {
        error:
          `The contract ends on ${end}: extending it from ${mon(from)} leaves a gap that would fill with default days. ` +
          `Start the renewal from ${afterEnd} and set the gap months to 0 in the Plan, or make it a new contract.`,
      }
    }
  } else if (end && from > end.slice(0, 7)) {
    return {
      error: `The contract ends on ${end}: an amendment from ${mon(from)} would never apply. Pass a new end (endDate or endMonth) to extend it too.`,
    }
  }
  if (input.addDays !== undefined) {
    if (e.contractedDays === null) {
      return {
        error:
          "This contract is time and materials, with no day budget: adding days would give it one, and a budget would cap months already past. " +
          "More days in a month go in the Plan.",
      }
    }
    if (!e.startMonth && !allocations.some((a) => a.engagementId === e.id)) {
      // update_engagement has no start, so the fix is named where it lives for chat and the app alike.
      return {
        error: "Set the contract's Start first, in the web app's Edit Contract (Clients): without one the budget restarts every month.",
      }
    }
  }

  const prev = list.find((a) => a.from === from)
  const others = list.filter((a) => a !== prev)
  let dailyRate = input.dailyRate ?? prev?.dailyRate ?? null
  if (input.dailyRate !== undefined) {
    const inForce = rateAt({ dailyRate: e.dailyRate, amendments: others }, from)
    if (input.dailyRate === inForce) {
      if (input.addDays === undefined && input.lastDay === undefined) {
        return {
          error:
            prev?.dailyRate != null
              ? `${rateIn(inForce, unit)} is the rate in force before the ${mon(from)} amendment: to undo that amendment use remove.`
              : `The ${unit === "hour" ? "hourly" : "day"} rate in force in ${mon(from)} is already ${rateIn(inForce, unit)}: nothing to amend.`,
        }
      }
      // Re-sent beside days or an end ("renewed at the same rate"): no rate change, so the month records none.
      dailyRate = null
    }
  }
  const newEnd = input.lastDay
  const entry: ContractAmendment = {
    from,
    dailyRate,
    addedDays: input.addDays ?? prev?.addedDays ?? null,
    lastDay: input.lastDay ?? prev?.lastDay ?? null,
    // The end before this month's amendment: what Remove puts back.
    lastDayBefore: newEnd !== undefined ? (prev?.lastDay && prev.lastDay === end ? prev.lastDayBefore : end) : (prev?.lastDayBefore ?? null),
    note: input.note ?? prev?.note ?? null,
  }
  if (prev && (Object.keys(entry) as (keyof ContractAmendment)[]).every((k) => entry[k] === prev[k])) {
    return { error: `The ${mon(from)} amendment already says this: nothing to change.` }
  }
  if (!prev && list.length >= MAX_AMENDMENTS) {
    return { error: `A contract holds at most ${MAX_AMENDMENTS} amendments: make the next change a new contract.` }
  }
  // An entry the read guard would drop must never be written: it would vanish silently.
  const parsed = contractAmendmentSchema.safeParse(entry)
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  return {
    changes: {
      amendments: [...others, entry].sort((a, b) => a.from.localeCompare(b.from)),
      ...(newEnd !== undefined ? endFields(newEnd) : {}),
      // An extension reopens a closed contract it carries past today.
      ...(newEnd !== undefined && !e.isActive && newEnd >= today ? { isActive: true } : {}),
    },
    entry,
    before: prev ?? null,
  }
}

/**
 * Why an end in `endMonth` is refused, or null: an amendment dated after that month
 * would never apply, and the row and the history would describe terms that never
 * do. Edit, Close and update_engagement refuse it alike, as amendContract refuses a
 * Remove that strands one. The fix is named where the owner is: the app's Amend
 * Contract, or amend_contract over chat, latest first since a Remove may put back
 * an end that strands the earlier ones (stored sorted by from). No end strands nothing.
 */
export function endBeforeAmendmentError(
  e: { amendments?: readonly Pick<ContractAmendment, "from">[] },
  endMonth: string | null,
  via: "app" | "chat",
): string | null {
  const stranded = endMonth ? (e.amendments ?? []).filter((a) => a.from > endMonth) : []
  if (stranded.length === 0) return null
  const many = stranded.length > 1
  const them = many ? "them" : "it"
  const fix =
    via === "app"
      ? `Remove ${them} with Amend Contract first.`
      : `Remove ${them} first${many ? ", the latest first" : ""}: amend_contract remove with from ${stranded.map((a) => a.from).reverse().join(", then ")}.`
  return (
    `The end moves before the ${stranded.map((a) => mon(a.from)).join(", ")} amendment${many ? "s" : ""}: ` +
    `${many ? "they" : "it"} would never apply. ${fix}`
  )
}

/**
 * "10 days/month × €700" — how a contract was told apart before it had a name.
 * The signed rate, never an amendment's: a contract's identity must not rename itself.
 */
export function engagementRateLabel(e: Rated): string {
  const unit = contractUnit(e)
  const { rate, perMonth } = toContractUnit({ ...e, contractedDays: null })
  // An hourly rate keeps its cents: €62.50/h is not €63/h.
  return `${perMonth} ${unit}s/month × ${unit === "hour" ? `${eurShort(rate)}/h` : eur(rate)}`
}

/** The contract's name when it has one, otherwise its rate label. */
export function engagementLabel(e: Rated & Pick<Engagement, "name">): string {
  return e.name?.trim() || engagementRateLabel(e)
}

/**
 * The name a contract converted from an opportunity starts with: its title,
 * cut to the 120-character name limit (createEngagementSchema) — titles may
 * run to 200, and a long one must not fail the conversion.
 */
export function engagementNameFromTitle(title: string): string | null {
  // Never leave half a surrogate pair (an emoji) at the cut, nor a trailing space.
  return title.trim().slice(0, 120).replace(/[\uD800-\uDBFF]$/, "").trimEnd() || null
}

/**
 * The months a contract converted from a won opportunity runs (#154): its expected
 * start, else this month (the projection origin its null start meant), through
 * start + duration − 1. Born with no end, a zeroed month slides its days past the
 * deal; born with no start, its budget re-seeds at every window (#155) and outlives
 * the end. A duration of 0 gives no end.
 *
 * An expected start already past gives way to this month, as the weighted pipeline
 * already projects the deal: the symmetric fill (#155) would count those months as
 * worked, so winning a late deal would spend its budget before today. Pass
 * `startMonth` for a contract that really began earlier.
 */
export function conversionTerm(
  o: Pick<Opportunity, "expectedStartMonth" | "estimatedDurationMonths">,
  thisMonth: string,
  startMonth: string = o.expectedStartMonth && o.expectedStartMonth > thisMonth ? o.expectedStartMonth : thisMonth,
): { startMonth: string; endMonth: string | null } {
  return { startMonth, endMonth: monthsFrom(startMonth, o.estimatedDurationMonths).at(-1) ?? null }
}

/**
 * The last day hours can be logged on a contract, or null with no end. endMonth
 * stays the engine's truth and endDate only refines inside it, so a contract ended
 * by month (legacy, a conversion's planned end) runs to that month's last day, and
 * an endDate left stale by an older bundle that moved endMonth alone is ignored.
 */
export function contractEndDate(e: Pick<Engagement, "endMonth" | "endDate">): string | null {
  if (!e.endMonth) return null
  if (e.endDate?.startsWith(e.endMonth)) return e.endDate
  return isoDate(endOfMonth(parseYearMonth(e.endMonth)))
}

/** The end fields for a last day (null = no end): every writer that sets a day writes both. */
export function endFields(date: string | null): Pick<Engagement, "endDate" | "endMonth"> {
  return { endDate: date, endMonth: date?.slice(0, 7) ?? null }
}

/**
 * The last day a contract closed on `today` keeps (#156): today, or a planned end
 * already past, since moving that later would bill default days the plan had
 * stopped. null for a contract that has not started: any end would bill at least
 * its first month, and an inactive contract with no end leaves the plan.
 */
export function closingEndDate(
  e: Pick<Engagement, "startMonth" | "endMonth" | "endDate">,
  today: string,
): string | null {
  if (e.startMonth && e.startMonth > today.slice(0, 7)) return null
  const end = contractEndDate(e)
  return end && end < today ? end : today
}

/**
 * Days stored past a contract's end, oldest first. They still bill (#154: a stored
 * row is real competenza), so ending a contract has to say they are there.
 */
export function allocationsAfterEnd(
  allocations: Allocation[],
  engagementId: string,
  endMonth: string,
): Allocation[] {
  return allocations
    .filter((a) => a.engagementId === engagementId && a.yearMonth > endMonth && a.days > 0)
    .sort((a, b) => a.yearMonth.localeCompare(b.yearMonth))
}

/**
 * Hours logged past a contract's last day, oldest first. They are kept, and bill
 * once their day passes, so ending a contract has to say they are there.
 */
export function timecardsAfterEnd(timecards: Timecard[], engagementId: string, endDate: string): Timecard[] {
  return timecards
    .filter((t) => t.engagementId === engagementId && t.date > endDate)
    .sort((a, b) => a.date.localeCompare(b.date))
}

/**
 * Why a contract with any timecard is refused deletion: its hours are what the
 * client's invoices are checked against, and deleting would silently lose them.
 */
export const CONTRACT_HAS_HOURS = "This contract has hours logged: close it instead of deleting it."

// ponytail: every contract's giornata is 8 hours. When the first one that is not
// appears, add a nullable Engagement.hoursPerDay (null = 8) and read it here.
// Hours are stored raw, so that needs no migration.
export const HOURS_PER_DAY = 8

/** A contract's unit; absent reads as "day", so no existing contract needs a migration. */
export const contractUnit = (e: { unit?: ContractUnit | null }): ContractUnit => e.unit ?? "day"

const round2 = (n: number) => Math.round(n * 100) / 100
/** Units of a contract in one stored day: 8 for hours, 1 for days. */
export const perDay = (unit: ContractUnit) => (unit === "hour" ? HOURS_PER_DAY : 1)

/**
 * What a form took, in the contract's unit, as stored: days. For an hourly contract the
 * factor cancels in the money (hours / 8 × rate × 8 = hours × rate), so no money path
 * knows about the unit. Open-ended stays null.
 */
export function fromContractUnit(input: {
  unit?: ContractUnit | null
  rate: number
  contracted: number | null
  perMonth: number
}): Pick<Engagement, "dailyRate" | "contractedDays" | "defaultDaysPerMonth"> {
  const n = perDay(contractUnit(input))
  return {
    dailyRate: input.rate * n,
    contractedDays: input.contracted === null ? null : input.contracted / n,
    defaultDaysPerMonth: input.perMonth / n,
  }
}

/** Stored days back to the contract's unit, for a form or a reply: €600/day, 12.5 days is €75/h, 100 h. */
export function toContractUnit(
  e: Pick<Engagement, "dailyRate" | "contractedDays" | "defaultDaysPerMonth"> & { unit?: ContractUnit | null },
): { rate: number; contracted: number | null; perMonth: number } {
  const n = perDay(contractUnit(e))
  return {
    rate: round2(e.dailyRate / n),
    contracted: e.contractedDays === null ? null : round2(e.contractedDays * n),
    perMonth: round2(e.defaultDaysPerMonth * n),
  }
}

/** What a contract counts in, as a plural noun: "hours" or "days". */
export const unitNoun = (unit: ContractUnit) => (unit === "hour" ? "hours" : "days")

/** A stored amount of days, in the contract's unit, unlabelled: 12.5 days is 100 on an hourly contract. */
export const inContractUnit = (days: number, unit: ContractUnit) => round2(days * perDay(unit))

/** "1 day", "10 days", "1 hour", "40 hours": a stored amount of days, counted in the contract's unit. */
export function countIn(days: number, unit: ContractUnit): string {
  const n = inContractUnit(days, unit)
  return `${n} ${unit === "hour" ? "hour" : "day"}${n === 1 ? "" : "s"}`
}

/** A stored day rate in the contract's unit: "€75/h", "€500/day", "€62.50/h". */
export function rateIn(dailyRate: number, unit: ContractUnit): string {
  return `${eurShort(round2(dailyRate / perDay(unit)))}${unit === "hour" ? "/h" : "/day"}`
}

/** Stored days, shown in the contract's unit with its short mark: "10 h", "1.25 d". The one place a display turns days into text. */
/** A unit's short mark: "h" or "d". */
export const unitMark = (unit: ContractUnit) => (unit === "hour" ? "h" : "d")

export function formatContractQuantity(e: { unit?: ContractUnit | null }, days: number): string {
  const unit = contractUnit(e)
  return `${inContractUnit(days, unit)} ${unitMark(unit)}`
}

/** Hours to days, unrounded: 6 h is 0.75 gg. */
export function hoursToDays(hours: number): number {
  return hours / HOURS_PER_DAY
}

/** One block of a contract's day bar: the days used up to today, and the days the plan still holds. */
export type ContractMonth = { yearMonth: string; used: number; planned: number }

export type ContractUsage = { total: number; used: number; left: number; months: ContractMonth[] }

/**
 * A capped contract's days month by month: the days used (its hours up to today, ÷ 8) from its first
 * hour on, then what the plan still holds from the current month, as the burn-down walks it, for at
 * most `ahead` months after this one. A past month shows only what was used. null with no cap.
 * Days, unrounded: the display rounds once, in the contract's unit (inContractUnit), like contractRemaining.
 */
export function contractUsage(input: {
  engagement: Pick<Engagement, "id" | "contractedDays"> & { amendments?: readonly Pick<ContractAmendment, "addedDays">[] }
  timecards: Pick<Timecard, "engagementId" | "date" | "hours">[]
  /** The burn-down's cells for this contract (computeBurnDown). */
  cells: Pick<AllocationCell, "yearMonth" | "billableDays">[]
  today: string
  ahead?: number
}): ContractUsage | null {
  const total = contractDays(input.engagement)
  if (total === null) return null
  const currentMonth = input.today.slice(0, 7)
  // ponytail: 12 months ahead keeps the bar readable; a longer contract shows its first year.
  const last = monthsFrom(currentMonth, (input.ahead ?? 12) + 1).at(-1)!
  const hours = new Map<string, number>()
  for (const t of input.timecards) {
    if (t.engagementId !== input.engagement.id || t.date > input.today) continue
    const month = t.date.slice(0, 7)
    hours.set(month, (hours.get(month) ?? 0) + t.hours)
  }
  const plan = new Map(
    input.cells
      .filter((c) => c.yearMonth >= currentMonth && c.yearMonth <= last && c.billableDays > 0)
      .map((c) => [c.yearMonth, c.billableDays]),
  )
  const months = [...new Set([...hours.keys(), ...plan.keys()])].sort().map((yearMonth) => ({
    yearMonth,
    used: hoursToDays(hours.get(yearMonth) ?? 0),
    planned: plan.get(yearMonth) ?? 0,
  }))
  const used = hoursToDays([...hours.values()].reduce((sum, h) => sum + h, 0))
  return { total, used, left: Math.max(0, total - used), months }
}

/**
 * Worked past the budget: the one rule the Plan and the client page share. Half a hundredth of a day
 * is rounding, not an overrun. Once true, neither says when the days run out.
 */
export const isOverBudget = (u: Pick<ContractUsage, "total" | "used">) => u.used - u.total > 0.005

/** The month a contract's days run out, or null once it is worked past its budget (or has none). One rule for every screen and tool. */
export const runOutMonth = (usage: Pick<ContractUsage, "total" | "used"> | null | undefined, exhaustionMonth: string | null) =>
  usage && isOverBudget(usage) ? null : exhaustionMonth

/** What a typed, unsaved value changes: hours by date (replacing the stored day, everyone's) and plan days by month. */
export type RemainingDrafts = {
  hours?: Record<string, number>
  months?: Record<string, number>
  /** Months cleared back to the default (saving removes the allocation): planned days, but not typed. */
  defaults?: Record<string, number>
}

export type ContractRemaining =
  | { cap: true; total: number; worked: number; left: number; plannedAhead: number; notPlanned: number }
  | { cap: false; worked: number }

/**
 * What a contract has left and what is not planned yet, in days, unrounded: the display rounds once, in the contract's unit. Worked = hours dated up to today.
 * A month's plan = its planned days minus the days worked in it (never below 0), but never less than
 * the hours already scheduled in it. A month the owner typed (a stored allocation or a draft) counts
 * in full. A month holding only the default days per month counts its scheduled hours in full and its
 * default days above them only up to the room the budget still has after everything typed or
 * scheduled, so an untouched contract never reads over plan; only typed months can push it over.
 * `notPlanned` is left minus the plan ahead, negative when the plan holds more than is left. A draft
 * replaces the stored value it stands for.
 */
export function contractRemaining(input: {
  engagement: Pick<Engagement, "id" | "contractedDays"> & { amendments?: readonly Pick<ContractAmendment, "addedDays">[] }
  timecards: Pick<Timecard, "engagementId" | "date" | "hours">[]
  /** planCells' cells for this contract: the plan as typed days, before the budget caps it. */
  cells: Pick<AllocationCell, "yearMonth" | "plannedDays">[]
  /** The stored allocations: a month in them was typed by the owner, any other planned month is the default. */
  allocations?: Pick<Allocation, "engagementId" | "yearMonth">[]
  today: string
  drafts?: RemainingDrafts
}): ContractRemaining {
  const { engagement, today } = input
  const currentMonth = today.slice(0, 7)
  const hours = new Map<string, number>()
  // Everyone's hours on a day add up: a collaborator's day is part of the contract's days.
  for (const t of input.timecards) if (t.engagementId === engagement.id) hours.set(t.date, (hours.get(t.date) ?? 0) + t.hours)
  for (const [date, h] of Object.entries(input.drafts?.hours ?? {})) hours.set(date, h)
  const worked = new Map<string, number>()
  const scheduled = new Map<string, number>()
  for (const [date, h] of hours) {
    const into = date <= today ? worked : scheduled
    into.set(date.slice(0, 7), (into.get(date.slice(0, 7)) ?? 0) + h)
  }
  const workedDays = hoursToDays([...worked.values()].reduce((sum, h) => sum + h, 0))
  const total = contractDays(engagement)
  if (total === null) return { cap: false, worked: workedDays }
  const planned = new Map(input.cells.filter((c) => c.yearMonth >= currentMonth).map((c) => [c.yearMonth, c.plannedDays]))
  for (const [ym, d] of Object.entries({ ...input.drafts?.defaults, ...input.drafts?.months })) if (ym >= currentMonth) planned.set(ym, d)
  const typed = new Set([
    ...(input.allocations ?? []).filter((a) => a.engagementId === engagement.id).map((a) => a.yearMonth),
    ...Object.keys(input.drafts?.months ?? {}),
  ])
  for (const ym of Object.keys(input.drafts?.defaults ?? {})) typed.delete(ym)
  const months = new Set([...planned.keys(), ...[...scheduled.keys()].filter((m) => m >= currentMonth)])
  let plannedAhead = 0
  let defaultExtra = 0
  for (const ym of months) {
    const sched = hoursToDays(scheduled.get(ym) ?? 0)
    const month = Math.max((planned.get(ym) ?? 0) - hoursToDays(worked.get(ym) ?? 0), sched, 0)
    if (typed.has(ym) || !planned.has(ym)) plannedAhead += month
    else {
      plannedAhead += sched
      defaultExtra += month - sched
    }
  }
  const left = Math.max(0, total - workedDays)
  plannedAhead += Math.min(defaultExtra, Math.max(0, left - plannedAhead))
  return {
    cap: true,
    total,
    worked: workedDays,
    left,
    plannedAhead,
    notPlanned: left - plannedAhead,
  }
}
