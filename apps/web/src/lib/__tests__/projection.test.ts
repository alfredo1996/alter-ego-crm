import { describe, it, expect } from "vitest"

import { buildProjection, estimateCovered, estimateRuns, nearestPaymentMonth } from "../projection"

import type { RevenueSource } from "../engagement-burndown"
import type { Allocation, Assignment, Collaborator, CompanyExpense } from "@/types"

const NOW = new Date("2026-01-01")

function source(o: Partial<RevenueSource> = {}): RevenueSource {
  return {
    kind: "engagement", id: "e1", clientName: "Acme", dailyRate: 500,
    vatApplicable: true, daysPerMonth: 10, startMonth: null, budgetDays: null,
    weight: 1, ...o,
  }
}

function allocation(engagementId: string, yearMonth: string, days: number): Allocation {
  return {
    id: `${engagementId}-${yearMonth}`, userId: "u1", engagementId, yearMonth, days,
    createdAt: NOW, updatedAt: NOW,
  }
}

function expense(o: Partial<CompanyExpense> = {}): CompanyExpense {
  return {
    id: "x1", userId: "u1", description: "Commercialista", category: "accountant",
    amount: 1200, date: new Date("2026-01-15"), isRecurring: false,
    recurrenceMonths: null, notes: null, accountId: null, paidByOwner: false, vat: null, documentRef: null,
    project: null, recurringExpenseId: null, dateEstimated: false, importRef: null, collaboratorId: null, engagementId: null, forMonth: null, createdAt: NOW, updatedAt: NOW, ...o,
  }
}

const base = { allocations: [] as Allocation[], fromMonth: "2026-01", months: 3 }

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

// ─── Shape ───────────────────────────────────────────────────────────────────

describe("buildProjection horizon", () => {
  it("returns exactly one entry per month, in order", () => {
    const timeline = buildProjection({ ...base, sources: [source()], months: 4 })
    expect(timeline.map((m) => m.yearMonth)).toEqual(["2026-01", "2026-02", "2026-03", "2026-04"])
  })

  it("returns an empty timeline for a zero-month horizon", () => {
    expect(buildProjection({ ...base, sources: [source()], months: 0 })).toEqual([])
  })

  it("still produces months when there are no sources at all", () => {
    const timeline = buildProjection({ ...base, sources: [] })
    expect(timeline).toHaveLength(3)
    expect(timeline.every((m) => m.lines.length === 0)).toBe(true)
    expect(timeline.every((m) => m.revenue === 0)).toBe(true)
  })
})

// ─── Revenue ─────────────────────────────────────────────────────────────────

describe("buildProjection revenue", () => {
  it("bills the default days at the daily rate", () => {
    const [jan] = buildProjection({ ...base, sources: [source({ daysPerMonth: 12 })] })
    expect(jan.lines).toHaveLength(1)
    expect(jan.lines[0].revenue).toBe(6000)
    expect(jan.revenue).toBe(6000)
  })

  it("prefers an explicit allocation over the default", () => {
    const timeline = buildProjection({
      ...base,
      sources: [source()],
      allocations: [allocation("e1", "2026-02", 4)],
    })
    expect(timeline.map((m) => m.revenue)).toEqual([5000, 2000, 5000])
  })

  it("drops a month allocated to zero from the lines", () => {
    const timeline = buildProjection({
      ...base,
      sources: [source()],
      allocations: [allocation("e1", "2026-02", 0)],
    })
    expect(timeline[1].lines).toHaveLength(0)
    expect(timeline[1].revenue).toBe(0)
    // The surrounding months are untouched — zero is local, not a cancellation.
    expect(timeline[0].revenue).toBe(5000)
    expect(timeline[2].revenue).toBe(5000)
  })

  it("earns nothing before startMonth", () => {
    const timeline = buildProjection({
      ...base,
      sources: [source({ startMonth: "2026-03" })],
    })
    expect(timeline.map((m) => m.revenue)).toEqual([0, 0, 5000])
  })

  it("stops earning once the contracted days run out", () => {
    const timeline = buildProjection({
      ...base,
      sources: [source({ daysPerMonth: 10, budgetDays: 15 })],
      months: 4,
    })
    expect(timeline.map((m) => m.revenue)).toEqual([5000, 2500, 0, 0])
    expect(timeline[1].lines[0].capped).toBe(true)
  })

  it("keeps sources separate within a month", () => {
    const [jan] = buildProjection({
      ...base,
      sources: [
        source({ id: "e1", clientName: "Acme", dailyRate: 500, daysPerMonth: 10 }),
        source({ id: "e2", clientName: "Globex", dailyRate: 300, daysPerMonth: 5 }),
      ],
    })
    expect(jan.lines).toHaveLength(2)
    expect(jan.revenue).toBe(5000 + 1500)
  })
})

