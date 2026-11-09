/**
 * Turns contracts and open opportunities into a resolved month-by-month day grid,
 * burning each contracted-days budget down chronologically.
 *
 * One resolver, because the projection and the burn-down must cap budgets
 * identically — if they disagree, the revenue chart and the "budget esaurito a
 * marzo" sentence tell the user two different stories about the same contract.
 *
 * A contract's terms are dated: an amendment sets a new day rate, or adds days to
 * the budget, from a month on. Months before it keep the terms they had, so the
 * past never reprices, and a spent budget can be refilled from a dated month.
 */

import { addMonths, differenceInCalendarMonths, format } from "date-fns"

import type { Allocation, Client, ContractAmendment, Engagement, Opportunity } from "@/types"

// ─── Types ───────────────────────────────────────────────────────────────────

export type RevenueSourceKind = "engagement" | "opportunity"

/**
 * A signed contract and an open opportunity earn money the same way — days per
 * month at a daily rate — so they project through a single code path. The only
 * difference is `weight`: certainty for one, probability for the other.
 */
export interface RevenueSource {
  kind: RevenueSourceKind
  id: string
  clientName: string
  dailyRate: number
  vatApplicable: boolean
  daysPerMonth: number
  /** "YYYY-MM". null = already running at the projection origin. */
  startMonth: string | null
  /**
   * "YYYY-MM", last month the default days fill. Absent/null = no end. Only
   * contracts carry one: an opportunity's budget already stops it.
   */
  endMonth?: string | null
  /** Day ceiling. null = open-ended. */
  budgetDays: number | null
  /** 1 for a signed contract; probability/100 for an opportunity. */
  weight: number
  /** What the contract is signed in: only how the Plan shows its days. Absent = day. */
  unit?: Engagement["unit"]
  /** A contract's dated terms. dailyRate and budgetDays above are the signed ones. */
  amendments?: readonly DatedTerms[]
}

/** What the engine reads of an amendment: the rate and the days, from a month on. */
export type DatedTerms = Pick<ContractAmendment, "from" | "dailyRate" | "addedDays">

export interface AllocationCell {
  sourceId: string
  kind: RevenueSourceKind
  clientName: string
  dailyRate: number
  vatApplicable: boolean
  weight: number
  yearMonth: string
  /** Days asked for, before the budget ceiling. */
  plannedDays: number
  /** Days that survive the ceiling — this is what generates revenue. */
  billableDays: number
  /** Budget left after this month. Infinity when open-ended. */
  remainingDays: number
  /** The budget ran out partway through this month. */
  capped: boolean
}

export interface EngagementBurnDown {
  sourceId: string
  clientName: string
  cells: AllocationCell[]
  /**
   * Last month that billed before the budget hit zero. null when the contract is
   * open-ended, or when its budget outlives the horizon — running out of months to
   * look at is not the same as running out of days. It can fall before the window:
   * the budget burns from the contract's start, so a contract may already be spent.
   */
  exhaustionMonth: string | null
  /**
   * First month at zero after the budget stopped billing — it ran out, or its contract
   * ended with days left. The drop the user needs warning about. Only reported inside
   * the window: a drop that already happened needs no warning.
   */
  cliffMonth: string | null
  /**
   * Gross €/month that disappears from cliffMonth on. A budget that runs out in the
   * contract's endMonth loses its default run-rate, as it would with no end (#154).
   */
  monthlyRevenueAtRisk: number
}

export interface RevenueCliff {
  yearMonth: string
  sources: { sourceId: string; clientName: string; monthlyGrossLost: number }[]
  grossLostPerMonth: number
  /** What still comes in that month, once the loss has bitten. */
  grossRemainingPerMonth: number
}

// ─── Month helpers ───────────────────────────────────────────────────────────

function parseYearMonth(ym: string): Date {
  const [year, month] = ym.split("-").map(Number)
  return new Date(year, month - 1, 1)
}