// ─── Weighting ───────────────────────────────────────────────────────────────

describe("buildProjection weighting", () => {
  it("discounts an opportunity's revenue by its weight", () => {
    const [jan] = buildProjection({
      ...base,
      sources: [source({ kind: "opportunity", weight: 0.6, daysPerMonth: 10 })],
    })
    expect(jan.lines[0].revenue).toBe(3000)
    expect(jan.revenue).toBe(3000)
  })

  it("excludes a zero-weight source entirely", () => {
    const [jan] = buildProjection({ ...base, sources: [source({ weight: 0 })] })
    expect(jan.lines).toHaveLength(0)
  })

  // Weighting is a discount on money only — it must not extend the runway.
  it("does not move the exhaustion month when weighted", () => {
    const committed = buildProjection({
      ...base,
      sources: [source({ daysPerMonth: 10, budgetDays: 20, weight: 1 })],
      months: 4,
    })
    const weighted = buildProjection({
      ...base,
      sources: [source({ kind: "opportunity", daysPerMonth: 10, budgetDays: 20, weight: 0.5 })],
      months: 4,
    })
    const earning = (t: typeof committed) => t.map((m) => m.lines.length > 0)
    expect(earning(weighted)).toEqual(earning(committed))
    expect(weighted[0].revenue).toBe(committed[0].revenue / 2)
  })
})

// ─── Costs ───────────────────────────────────────────────────────────────────

describe("buildProjection costs", () => {
  it("charges a one-off expense only to its own month", () => {
    const timeline = buildProjection({
      ...base,
      sources: [source()],
      companyExpenses: [expense({ amount: 1200, date: new Date("2026-02-10") })],
    })
    expect(timeline.map((m) => m.costs)).toEqual([0, 1200, 0])
  })

  it("prorates a recurring expense from its start month onward", () => {
    const timeline = buildProjection({
      ...base,
      sources: [source()],
      companyExpenses: [
        expense({ amount: 1200, date: new Date("2026-02-10"), isRecurring: true, recurrenceMonths: 12 }),
      ],
    })
    expect(timeline.map((m) => m.costs)).toEqual([0, 100, 100])
  })

  it("adds one-off and recurring expenses in the same month", () => {
    const timeline = buildProjection({
      ...base,
      sources: [source()],
      companyExpenses: [
        expense({ id: "x1", amount: 1200, date: new Date("2026-01-05"), isRecurring: true, recurrenceMonths: 12 }),
        expense({ id: "x2", amount: 500, date: new Date("2026-01-20") }),
      ],
    })
    expect(timeline[0].costs).toBe(600)
    expect(timeline[1].costs).toBe(100)
  })

  // Regression: the form can save isRecurring with no cadence, and that state used
  // to be read as a one-off — the expense then existed in exactly one month and
  // vanished from any horizon starting after it.
  it("treats a recurring expense with no cadence as monthly", () => {
    const timeline = buildProjection({
      ...base,
      sources: [source()],
      companyExpenses: [
        expense({ amount: 300, date: new Date("2026-01-10"), isRecurring: true, recurrenceMonths: null }),
      ],
    })
    expect(timeline.map((m) => m.costs)).toEqual([300, 300, 300])
  })

  it("still charges a recurring expense that started before the horizon", () => {
    const timeline = buildProjection({
      ...base,
      sources: [source()],
      companyExpenses: [
        expense({ amount: 300, date: new Date("2025-03-10"), isRecurring: true, recurrenceMonths: null }),
      ],
    })
    expect(timeline.every((m) => m.costs === 300)).toBe(true)
  })

  // A zero cadence would divide by zero. `0 ?? 1` is 0, so the guard has to test the
  // value, not just its presence.
  it("does not produce Infinity from a zero cadence", () => {
    const timeline = buildProjection({
      ...base,
      sources: [source()],
      companyExpenses: [
        expense({ amount: 300, date: new Date("2026-01-10"), isRecurring: true, recurrenceMonths: 0 }),
      ],
    })
    expect(timeline.every((m) => Number.isFinite(m.costs))).toBe(true)
    expect(timeline[0].costs).toBe(300)
  })
})

// ─── Reconciliation ──────────────────────────────────────────────────────────

// Regression: weighted days were rounded before being multiplied by the rate, so
// the month total drifted from the rows it is supposedly the sum of.
describe("buildProjection reconciliation", () => {
  it.each([
    [1, 10],
    [0.75, 12.5],
    [0.33, 12.5],
    [0.6, 7.5],
  ])("the month's revenue equals the sum of line revenues (weight %s, %s days)", (weight, days) => {
    const [month] = buildProjection({
      ...base,
      months: 1,
      sources: [source({ kind: "opportunity", weight, daysPerMonth: days })],
    })
    const lineSum = month.lines.reduce((s, l) => s + l.revenue, 0)
    expect(month.revenue).toBe(lineSum)
  })

  it("reconciles across several fractional lines in one month", () => {
    const [month] = buildProjection({
      ...base,
      months: 1,
      sources: [
        source({ id: "a", kind: "opportunity", weight: 0.33, daysPerMonth: 12.5, dailyRate: 533 }),
        source({ id: "b", kind: "opportunity", weight: 0.75, daysPerMonth: 7.5, dailyRate: 617 }),
      ],
    })
    const lineSum = round2(month.lines.reduce((s, l) => s + l.revenue, 0))
    expect(month.revenue).toBeCloseTo(lineSum, 2)
  })
})

// ─── Dated rates (contract amendments) ───────────────────────────────────────

describe("a dated rate change", () => {
  const amend = (from: string, dailyRate: number) =>
    ({ from, dailyRate, addedDays: null, lastDay: null, lastDayBefore: null, note: null })
  // Lumon PCM: €700/day, 10 days a month since January 2026.
  const pcm = source({ startMonth: "2026-01", dailyRate: 700 })
  const yearly = (s: RevenueSource) => {
    const timeline = buildProjection({ sources: [s], allocations: [], fromMonth: "2026-01", months: 24 })
    return ["2026", "2027"].map((y) => timeline.filter((m) => m.yearMonth.startsWith(y)).reduce((sum, m) => sum + m.revenue, 0))
  }

  it("leaves the year before it untouched and prices the year it starts at the new rate", () => {
    expect(yearly(pcm)).toEqual([84_000, 84_000])
    expect(yearly({ ...pcm, amendments: [amend("2027-01", 800)] })).toEqual([84_000, 96_000])
  })

  it("splits a year at the month it starts", () => {
    expect(yearly({ ...pcm, amendments: [amend("2026-07", 800)] })[0]).toBe(6 * 7_000 + 6 * 8_000)
  })
})

// ─── Costs covered by a payment ──────────────────────────────────────────────

describe("estimates covered by a payment", () => {
  const costs = (expenses: CompanyExpense[], months = 3) =>
    buildProjection({ ...base, sources: [], months, companyExpenses: expenses }).map((m) => m.costs)
  const google = expense({ id: "google", category: "software", amount: 100, date: new Date("2026-01-01"), isRecurring: true, recurrenceMonths: 1 })

  it("replaces a monthly estimate only in the month its payment is dated", () => {
    const paid = expense({ id: "feb", category: "software", amount: 120, date: new Date("2026-02-10"), recurringExpenseId: "google" })
    expect(costs([google, paid])).toEqual([100, 120, 100])
    // Not linked: both count, as before.
    expect(costs([google, { ...paid, recurringExpenseId: null }])).toEqual([100, 220, 100])
  })

  it("covers a quarterly estimate for the three months its payment pays for", () => {
    const quarterly = { ...google, amount: 300, recurrenceMonths: 3 }
    const paid = expense({ id: "q", category: "software", amount: 330, date: new Date("2026-02-10"), recurringExpenseId: "google" })
    expect(costs([quarterly, paid], 5)).toEqual([100, 330, 0, 0, 100])
  })

  it("lets a refund lower its month", () => {
    const laptop = expense({ id: "laptop", amount: 1000, accountId: "main" })
    const refund = expense({ id: "refund", amount: -200, accountId: "main" })
    expect(costs([laptop, refund], 1)).toEqual([800])
  })

  it("never lets a refund linked to an estimate stand for it", () => {
    // January paid, February's €20 back, March as estimated: February is 100 − 20, never −20.
    const paid = expense({ id: "jan", category: "software", amount: 100, date: new Date("2026-01-05"), accountId: "main", recurringExpenseId: "google" })
    const refund = expense({ id: "back", category: "software", amount: -20, date: new Date("2026-02-10"), accountId: "main", recurringExpenseId: "google" })
    expect(costs([google, paid, refund])).toEqual([100, 80, 100])
  })
})