/** `count` consecutive "YYYY-MM" strings starting at `fromMonth`, inclusive. */
export function monthsFrom(fromMonth: string, count: number): string[] {
  const start = parseYearMonth(fromMonth)
  return Array.from({ length: count }, (_, i) => format(addMonths(start, i), "yyyy-MM"))
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

// ─── Dated terms ─────────────────────────────────────────────────────────────

/**
 * The day rate in force in `yearMonth`: the latest amendment rate dated then or
 * before, else the signed one. Order-free, so an unsorted list reads the same.
 * Billing values hours with it too, so the plan and the invoices agree per month.
 */
export function rateAt(
  c: { dailyRate: number; amendments?: readonly DatedTerms[] },
  yearMonth: string,
): number {
  let rate = c.dailyRate
  let at = ""
  for (const a of c.amendments ?? []) {
    if (a.dailyRate !== null && a.from <= yearMonth && a.from >= at) {
      rate = a.dailyRate
      at = a.from
    }
  }
  return rate
}

/** Days the amendments dated `yearMonth` or before add to the budget. */
export function addedDaysBy(amendments: readonly DatedTerms[] | undefined, yearMonth: string): number {
  return (amendments ?? []).reduce((sum, a) => (a.addedDays !== null && a.from <= yearMonth ? sum + a.addedDays : sum), 0)
}

// ─── Sources ─────────────────────────────────────────────────────────────────

/**
 * Map contracts and opportunities onto the common shape.
 *
 * "committed" keeps signed contracts that are active or have an end month — a
 * closed contract still earned up to its end, and dropping it would rewrite past
 * months. An inactive one with no end month is left out, as it always was.
 * "weighted" adds the open pipeline discounted by probability; `won` is excluded
 * because it has already become a contract, and `lost` because it is not happening.
 */
export function toRevenueSources(input: {
  engagements: Engagement[]
  opportunities: Opportunity[]
  clients: Client[]
  scenario: "committed" | "weighted"
}): RevenueSource[] {
  const nameById = new Map(input.clients.map((c) => [c.id, c.name]))
  const unknown = "Unknown client"
  const sources: RevenueSource[] = []

  for (const e of input.engagements) {
    if (!e.isActive && e.endMonth == null) continue
    sources.push({
      kind: "engagement",
      id: e.id,
      clientName: nameById.get(e.clientId) ?? unknown,
      dailyRate: e.dailyRate,
      vatApplicable: e.vatApplicable,
      daysPerMonth: e.defaultDaysPerMonth,
      startMonth: e.startMonth,
      endMonth: e.endMonth,
      budgetDays: e.contractedDays,
      weight: 1,
      unit: e.unit,
      amendments: e.amendments,
    })
  }

  if (input.scenario === "weighted") {
    for (const o of input.opportunities) {
      if (o.stage === "won" || o.stage === "lost") continue
      sources.push({
        kind: "opportunity",
        id: o.id,
        clientName: nameById.get(o.clientId) ?? unknown,
        dailyRate: o.dailyRate,
        vatApplicable: o.vatApplicable,
        daysPerMonth: o.estimatedDaysPerMonth,
        startMonth: o.expectedStartMonth,
        budgetDays: o.estimatedDaysPerMonth * o.estimatedDurationMonths,
        weight: o.probability / 100,
      })
    }
  }

  return sources
}

// ─── Grid ────────────────────────────────────────────────────────────────────

type GridInput = { sources: RevenueSource[]; allocations: Allocation[]; fromMonth: string; months: number }

/**
 * Resolve the (source × month) day grid over the horizon.
 *
 * Fill rule — SYMMETRIC, in every month before today and after: a missing
 * Allocation means "use the source's default"; a stored row, a stored 0 included,
 * is what was consumed. That is why absence and zero cannot be collapsed.
 * An asymmetric rule ("before the current month, absence means 0") was proposed in
 * the #155 triage and rejected by the owner on 24 Sep 2026: each month that passes
 * unlogged would be re-read as zero work, so exhaustion would slide one month per
 * calendar month — this same drift coming back through the fill. Past months become
 * exact when a closed month's logged hours are confirmed into an allocation row.
 *
 * The budget burns from the contract, not from the window: a contract is walked
 * from `startMonth`, else from its first stored row, and only the window's months
 * are returned. Seeding the budget at `fromMonth` handed the contract a fresh budget
 * every time the window moved (#155). Opportunities are not anchored: an unsigned
 * deal has worked nothing.
 *
 * Past `endMonth` only the default stops: a stored allocation is days actually
 * planned or worked, and erasing it would drop real competenza revenue.
 *
 * Days an amendment adds join the budget in their own month, never before: the
 * symmetric fill would otherwise spend them on earlier months the budget capped,
 * and a month already shown as capped would start billing. Each cell carries the
 * rate in force in its month (rateAt).
 *
 * The budget is burned down with UNWEIGHTED days on purpose: the ceiling is a
 * real-world constraint on the plan, while probability only discounts the revenue.
 * Weighting first would smear the exhaustion date into a fraction, and "budget
 * esaurito a marzo 2027" has to be a date.
 */
export function resolveAllocationGrid(input: GridInput): AllocationCell[] {
  return walkGrid(input).filter((c) => c.yearMonth >= input.fromMonth)
}

/**
 * Where the walk starts each contract's budget (#155): its startMonth, else its first
 * stored row. A contract with neither is missing from the map: it starts at the window.
 * Opportunities are never anchored.
 */
export function contractAnchors(sources: RevenueSource[], allocations: Allocation[]): Map<string, string> {
  const firstRow = new Map<string, string>()
  for (const a of allocations) {
    const seen = firstRow.get(a.engagementId)
    if (seen === undefined || a.yearMonth < seen) firstRow.set(a.engagementId, a.yearMonth)
  }
  const anchors = new Map<string, string>()
  for (const s of sources) {
    const anchor = s.kind === "engagement" ? (s.startMonth ?? firstRow.get(s.id)) : undefined
    if (anchor) anchors.set(s.id, anchor)
  }
  return anchors
}

/**
 * The grid plus each anchored contract's months before the window. Exported because
 * the fiscal year (#158) needs the lead months the window hides.
 */
export function walkGrid(input: GridInput): AllocationCell[] {
  const horizon = monthsFrom(input.fromMonth, input.months)
  const explicitDays = new Map(
    input.allocations.map((a) => [`${a.engagementId}:${a.yearMonth}`, a.days]),
  )
  const anchors = contractAnchors(input.sources, input.allocations)
  const cells: AllocationCell[] = []

  for (const source of input.sources) {
    let remaining = source.budgetDays ?? Infinity
    let added = 0
    const anchor = anchors.get(source.id)
    const lead =
      anchor && anchor < input.fromMonth
        ? monthsFrom(anchor, differenceInCalendarMonths(parseYearMonth(input.fromMonth), parseYearMonth(anchor)))
        : []

    for (const yearMonth of [...lead, ...horizon]) {
      if (source.budgetDays !== null) {
        // As a delta, so the budget stays subtractive and still runs out at exactly 0.
        const now = addedDaysBy(source.amendments, yearMonth)
        remaining += now - added
        added = now
      }
      const base = {
        sourceId: source.id,
        kind: source.kind,
        clientName: source.clientName,
        dailyRate: rateAt(source, yearMonth),
        vatApplicable: source.vatApplicable,
        weight: source.weight,
        yearMonth,
      }

      if (source.startMonth && yearMonth < source.startMonth) {
        cells.push({ ...base, plannedDays: 0, billableDays: 0, remainingDays: remaining, capped: false })
        continue
      }

      const afterEnd = source.endMonth != null && yearMonth > source.endMonth
      const plannedDays = explicitDays.get(`${source.id}:${yearMonth}`) ?? (afterEnd ? 0 : source.daysPerMonth)
      const billableDays = Math.min(plannedDays, remaining)
      remaining = Math.max(0, remaining - billableDays)

      cells.push({
        ...base,
        plannedDays,
        billableDays,
        remainingDays: remaining,
        capped: billableDays < plannedDays,
      })
    }
  }

  return cells
}

// ─── Burn-down ───────────────────────────────────────────────────────────────

export function computeBurnDown(input: GridInput): EngagementBurnDown[] {
  // The whole walk, lead included: exhaustion is a property of the contract, and a
  // budget spent before the window must still report its month, not null.
  const grid = walkGrid(input)
  const cellsBySource = new Map<string, AllocationCell[]>()
  for (const cell of grid) {
    const arr = cellsBySource.get(cell.sourceId) ?? []
    arr.push(cell)
    cellsBySource.set(cell.sourceId, arr)
  }

  return input.sources.map((source) => {
    const walked = cellsBySource.get(source.id) ?? []
    const cells = walked.filter((c) => c.yearMonth >= input.fromMonth)
    const earning = walked.filter((c) => c.billableDays > 0)
    const last = earning.at(-1)

    // Exhaustion requires the budget to actually reach zero. Without the
    // remainingDays check, a contract whose budget outlives the horizon reported its
    // last visible month as "esaurimento" — a date the client card showed as fact.
    // A stop: the budget hits zero and the next month bills nothing. A budget spent and
    // refilled from a later month drops in between. Without a refill the budget never
    // comes back, so the first stop is the last earning month and every rule names it.
    const isStop = (c: AllocationCell, i: number) =>
      c.billableDays > 0 && c.remainingDays === 0 && walked[i + 1]?.billableDays === 0
    // Exhaustion is the first stop whose unpaid gap still reaches the window: inside the
    // gap the budget has run out, whatever a later refill brings.
    const ranOut = walked.find(
      (c, i) => isStop(c, i) && !walked.some((x, j) => j > i && x.billableDays > 0 && x.yearMonth <= input.fromMonth),
    )
    // The cliff follows the first stop whose drop is still ahead: inside a gap, the refill's.
    const dropAhead = walked.find((c, i) => isStop(c, i) && walked[i + 1].yearMonth >= input.fromMonth)
    const spent = last?.remainingDays === 0 ? last.yearMonth : null
    const exhaustionMonth = source.budgetDays === null ? null : (ranOut?.yearMonth ?? spent)
    // A budget also stops billing when its contract ends with days left. Every conversion
    // carries an end since #154, so one day under plan must not hide the drop after it.
    const stopMonth =
      (source.budgetDays === null ? null : (dropAhead?.yearMonth ?? spent)) ??
      (source.budgetDays !== null && last && last.yearMonth === source.endMonth ? last.yearMonth : null)

    const next = stopMonth
      ? walked.find((c) => c.yearMonth > stopMonth && c.billableDays === 0)
      : undefined
    const cliffCell = next && next.yearMonth >= input.fromMonth ? next : undefined
    // Past endMonth the default stops filling, so when billing stops in the contract's last
    // month the cliff month plans 0 unless a row says otherwise. What disappears is still
    // the run-rate: price it at the default, as the same contract with no end would (#154).
    const lostDays = cliffCell
      ? cliffCell.plannedDays || (stopMonth === source.endMonth ? source.daysPerMonth : 0)
      : 0

    return {
      sourceId: source.id,
      clientName: source.clientName,
      cells,
      exhaustionMonth,
      cliffMonth: cliffCell?.yearMonth ?? null,
      // What that month would have billed had the budget held — the run-rate lost, at its own rate.
      monthlyRevenueAtRisk: round2(lostDays * (cliffCell?.dailyRate ?? 0) * source.weight),
    }
  })
}

/**
 * The months where revenue drops because a budget ran out, with what is lost and
 * what is left. This is the answer to "cosa vuol dire che mi finisce il budget".
 */
export function computeRevenueCliffs(
  burnDowns: EngagementBurnDown[],
  grid: AllocationCell[],
): RevenueCliff[] {
  const byMonth = new Map<string, EngagementBurnDown[]>()
  for (const b of burnDowns) {
    if (!b.cliffMonth || b.monthlyRevenueAtRisk === 0) continue
    const arr = byMonth.get(b.cliffMonth) ?? []
    arr.push(b)
    byMonth.set(b.cliffMonth, arr)
  }

  return Array.from(byMonth.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([yearMonth, dropped]) => ({
      yearMonth,
      sources: dropped.map((b) => ({
        sourceId: b.sourceId,
        clientName: b.clientName,
        monthlyGrossLost: b.monthlyRevenueAtRisk,
      })),
      grossLostPerMonth: round2(dropped.reduce((s, b) => s + b.monthlyRevenueAtRisk, 0)),
      grossRemainingPerMonth: round2(
        grid
          .filter((c) => c.yearMonth === yearMonth)
          .reduce((s, c) => s + c.billableDays * c.dailyRate * c.weight, 0),
      ),
    }))
}