describe("collaborators' fixed fees", () => {
  const studio: Collaborator = {
    id: "c1", userId: "u1", name: "Studio Verdi", type: "company", notes: null, isActive: true,
    fee: { amount: 1000, from: "2026-02", until: "2026-04", changes: [{ from: "2026-03", amount: 1500 }] },
    createdAt: NOW, updatedAt: NOW,
  }
  const run = (collaborators: Collaborator[], expenses: CompanyExpense[] = []) =>
    buildProjection({ ...base, months: 6, companyExpenses: expenses, sources: [], collaborators }).map((m) => [m.collaborators, m.otherCosts, m.costs])

  it("counts a fee that starts, changes and ends, beside the other costs; costs stays the sum", () => {
    const rent = expense({ id: "r", amount: 100, date: new Date("2026-01-05"), isRecurring: true, recurrenceMonths: 1 })
    expect(run([studio], [rent])).toEqual([
      [0, 100, 100], [1000, 100, 1100], [1500, 100, 1600], [1500, 100, 1600], [0, 100, 100], [0, 100, 100],
    ])
  })

  it("does not count a collaborator's invoice again in its month: the fee is already the plan", () => {
    const invoice = expense({ id: "v", category: "collaborators", collaboratorId: "c1", amount: 1500, date: new Date("2026-03-05"), forMonth: "2026-02" })
    const other = expense({ id: "r", amount: 100, date: new Date("2026-03-06") })
    expect(run([studio], [invoice, other])[2]).toEqual([1500, 100, 1600])
  })

  it("leaves an inactive collaborator out", () => {
    expect(run([{ ...studio, isActive: false }]).map((r) => r[0])).toEqual([0, 0, 0, 0, 0, 0])
  })
})

describe("collaborators' variable cost on a contract", () => {
  const giulia: Collaborator = {
    id: "g", userId: "u1", name: "Giulia", type: "freelancer", notes: null, isActive: true,
    fee: null, createdAt: NOW, updatedAt: NOW,
  }
  const assign = (o: Partial<Assignment> = {}): Assignment => ({
    id: "a1", userId: "u1", collaboratorId: "g", engagementId: "e1", dailyRate: 320, from: "2026-02",
    until: null, defaultDays: 4, monthDays: { "2026-03": 6 }, createdAt: NOW, updatedAt: NOW, ...o,
  })
  const run = (assignments: Assignment[], src: Partial<RevenueSource> = {}, collaborators = [giulia]) =>
    buildProjection({ ...base, months: 4, sources: [source(src)], collaborators, assignments })

  it("costs her planned days × rate each month, from her start, with the month's override; revenue is unchanged", () => {
    const t = run([assign()])
    expect(t.map((m) => m.collaborators)).toEqual([0, 1280, 1920, 1280])
    expect(t.map((m) => m.costs)).toEqual([0, 1280, 1920, 1280])
    expect(t.map((m) => m.revenue)).toEqual([5000, 5000, 5000, 5000])
    expect(t[2].lines[0]).toMatchObject({ collaboratorDays: 6, collaboratorCost: 1920 })
  })

  it("counts no days after the contract's end, even if the assignment goes on", () => {
    const t = run([assign({ until: null })], { endMonth: "2026-03" })
    expect(t.map((m) => m.collaborators)).toEqual([0, 1280, 1920, 0])
  })

  it("stops at her own until, adds to the fixed fee, and leaves an inactive collaborator out", () => {
    const withFee = { ...giulia, fee: { amount: 100, from: "2026-01", until: null, changes: [] } }
    expect(run([assign({ until: "2026-02" })], {}, [withFee]).map((m) => m.collaborators)).toEqual([100, 1380, 100, 100])
    expect(run([assign()], {}, [{ ...giulia, isActive: false }]).map((m) => m.collaborators)).toEqual([0, 0, 0, 0])
  })

  it("never costs more days than the contract bills that month", () => {
    const t = run([assign({ defaultDays: 15, monthDays: {} })], { daysPerMonth: 10 })
    expect(t.map((m) => m.collaborators)).toEqual([0, 3200, 3200, 3200])
  })

  it("two collaborators share the contract's days: 6 and 6 on a 10 day month cost 10 days", () => {
    const marco: Collaborator = { ...giulia, id: "m", name: "Marco" }
    const t = run(
      [assign({ defaultDays: 6, monthDays: {} }), assign({ id: "a2", collaboratorId: "m", defaultDays: 6, monthDays: {}, createdAt: new Date("2026-01-02") })],
      { daysPerMonth: 10 },
      [giulia, marco],
    )
    expect(t.map((m) => m.collaborators)).toEqual([0, 3200, 3200, 3200])
    expect(t[1].lines[0]).toMatchObject({ collaboratorDays: 10 })
  })
})

describe("recurring estimates that end, change price and land when paid", () => {
  const acc = (o: Partial<CompanyExpense> = {}) =>
    expense({ id: "acc", isRecurring: true, amount: 1200, recurrenceMonths: 3, date: new Date("2027-01-15"), ...o })
  const other = (list: CompanyExpense[], from: string, months: number) =>
    buildProjection({ ...base, sources: [], fromMonth: from, months, companyExpenses: list }).map((m) => m.otherCosts)

  it("counts a stored estimate (none of the new fields) as the even spread, whatever the cadence", () => {
    expect(other([acc()], "2027-01", 4)).toEqual([400, 400, 400, 400])
  })

  it.each([
    ["quarterly", 3, [1200, 0, 0, 1200, 0, 0, 1200]],
    ["yearly", 12, [2400, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2400]],
    ["monthly", 1, [100, 100, 100]],
  ])("a %s estimate counted when paid lands whole in its payment months", (_n, every, want) => {
    const amount = every === 12 ? 2400 : every === 1 ? 100 : 1200
    expect(other([acc({ countedWhenPaid: true, recurrenceMonths: every, amount })], "2027-01", want.length)).toEqual(want)
  })

  it("counts nothing after the end month, in either timing", () => {
    expect(other([acc({ countedWhenPaid: true, endMonth: "2027-04" })], "2027-01", 8)).toEqual([1200, 0, 0, 1200, 0, 0, 0, 0])
    expect(other([acc({ endMonth: "2027-02" })], "2027-01", 4)).toEqual([400, 400, 0, 0])
  })

  it("uses the price in force: whole when paid, a share when spread", () => {
    const changes = [{ from: "2027-07", amount: 1350 }]
    expect(other([acc({ countedWhenPaid: true, priceChanges: changes })], "2027-04", 4)).toEqual([1200, 0, 0, 1350])
    expect(other([acc({ priceChanges: changes })], "2027-06", 2)).toEqual([400, 450])
  })

  it("does not count a payment month a linked payment covers, and counts the payment in its own month", () => {
    const jan = expense({ id: "jan", amount: 1100, date: new Date("2027-01-20"), recurringExpenseId: "acc" })
    expect(other([acc({ countedWhenPaid: true }), jan], "2027-01", 4)).toEqual([1100, 0, 0, 1200])
  })

  it.each([
    ["on the due month", "2027-04-15", "2027-04"],
    ["late, within a month", "2027-05-03", "2027-04"],
    ["early, a month before", "2027-03-28", "2027-04"],
    ["two months late is nearer the next payment month", "2027-06-10", "2027-07"],
    ["before the start", "2026-11-01", "2027-01"],
  ])("a payment %s covers the payment month nearest its date", (_n, date, covers) => {
    const pay = expense({ id: "p", amount: 1000, date: new Date(date), recurringExpenseId: "acc" })
    const est = acc({ countedWhenPaid: true })
    const months = ["2027-01", "2027-04", "2027-07"]
    expect(months.filter((m) => estimateCovered(est, m, [est, pay]))).toEqual([covers])
  })

  it.each([
    ["rounds up to a payment month inside the end", "2027-03-10", "2027-02"],
    ["never maps past the end month: 2 Apr stands for February, not May", "2027-04-02", "2027-02"],
    ["a payment after the end still stands for the last payment month", "2027-09-01", "2027-02"],
  ])("a quarterly estimate from Nov 2026 ending 2027-04: a payment %s", (_n, date, covers) => {
    const est = acc({ countedWhenPaid: true, date: new Date("2026-11-15"), endMonth: "2027-04" })
    expect(nearestPaymentMonth(est, date.slice(0, 7))).toBe(covers)
    const pay = expense({ id: "p", amount: 1000, date: new Date(date), recurringExpenseId: "acc" })
    expect(estimateCovered(est, covers, [est, pay])).toBe(true)
  })

  it("a tie between two payment months goes to the earlier one", () => {
    const est = acc({ countedWhenPaid: true, recurrenceMonths: 2 })
    const pay = expense({ id: "p", amount: 1000, date: new Date("2027-02-10"), recurringExpenseId: "acc" })
    expect([estimateCovered(est, "2027-01", [est, pay]), estimateCovered(est, "2027-03", [est, pay])]).toEqual([true, false])
  })

  it("estimateRuns: not before the start, not after the end, only in payment months when counted when paid", () => {
    const est = acc({ countedWhenPaid: true, endMonth: "2027-07" })
    expect(["2026-12", "2027-01", "2027-02", "2027-04", "2027-07", "2027-10"].map((m) => estimateRuns(est, m))).toEqual([
      false, true, false, true, true, false,
    ])
  })
})
