import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { cashRows } from "@/lib/cash-book"
import { resolveAllocationGrid, toRevenueSources } from "@/lib/engagement-burndown"
import { clientBilling } from "@/lib/invoices"
import {
  monthSpan,
  normalizeMonth,
  quarterOf,
  resolveDateWindow,
  ToolInputError,
  allocatedDaysForMonth,
  appendNote,
  bookFigures,
  capacityForMonths,
  costCentreLabel,
  figureChanges,
  figureLine,
  fileSummary,
  groupInvoices,
  groupRevenue,
  groupTimecards,
  invoiceDrafts,
  monthEndNext,
  monthToClose,
  refuseDuplicate,
  resolveClient,
  resolveCompanyAccount,
  invoicedLine,
  resolveCollaborator,
  resolveDeadline,
  resolveInvoiceContract,
  resolveEngagement,
  resolveEstimate,
  resolveInvoice,
  resolveSolution,
  resolveStepPayer,
  resolveSupplierInvoice,
  resolveTask,
  revenueCells,
  solutionCard,
  timecardDecision,
  planMonths,
} from "@/lib/mcp/tools/helpers"
import { monthEndChecklist } from "@/lib/month-end"
import { normalizeSolutionSections } from "@/types/schemas"

import type {
  Allocation,
  Assignment,
  Collaborator,
  CapacityDoc,
  Client,
  CompanyAccount,
  CompanyDeadline,
  CompanyExpense,
  CompanyMovement,
  Engagement,
  Invoice,
  Opportunity,
  Solution,
  Timecard,
} from "@/types"

// ─── Fixtures ────────────────────────────────────────────────────────────────

const ts = { createdAt: new Date(), updatedAt: new Date() }

function client(id: string, name: string, isActive = true): Client {
  return { id, userId: "u", name, vatNumber: null, email: null, contactName: null, contactPhone: null, notes: null, isActive, ...ts }
}

function engagement(id: string, over: Partial<Engagement> = {}): Engagement {
  return {
    id,
    userId: "u",
    clientId: "c1",
    name: null,
    opportunityId: null,
    dailyRate: 1000,
    vatApplicable: true,
    contractedDays: null,
    defaultDaysPerMonth: 10,
    startMonth: null,
    endMonth: null, endDate: null,
    isActive: true,
    notes: null,
    ...ts,
    ...over,
  }
}

function allocation(engagementId: string, yearMonth: string, days: number): Allocation {
  return { id: `${engagementId}:${yearMonth}`, userId: "u", engagementId, yearMonth, days, ...ts }
}

// ─── Months ──────────────────────────────────────────────────────────────────

describe("resolveClient", () => {
  const clients = [client("c1", "Acme Spa"), client("c2", "Beta Srl"), client("c3", "Acmenext", false)]

  it("matches by id first", () => {
    expect(resolveClient(clients, "c2").name).toBe("Beta Srl")
  })

  it("matches by exact name, case-insensitive", () => {
    expect(resolveClient(clients, "acme spa").id).toBe("c1")
  })

  it("matches by prefix, then substring", () => {
    expect(resolveClient(clients, "Acme").id).toBe("c1")
    expect(resolveClient(clients, "eta").id).toBe("c2")
  })

  it("ignores archived clients for name matches", () => {
    expect(resolveClient(clients, "Acme").id).toBe("c1") // not the archived Acmenext
  })

  it("lists candidates on ambiguity", () => {
    const both = [client("c1", "Acme Nord"), client("c2", "Acme Sud")]
    expect(() => resolveClient(both, "Acme")).toThrow(/Acme Nord, Acme Sud/)
  })

  it("lists active clients on a miss", () => {
    expect(() => resolveClient(clients, "Gamma")).toThrow(/Acme Spa, Beta Srl/)
  })
})

describe("resolveTask", () => {
  const task = (id: string, title: string) =>
    ({
      id,
      userId: "u",
      clientId: "c",
      engagementId: "e",
      title,
      dueDate: null,
      notes: null,
      isDone: false,
      startedAt: null,
      labels: [] as string[],
      createdAt: new Date(),
      updatedAt: new Date(),
    }) as const

  const tasks = [task("t1", "Report agosto"), task("t2", "Fattura Q3")]

  it("matches by id, exact title, then substring — case-insensitive", () => {
    expect(resolveTask(tasks, "t2").title).toBe("Fattura Q3")
    expect(resolveTask(tasks, "report agosto").id).toBe("t1")
    expect(resolveTask(tasks, "fattura").id).toBe("t2")
  })

  it("lists candidates on ambiguity", () => {
    const both = [task("t1", "Report agosto"), task("t2", "Report settembre")]
    expect(() => resolveTask(both, "report")).toThrow(/Report agosto, Report settembre/)
  })

  it("lists the pool on a miss", () => {
    expect(() => resolveTask(tasks, "kickoff")).toThrow(/Report agosto, Fattura Q3/)
    expect(() => resolveTask([], "kickoff")).toThrow(/Tasks: none/)
  })
})

describe("resolveEngagement", () => {
  const clients = [client("c1", "Acme Spa"), client("c2", "Beta Srl")]
  const pool = [
    engagement("e1", { name: "Migrazione cloud" }),
    engagement("e2", { name: "Migrazione dati", clientId: "c2" }),
    engagement("e3", { dailyRate: 700 }),
  ]

  it("matches by id, exact name, then substring — case-insensitive", () => {
    expect(resolveEngagement(pool, clients, "e3").id).toBe("e3")
    expect(resolveEngagement(pool, clients, "migrazione CLOUD").id).toBe("e1")
    expect(resolveEngagement(pool, clients, "dati").id).toBe("e2")
  })

  it("lists candidates by label, client and id on ambiguity", () => {
    expect(() => resolveEngagement(pool, clients, "migrazione")).toThrow(
      /Migrazione cloud \(Acme Spa, id e1\); Migrazione dati \(Beta Srl, id e2\)/
    )
  })

  it("lists the pool on a miss, unnamed contracts by their rate label", () => {
    expect(() => resolveEngagement(pool, clients, "sito")).toThrow(/10 days\/month × €700 \(Acme Spa, id e3\)/)
    expect(() => resolveEngagement([], clients, "sito")).toThrow(/Contracts: none/)
  })

  // With exactly one named contract, "" or "  " used to substring-match it and
  // return it — a write tool given a blank engagementId would pick it silently.
  it("refuses a blank query instead of matching every named contract", () => {
    const onlyOneNamed = [engagement("e1", { name: "Migrazione cloud" }), engagement("e3")]
    expect(() => resolveEngagement(onlyOneNamed, clients, "")).toThrow(/No contract given/)
    expect(() => resolveEngagement(onlyOneNamed, clients, "   ")).toThrow(/No contract given/)
  })
})

// ─── Capacity ────────────────────────────────────────────────────────────────

function invoice(id: string, number: string): Invoice {
  return {
    id, userId: "u", clientId: null, engagementId: "e1", number, fromMonth: null, yearMonth: "2026-04",
    amount: 5000, vat: 1100, dueDate: null, paidDate: null, paidAccountId: null, ...ts,
  }
}

function deadline(id: string, title: string): CompanyDeadline {
  return {
    id, userId: "u", title, date: new Date("2026-07-10"), kind: "admin",
    amount: null, notes: null, isDone: false, ...ts,
  }
}

describe("resolveInvoice", () => {
  const invoices = [invoice("i1", "2026/14"), invoice("i2", "2026/140"), invoice("i3", "7")]

  it("finds by id", () => {
    expect(resolveInvoice(invoices, "i2").number).toBe("2026/140")
  })

  it("finds by exact number", () => {
    expect(resolveInvoice(invoices, "2026/14").id).toBe("i1")
  })

  // The whole reason exact wins outright: "2026/14" is a substring of "2026/140",
  // so a substring-first ladder would call this ambiguous and refuse a valid number.
  it("prefers an exact number over the longer one it is a prefix of", () => {
    expect(resolveInvoice(invoices, "2026/14").id).toBe("i1")
  })

  it("finds by substring when only one matches", () => {
    expect(resolveInvoice(invoices, "140").id).toBe("i2")
  })

  it("throws on an ambiguous substring, listing the candidates", () => {
    expect(() => resolveInvoice(invoices, "2026")).toThrow(ToolInputError)
    expect(() => resolveInvoice(invoices, "2026")).toThrow(/2026\/14, 2026\/140/)
  })

  it("throws on a miss, listing what exists", () => {
    expect(() => resolveInvoice(invoices, "999")).toThrow(/Numbers: 2026\/14, 2026\/140, 7/)
  })
})

describe("resolveSolution", () => {
  // Made-up catalog: Nordwind Retail S.p.A.'s graph, and a second client with a solution of the same name.
  const clients = [client("c1", "Nordwind Retail S.p.A."), client("c2", "Sudwind Logistics"), client("c3", "Ostwind Foods")]
  const solution = (id: string, clientId: string, name: string): Solution => ({
    id, userId: "u", clientId, engagementId: null, name, status: "proposed", kind: "product", target: null, steps: [], domain: null, stack: [],
    sections: normalizeSolutionSections({}), entities: [], relations: [], ...ts,
  })
  const solutions = [
    solution("s1", "c1", "Product knowledge graph"),
    solution("s2", "c1", "Store search"),
    solution("s3", "c2", "Product Knowledge Graph"),
    solution("s4", "c3", "Supplier graph"),
    solution("s5", "c1", "Store search v2"),
  ]

  it("finds by id, by exact name ignoring case, and by a unique partial name", () => {
    expect(resolveSolution(solutions, clients, "s3").clientId).toBe("c2")
    expect(resolveSolution(solutions, clients, "store SEARCH").id).toBe("s2")
    expect(resolveSolution(solutions, clients, "supplier").id).toBe("s4")
  })

  it("refuses a name two clients share, listing each candidate with its client", () => {
    expect(() => resolveSolution(solutions, clients, "product knowledge graph")).toThrow(
      /Several solutions match "product knowledge graph": Product knowledge graph \(Nordwind Retail S\.p\.A\., id s1\); Product Knowledge Graph \(Sudwind Logistics, id s3\)\. Pass client/
    )
  })

  // As resolveInvoice: "Store search" is part of "Store search v2", so a substring-first ladder would refuse it.
  it("prefers an exact name over the longer one it is part of", () => {
    expect(resolveSolution(solutions, clients, "store search").id).toBe("s2")
  })

  it("narrows to one client's solutions when the client is given", () => {
    expect(resolveSolution(solutions, clients, "product knowledge graph", "c2").id).toBe("s3")
    expect(resolveSolution(solutions, clients, "graph", "c1").id).toBe("s1")
  })

  // client was passed already: asking for it again would send the same call back.
  it("asks only for the id when two of the given client's solutions match", () => {
    expect(() => resolveSolution(solutions, clients, "store", "c1")).toThrow(
      'Several solutions match "store": Store search (Nordwind Retail S.p.A., id s2); Store search v2 (Nordwind Retail S.p.A., id s5). Pass the id.'
    )
  })

  it("misses with the solutions it looked through", () => {
    expect(() => resolveSolution(solutions, clients, "billing", "c3")).toThrow(
      'No solution matches "billing" for Ostwind Foods. Solutions: Supplier graph (Ostwind Foods, id s4).'
    )
    expect(() => resolveSolution([], clients, "graph")).toThrow(/Solutions: none/)
  })

  it("solutionCard names the client and contract, Pre-sales without one, and the empty sections", () => {
    const linked = { ...solutions[0], engagementId: "e1", sections: normalizeSolutionSections({ purpose: "One graph" }) }
    const card = solutionCard(linked, clients, [engagement("e1", { name: "Product graph" })], [])
    expect(card).toMatchObject({ client: "Nordwind Retail S.p.A.", contract: "Product graph", contractState: "Active" })
    expect(card.missingSections).not.toContain("purpose")
    expect(solutionCard(solutions[1], clients, [], [])).toMatchObject({ contract: null, contractState: "Pre-sales" })
  })

  const step = (title: string, state: "done" | "now" | "next" | "later", paidBy: { type: "contract" | "opportunity"; id: string } | null = null) => ({
    title, state, fromMonth: "2026-03", toMonth: null, paidBy, goal: null, outcome: null, doneOn: null,
  })
  const opp = (id: string, clientId: string, title: string, engagementId: string | null = null) =>
    ({ id, clientId, title, engagementId }) as Opportunity

  it("solutionCard numbers the steps, names what pays for each (a won opportunity as its contract) and gives the Now step", () => {
    const road = { ...solutions[0], steps: [step("Audit", "done"), step("Tune", "now", { type: "opportunity", id: "o1" }), step("Review", "next", { type: "opportunity", id: "o2" })] }
    const card = solutionCard(road, clients, [engagement("e1", { name: "Product graph" })], [opp("o1", "c1", "Phase two", "e1"), opp("o2", "c1", "Phase three")])
    expect(card.steps.map((x) => [x.number, x.paidBy])).toEqual([
      [1, null],
      [2, { type: "contract", id: "e1", name: "Product graph" }],
      [3, { type: "opportunity", id: "o2", name: "Phase three" }],
    ])
    expect(card.nowStep).toMatchObject({ number: 2, title: "Tune" })
    expect(solutionCard(solutions[0], clients, [], [])).toMatchObject({ kind: "product", target: null, steps: [], nowStep: null })
  })

  it("resolveStepPayer finds the client's contract or opportunity by id, name or part of one, and refuses another client's", () => {
    const own = [engagement("e1", { clientId: "c1", name: "Product graph" }), engagement("e2", { clientId: "c2", name: "Fleet graph" })]
    const opps = [opp("o1", "c1", "Phase two"), opp("o2", "c2", "Fleet phase two")]
    const c1 = clients[0]
    expect(resolveStepPayer(c1, own, opps, "e1")).toEqual({ type: "contract", id: "e1" })
    expect(resolveStepPayer(c1, own, opps, "product GRAPH")).toEqual({ type: "contract", id: "e1" })
    expect(resolveStepPayer(c1, own, opps, "phase")).toEqual({ type: "opportunity", id: "o1" })
    expect(() => resolveStepPayer(c1, own, opps, "Fleet graph")).toThrow(/No contract or opportunity of Nordwind Retail S.p.A. matches "Fleet graph"/)
    expect(() => resolveStepPayer(c1, own, opps, "o2")).toThrow(/matches "o2"/)
    expect(() => resolveStepPayer(c1, own, opps, "  ")).toThrow(/matches/)
  })

  it("resolveStepPayer takes the contract when the name is shared with the opportunity it was converted from", () => {
    const c = [engagement("e1", { clientId: "c1", name: "Product graph" })]
    const won = { ...opp("o1", "c1", "Product graph"), engagementId: "e1" }
    expect(resolveStepPayer(clients[0], c, [won], "product graph")).toEqual({ type: "contract", id: "e1" })
    // An unrelated opportunity with the same name is still ambiguous.
    expect(() => resolveStepPayer(clients[0], c, [won, opp("o2", "c1", "Product graph")], "product graph")).toThrow(/Several match/)
  })
})

describe("resolveDeadline", () => {
  const deadlines = [deadline("d1", "Parcella commercialista"), deadline("d2", "Rinnovo hosting")]

  it("finds by id, exact title, and substring", () => {
    expect(resolveDeadline(deadlines, "d2").title).toBe("Rinnovo hosting")
    expect(resolveDeadline(deadlines, "Parcella commercialista").id).toBe("d1")
    expect(resolveDeadline(deadlines, "hosting").id).toBe("d2")
  })

  it("throws on an ambiguous substring", () => {
    const both = [deadline("d3", "Rinnovo dominio"), ...deadlines]
    expect(() => resolveDeadline(both, "Rinnovo")).toThrow(ToolInputError)
  })

  it("throws on a miss with an empty list", () => {
    expect(() => resolveDeadline([], "qualsiasi")).toThrow(/Deadlines: none/)
  })
})

describe("appendNote", () => {
  it("starts a fresh notes field", () => {
    expect(appendNote(null, "[2026-08-21] prima nota")).toBe("[2026-08-21] prima nota")
  })

  it("appends on a new line", () => {
    expect(appendNote("vecchia", "[2026-08-21] nuova")).toBe("vecchia\n[2026-08-21] nuova")
  })

  it("throws when the combined text exceeds the cap", () => {
    expect(() => appendNote("x".repeat(995), "[2026-08-21] troppo")).toThrow(ToolInputError)
  })

  it("accepts a combined text exactly at the cap", () => {
    expect(appendNote("x".repeat(994), "y".repeat(5))).toHaveLength(1000)
  })
})

describe("allocatedDaysForMonth", () => {
  const engagements = [
    engagement("e1", { defaultDaysPerMonth: 10 }),
    engagement("e2", { defaultDaysPerMonth: 8, startMonth: "2026-09" }),
    engagement("e3", { defaultDaysPerMonth: 5, isActive: false }),
  ]

  it("uses explicit days when present, default otherwise", () => {
    expect(allocatedDaysForMonth(engagements, [allocation("e1", "2026-08", 3)], "2026-08")).toBe(3)
    expect(allocatedDaysForMonth(engagements, [], "2026-08")).toBe(10)
  })

  it("gates on startMonth and skips inactive engagements", () => {
    expect(allocatedDaysForMonth(engagements, [], "2026-09")).toBe(18) // e2 starts
    expect(allocatedDaysForMonth(engagements, [], "2026-08")).toBe(10) // e2 not yet, e3 never
  })

  it("treats a stored 0 as zero, not as missing", () => {
    expect(allocatedDaysForMonth(engagements, [allocation("e1", "2026-08", 0)], "2026-08")).toBe(0)
  })

  // Keeps this helper and the revenue engine in lockstep without coupling them.
  it("equals the grid's plannedDays sum for the same month", () => {
    const allocations = [allocation("e1", "2026-08", 4)]
    const sources = toRevenueSources({
      engagements,
      opportunities: [],
      clients: [client("c1", "Acme")],
      scenario: "committed",
    })
    const cells = resolveAllocationGrid({ sources, allocations, fromMonth: "2026-08", months: 1 })
    const gridPlanned = cells.reduce((s, c) => s + c.plannedDays, 0)
    expect(allocatedDaysForMonth(engagements, allocations, "2026-08")).toBe(gridPlanned)
  })
})

describe("capacityForMonths", () => {
  const engagements = [engagement("e1", { defaultDaysPerMonth: 15 })]

  it("defaults availableDays to the weekday count", () => {
    const [aug] = capacityForMonths({ engagements, allocations: [], capacityDocs: [], from: "2026-08", months: 1 })
    expect(aug.availableDays).toBe(21)
    expect(aug.allocatedDays).toBe(15)
    expect(aug.remaining).toBe(6)
    expect(aug.overbooked).toBe(false)
  })

  // #156: a closed contract is on the calendar up to its end, and off it after —
  // except for a row typed past the end, which the grid still counts too.
  it("counts a closed contract up to its endMonth only", () => {
    const closed = [engagement("e1", { defaultDaysPerMonth: 10, isActive: false, endMonth: "2026-06" })]
    const months = capacityForMonths({ engagements: closed, allocations: [], capacityDocs: [], from: "2026-05", months: 3 })
    expect(months.map((m) => m.allocatedDays)).toEqual([10, 10, 0])
    expect(allocatedDaysForMonth(closed, [allocation("e1", "2026-08", 2)], "2026-08")).toBe(2)
  })

  // #154 acceptance 4: an ACTIVE contract with a planned end frees the months after it.
  it("stops counting an active contract's default days after its endMonth", () => {
    const bounded = [engagement("e1", { defaultDaysPerMonth: 10, endMonth: "2027-02" })]
    expect(allocatedDaysForMonth(bounded, [], "2027-02")).toBe(10)
    expect(allocatedDaysForMonth(bounded, [], "2027-03")).toBe(0)
    expect(allocatedDaysForMonth(bounded, [allocation("e1", "2027-03", 3)], "2027-03")).toBe(3)
    const months = capacityForMonths({ engagements: bounded, allocations: [], capacityDocs: [], from: "2027-01", months: 3 })
    expect(months.map((m) => m.allocatedDays)).toEqual([10, 10, 0])
  })

  it("honours a capacity doc and flags overbooking", () => {
    const doc = { yearMonth: "2026-08", daysOff: 11, availableDays: 10, reason: "vacation" as const, note: null }
    const [aug] = capacityForMonths({ engagements, allocations: [], capacityDocs: [doc], from: "2026-08", months: 1 })
    expect(aug.availableDays).toBe(10)
    expect(aug.reason).toBe("vacation")
    expect(aug.overbooked).toBe(true)
    expect(aug.remaining).toBe(-5)
  })

  it("iterates across year boundaries", () => {
    const months = capacityForMonths({ engagements, allocations: [], capacityDocs: [], from: "2026-11", months: 3 })
    expect(months.map((m) => m.yearMonth)).toEqual(["2026-11", "2026-12", "2027-01"])
  })
})

// #159: capacity read the fill again (row ?? default) with no budget, so a spent contract
// kept taking days — and raising overbooking warnings — in months the plan does not bill.
// "was" values are from before the fix.
describe("capacity reads the plan (#159)", () => {
  const acme = [client("c1", "Acme")]
  const spent = (contractedDays: number) => [
    engagement("A", { dailyRate: 500, contractedDays, startMonth: "2026-06" }),
    engagement("B", { dailyRate: 500, defaultDaysPerMonth: 12 }),
  ]
  const capacity = (engagements: Engagement[], allocations: Allocation[] = [], capacityDocs: CapacityDoc[] = []) =>
    capacityForMonths({ engagements, allocations, capacityDocs, from: "2026-09", months: 4 })

  it("stops counting a contract once its budget is spent", () => {
    // A: 40 days at 10/month from June → Sep bills its last 10. B: open-ended at 12.
    expect(capacity(spent(40)).map((m) => m.allocatedDays)).toEqual([22, 12, 12, 12]) // was [22, 22, 22, 22]
  })

  it("counts only the leftover in the month the budget runs out", () => {
    expect(capacity(spent(35)).map((m) => m.allocatedDays)).toEqual([17, 12, 12, 12]) // was [22, 22, 22, 22]
  })

  it("raises no overbooking from a contract the plan does not bill", () => {
    const doc: CapacityDoc = { yearMonth: "2026-10", daysOff: 8, availableDays: 14, reason: "vacation", note: null }
    const oct = capacity(spent(40), [], [doc])[1]
    expect(oct).toMatchObject({ allocatedDays: 12, remaining: 2, overbooked: false }) // was 22, −8, true
  })

  it("still counts days typed past the budget", () => {
    const typed = capacity(spent(40), [allocation("A", "2026-11", 15)])
    expect(typed.map((m) => m.allocatedDays)).toEqual([22, 12, 27, 12]) // was [22, 22, 27, 22]
  })

  it("agrees with the plan grid's billable days in every month with no row", () => {
    for (const engagements of [spent(40), spent(35)]) {
      const sources = toRevenueSources({ engagements, opportunities: [], clients: acme, scenario: "committed" })
      const grid = resolveAllocationGrid({ sources, allocations: [], fromMonth: "2026-09", months: 4 })
      for (const m of capacity(engagements)) {
        const billable = grid.filter((c) => c.yearMonth === m.yearMonth).reduce((s, c) => s + c.billableDays, 0)
        expect(m.allocatedDays, m.yearMonth).toBe(billable)
      }
    }
  })

  // The budget burns from the first row (#155): drop the rows before the month and
  // the contract looks untouched.
  it("needs every row, not only the month's", () => {
    const engagements = [
      engagement("A", { dailyRate: 500, contractedDays: 40 }),
      engagement("B", { dailyRate: 500, defaultDaysPerMonth: 12 }),
    ]
    const rows = ["2026-06", "2026-07", "2026-08"].map((ym) => allocation("A", ym, 10))
    expect(allocatedDaysForMonth(engagements, rows, "2026-10")).toBe(12)
    expect(allocatedDaysForMonth(engagements, [], "2026-10")).toBe(22)
  })
})

// A contract with no start and no row is walked from wherever the walk begins (#155).
// Each tool walked from the month it was asked about, so capacity and log_allocation
// handed it a fresh budget in every future month; get_plan walks from this month.
// "was" = f71315f.
describe("an unanchored budget agrees with get_plan (#159)", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 8, 27))
  })
  afterEach(() => vi.useRealTimers())

  const acme = [client("c1", "Acme")]
  const plan = (engagements: Engagement[], allocations: Allocation[] = []) =>
    revenueCells({
      sources: toRevenueSources({ engagements, opportunities: [], clients: acme, scenario: "committed" }),
      allocations,
      from: "2026-09",
      to: "2026-12",
    })

  it("takes no capacity in a month the plan does not bill", () => {
    const engagements = [engagement("A", { dailyRate: 500, contractedDays: 20 })]
    expect(plan(engagements).map((c) => c.billableDays)).toEqual([10, 10, 0, 0])
    const months = capacityForMonths({ engagements, allocations: [], capacityDocs: [], from: "2026-09", months: 4 })
    expect(months.map((m) => m.allocatedDays)).toEqual([10, 10, 0, 0]) // was [10, 10, 10, 10]
    expect(allocatedDaysForMonth(engagements, [], "2026-11")).toBe(0) // was 10
  })

  it("reports log_allocation's budget left as get_plan does", () => {
    const engagements = [engagement("A", { dailyRate: 500, contractedDays: 40 })]
    const rows = [allocation("A", "2026-11", 10)]
    const sources = toRevenueSources({ engagements, opportunities: [], clients: acme, scenario: "committed" })
    const [logged] = revenueCells({ sources, allocations: rows, from: "2026-11", to: "2026-11" })
    expect(logged.remainingDays).toBe(10) // was 30
    expect(logged).toEqual(plan(engagements, rows)[2])
    // get_revenue on a later window: nothing left to bill.
    expect(revenueCells({ sources, allocations: rows, from: "2027-01", to: "2027-03" }).map((c) => c.billableDays)).toEqual([0, 0, 0]) // was [10, 10, 10]
  })
})

// ─── Revenue ─────────────────────────────────────────────────────────────────

describe("revenueCells + groupRevenue", () => {
  const clients = [client("c1", "Acme"), client("c2", "Beta")]
  const engagements = [
    engagement("e1", { clientId: "c1", dailyRate: 1000, defaultDaysPerMonth: 10 }),
    engagement("e2", { clientId: "c2", dailyRate: 500, defaultDaysPerMonth: 4 }),
  ]
  const sources = toRevenueSources({ engagements, opportunities: [], clients, scenario: "committed" })

  it("matches the UI grid when from == the grid origin", () => {
    const cells = revenueCells({ sources, allocations: [], from: "2026-08", to: "2026-10" })
    const uiCells = resolveAllocationGrid({ sources, allocations: [], fromMonth: "2026-08", months: 3 })
    expect(cells).toEqual(uiCells)
  })

  it("groups by month with per-cell round2 revenue", () => {
    const rows = groupRevenue(revenueCells({ sources, allocations: [], from: "2026-08", to: "2026-09" }), "month")
    expect(rows).toEqual([
      { key: "2026-08", revenue: 12000, plannedDays: 14, billableDays: 14 },
      { key: "2026-09", revenue: 12000, plannedDays: 14, billableDays: 14 },
    ])
  })

  it("names a group's amounts in hours when every contract in it is hourly (as get_plan does), else keeps days", () => {
    const cells = revenueCells({ sources, allocations: [], from: "2026-08", to: "2026-08" })
    // e1 (Acme, 10 days) hourly, e2 (Beta, 4 days) not.
    const hourly = (id: string) => id === "e1"
    expect(groupRevenue(cells, "client", hourly)).toEqual([
      { key: "Acme", revenue: 10000, plannedHours: 80, billableHours: 80 },
      { key: "Beta", revenue: 2000, plannedDays: 4, billableDays: 4 },
    ])
    // A month holding both has no single unit: days.
    expect(groupRevenue(cells, "month", hourly)).toEqual([{ key: "2026-08", revenue: 12000, plannedDays: 14, billableDays: 14 }])
  })

  it("groups by quarter and by client", () => {
    const cells = revenueCells({ sources, allocations: [], from: "2026-08", to: "2026-10" })
    expect(groupRevenue(cells, "quarter").map((r) => r.key)).toEqual(["2026-Q3", "2026-Q4"])
    // client rows sorted by revenue, descending
    expect(groupRevenue(cells, "client").map((r) => r.key)).toEqual(["Acme", "Beta"])
  })

  it("weights opportunity cells like the projection does", () => {
    const weighted = toRevenueSources({
      engagements: [],
      opportunities: [
        {
          id: "o1", userId: "u", clientId: "c1", title: "Deal", stage: "proposal", probability: 50,
          dailyRate: 1000, estimatedDaysPerMonth: 10, estimatedDurationMonths: 6,
          expectedStartMonth: null, vatApplicable: true, nextActionDate: null, nextActionNote: null,
          notes: null, lostReason: null, closedAt: null, engagementId: null, ...ts,
        },
      ],
      clients,
      scenario: "weighted",
    })
    const rows = groupRevenue(revenueCells({ sources: weighted, allocations: [], from: "2026-08", to: "2026-08" }), "month")
    expect(rows[0].revenue).toBe(5000) // 10 days × 1000 × 0.5
  })

  it("agrees with the Plan grid on shared months from any origin (#155)", () => {
    const burning = toRevenueSources({
      engagements: [engagement("e1", { startMonth: "2026-01", contractedDays: 100, defaultDaysPerMonth: 10, dailyRate: 1000 })],
      opportunities: [],
      clients,
      scenario: "committed",
    })
    const logged = ["01", "02", "03", "04", "05", "06", "07"].map((m) => allocation("e1", `2026-${m}`, 10))
    const plan = resolveAllocationGrid({ sources: burning, allocations: logged, fromMonth: "2026-09", months: 4 })
    expect(revenueCells({ sources: burning, allocations: logged, from: "2026-11", to: "2026-12" })).toEqual(plan.slice(2))

    const rows = groupRevenue(revenueCells({ sources: burning, allocations: logged, from: "2026-09", to: "2026-12" }), "month")
    expect(rows.map((r) => r.plannedDays)).toEqual([10, 10, 10, 10])
    // was [10, 10, 10, 10] and 40000: the window start handed out a fresh 100-day budget
    expect(rows.map((r) => r.billableDays)).toEqual([10, 10, 0, 0])
    expect(rows.reduce((s, r) => s + r.revenue, 0)).toBe(20000)
  })
})

describe("groupInvoices", () => {
  const inv = (yearMonth: string, clientName: string, amount: number, vat: number) => ({
    yearMonth,
    clientName,
    amount,
    vat,
  })

  const items = [
    inv("2026-08", "Acme", 10000, 2200),
    inv("2026-08", "Beta", 2000, 440),
    inv("2026-10", "Acme", 5000, 1100),
  ]

  it("groups by month, ascending", () => {
    expect(groupInvoices(items, "month")).toEqual([
      { key: "2026-08", revenue: 12000, vat: 2640, count: 2 },
      { key: "2026-10", revenue: 5000, vat: 1100, count: 1 },
    ])
  })

  it("groups by quarter", () => {
    expect(groupInvoices(items, "quarter")).toEqual([
      { key: "2026-Q3", revenue: 12000, vat: 2640, count: 2 },
      { key: "2026-Q4", revenue: 5000, vat: 1100, count: 1 },
    ])
  })

  it("groups by client, revenue descending", () => {
    expect(groupInvoices(items, "client")).toEqual([
      { key: "Acme", revenue: 15000, vat: 3300, count: 2 },
      { key: "Beta", revenue: 2000, vat: 440, count: 1 },
    ])
  })

  it("rounds the group total to cents", () => {
    const [row] = groupInvoices(
      [inv("2026-08", "Acme", 0.1, 0.02), inv("2026-08", "Acme", 0.2, 0.04)],
      "month"
    )
    expect(row.revenue).toBe(0.3) // not 0.30000000000000004
    expect(row.vat).toBe(0.06)
  })

  it("lets a nota di credito reduce its group", () => {
    const [row] = groupInvoices(
      [inv("2026-08", "Acme", 10000, 2200), inv("2026-08", "Acme", -1500, -330)],
      "month"
    )
    expect(row).toEqual({ key: "2026-08", revenue: 8500, vat: 1870, count: 2 })
  })

  it("is empty for no invoices", () => {
    expect(groupInvoices([], "month")).toEqual([])
  })
})

// ─── Timecards ───────────────────────────────────────────────────────────────

describe("timecardDecision", () => {
  const stored = { hours: 6, notes: null }

  it("creates on an empty day and ignores a 0 there", () => {
    expect(timecardDecision(undefined, { hours: 6 })).toBe("create")
    expect(timecardDecision(undefined, { hours: 0 })).toBe("unchanged")
  })

  it("treats the same hours as a retry, unless a new note comes with them", () => {
    expect(timecardDecision(stored, { hours: 6 })).toBe("unchanged")
    expect(timecardDecision(stored, { hours: 6, notes: undefined, replace: true })).toBe("unchanged")
    expect(timecardDecision({ hours: 6, notes: "call" }, { hours: 6, notes: "call" })).toBe("unchanged")
    expect(timecardDecision(stored, { hours: 6, notes: "call" })).toBe("update")
    // "" and null are both no note: clearing an empty one is a retry, clearing a note an edit.
    expect(timecardDecision(stored, { hours: 6, notes: "" })).toBe("unchanged")
    expect(timecardDecision({ hours: 6, notes: "" }, { hours: 6, notes: null })).toBe("unchanged")
    expect(timecardDecision({ hours: 6, notes: "call" }, { hours: 6, notes: null })).toBe("update")
  })

  it("refuses different hours on a filled day unless replace", () => {
    expect(timecardDecision(stored, { hours: 5 })).toBe("conflict")
    expect(timecardDecision(stored, { hours: 5, replace: false })).toBe("conflict")
    expect(timecardDecision(stored, { hours: 5, replace: true })).toBe("update")
  })

  it("deletes on 0 without needing replace", () => {
    expect(timecardDecision(stored, { hours: 0 })).toBe("delete")
  })
})

describe("groupTimecards", () => {
  const tc = (engagementId: string, date: string, hours: number) => ({ engagementId, date, hours })
  const cards = [
    tc("e2", "2026-09-22", 2),
    tc("e1", "2026-09-21", 6),
    tc("e1", "2026-09-22", 7.5),
    tc("e1", "2026-10-01", 4),
  ]

  it("keeps one row per day and contract, in date order", () => {
    expect(groupTimecards(cards, "day")).toEqual([
      { key: "2026-09-21", engagementId: "e1", hours: 6, days: 0.75 },
      { key: "2026-09-22", engagementId: "e1", hours: 7.5, days: 0.9375 },
      { key: "2026-09-22", engagementId: "e2", hours: 2, days: 0.25 },
      { key: "2026-10-01", engagementId: "e1", hours: 4, days: 0.5 },
    ])
  })

  it("sums a contract's ISO week, which may span two months", () => {
    expect(groupTimecards(cards, "week")).toEqual([
      { key: "2026-W39", engagementId: "e1", hours: 13.5, days: 1.6875 },
      { key: "2026-W39", engagementId: "e2", hours: 2, days: 0.25 },
      { key: "2026-W40", engagementId: "e1", hours: 4, days: 0.5 },
    ])
  })

  it("keys the last days of 2026 to 2026-W53 and 2027-01-04 to 2027-W01", () => {
    const rows = groupTimecards(
      [tc("e1", "2026-12-31", 8), tc("e1", "2027-01-03", 1), tc("e1", "2027-01-04", 2)],
      "week"
    )
    expect(rows.map((r) => [r.key, r.hours])).toEqual([
      ["2026-W53", 9],
      ["2027-W01", 2],
    ])
  })

  it("sums months per contract and rounds away float dust", () => {
    expect(groupTimecards([...cards, tc("e1", "2026-09-23", 0.1), tc("e1", "2026-09-24", 0.2)], "month")).toEqual([
      { key: "2026-09", engagementId: "e1", hours: 13.8, days: 1.725 },
      { key: "2026-09", engagementId: "e2", hours: 2, days: 0.25 },
      { key: "2026-10", engagementId: "e1", hours: 4, days: 0.5 },
    ])
    expect(groupTimecards([tc("e1", "2026-09-23", 0.1), tc("e1", "2026-09-24", 0.2)], "month")[0].hours).toBe(0.3)
  })

  it("is empty for no timecards", () => {
    expect(groupTimecards([], "week")).toEqual([])
  })
})

// ─── Cash book ───────────────────────────────────────────────────────────────

function companyAccount(id: string, name: string): CompanyAccount {
  return {
    id, userId: "u", name, openingBalance: 0, openingDate: new Date("2026-05-01T00:00:00"),
    statementBalance: null, statementDate: null, importRef: null, ...ts,
  }
}

describe("resolveCompanyAccount", () => {
  const accounts = [companyAccount("a1", "Main Bank"), companyAccount("a2", "Second Bank"), companyAccount("a3", "Cash Box")]

  it("finds by id, exact name and a unique substring, any case", () => {
    expect(resolveCompanyAccount(accounts, "a2").name).toBe("Second Bank")
    expect(resolveCompanyAccount(accounts, "main bank").id).toBe("a1")
    expect(resolveCompanyAccount(accounts, "cash").id).toBe("a3")
  })

  it("lists the accounts when the name is ambiguous or unknown", () => {
    expect(() => resolveCompanyAccount(accounts, "bank")).toThrow('Several company accounts match "bank": Main Bank, Second Bank.')
    expect(() => resolveCompanyAccount(accounts, "Third")).toThrow(
      'No company account matches "Third". Company accounts: Main Bank, Second Bank, Cash Box.',
    )
  })

  // A cash box never takes a payment silently: with two or more, say which.
  it("takes the only account when none is named, and asks when there are several", () => {
    expect(resolveCompanyAccount([accounts[0]], undefined).id).toBe("a1")
    expect(() => resolveCompanyAccount(accounts, undefined)).toThrow("Which company account? Pass account: Main Bank, Second Bank, Cash Box.")
    expect(() => resolveCompanyAccount(accounts, "  ", " Or owner.")).toThrow(/Cash Box\. Or owner\.$/)
    // add_expense reads it from paidFrom: a refusal never names a parameter the tool doesn't have.
    expect(() => resolveCompanyAccount(accounts, undefined, "", "paidFrom")).toThrow("Which company account? Pass paidFrom: Main Bank")
    expect(() => resolveCompanyAccount([], "Main")).toThrow(/No company account yet/)
  })
})

describe("refuseDuplicate", () => {
  const main = companyAccount("a1", "Main Bank")
  const movement: CompanyMovement = {
    id: "m1", userId: "u", kind: "vat", direction: "out", amount: 300, date: new Date("2026-10-16T00:00:00"), accountId: "a1",
    toAccountId: null, expenseId: null, description: "VAT (F24)", documentRef: null, project: null, counterparty: null, notes: null,
    dateEstimated: false, importRef: null, ...ts,
  }
  const rows = cashRows({ invoices: [], expenses: [], loans: [], movements: [movement] })

  it("refuses the same account, day and signed amount, naming the row", () => {
    expect(() => refuseDuplicate(rows, main, "2026-10-16", -300)).toThrow(
      'Already in the Cash Book: VAT (F24), €300.00 from Main Bank on 16/10/2026 (movement m1). Pass force: true if it really is a second one.',
    )
  })

  it("lets another day, amount, direction or account through", () => {
    expect(() => refuseDuplicate(rows, main, "2026-10-17", -300)).not.toThrow()
    expect(() => refuseDuplicate(rows, main, "2026-10-16", -300.01)).not.toThrow()
    expect(() => refuseDuplicate(rows, main, "2026-10-16", 300)).not.toThrow()
    expect(() => refuseDuplicate(rows, companyAccount("a2", "Second Bank"), "2026-10-16", -300)).not.toThrow()
  })
})

function cost(id: string, over: Partial<CompanyExpense>): CompanyExpense {
  return {
    id, userId: "u", description: id, category: "other", amount: 100, date: new Date("2026-10-01T00:00:00"), isRecurring: false,
    recurrenceMonths: null, notes: null, accountId: null, paidByOwner: false, vat: 0, documentRef: null, project: null,
    recurringExpenseId: null, dateEstimated: false, importRef: null, collaboratorId: null, engagementId: null, forMonth: null, ...ts, ...over,
  }
}

describe("resolveSupplierInvoice", () => {
  const bill = cost("e1", { description: "Plumber", amount: 500, vat: 110, documentRef: "PL-1" })
  const paid: CompanyMovement = {
    id: "m1", userId: "u", kind: "supplier_payment", direction: "out", amount: 210, date: new Date("2026-10-02T00:00:00"),
    accountId: "a1", toAccountId: null, expenseId: "e1", description: "x", documentRef: "PL-1", project: null, counterparty: null,
    notes: null, dateEstimated: false, importRef: null, ...ts,
  }

  it("finds a supplier invoice by number, any case, or id, with what is still owed", () => {
    expect(resolveSupplierInvoice([bill], [paid], "pl-1", 400)).toMatchObject({ total: 610, paid: 210, owed: 400 })
    expect(resolveSupplierInvoice([bill], [], "e1", 1).expense.id).toBe("e1")
  })

  it("never pays more than is owed, and lists the open invoices on a miss", () => {
    expect(() => resolveSupplierInvoice([bill], [paid], "PL-1", 400.01)).toThrow("Only €400.00 is owed on PL-1.")
    expect(() => resolveSupplierInvoice([bill], [paid], "PL-2", 1)).toThrow(
      'No supplier invoice on Costs matches "PL-2". Open supplier invoices: PL-1 (Plumber, €400.00 owed).',
    )
    // Paid from an account, it is a cost, not a supplier invoice to pay.
    expect(() => resolveSupplierInvoice([{ ...bill, accountId: "a1" }], [], "PL-1", 1)).toThrow(/Open supplier invoices: none/)
  })

  it("asks for the id when two supplier invoices share a number", () => {
    const twin = cost("e2", { description: "Plumber again", amount: 50, documentRef: "pl-1" })
    expect(() => resolveSupplierInvoice([bill, twin], [], "PL-1", 1)).toThrow(
      'Several supplier invoices are numbered "PL-1": Plumber (id e1); Plumber again (id e2). Pass the id.',
    )
    expect(resolveSupplierInvoice([bill, twin], [], "e2", 1).expense.id).toBe("e2")
  })
})

describe("resolveEstimate", () => {
  const estimates = [cost("r1", { description: "Accountant fee", isRecurring: true }), cost("r2", { description: "Office rent", isRecurring: true })]

  it("finds by id, exact description and substring, and lists the estimates on a miss", () => {
    expect(resolveEstimate(estimates, "r2").description).toBe("Office rent")
    expect(resolveEstimate(estimates, "accountant fee").id).toBe("r1")
    expect(resolveEstimate(estimates, "rent").id).toBe("r2")
    expect(() => resolveEstimate(estimates, "Hosting")).toThrow(/Recurring costs: Accountant fee, Office rent\. Pass paysRecurring "none"/)
  })

  it("asks to be more specific when several match", () => {
    expect(() => resolveEstimate(estimates, "f")).toThrow('Several recurring costs match "f": Accountant fee, Office rent. Be more specific.')
  })
})

describe("costCentreLabel", () => {
  const book = { expenses: [cost("e1", { project: "Flat Rental" })], movements: [] }

  it("takes the book's spelling of a label in use, any case, and says when one is new", () => {
    expect(costCentreLabel(" flat rental ", book)).toEqual({ label: "Flat Rental", isNew: false })
    expect(costCentreLabel("consulting", book)).toEqual({ label: "Consulting", isNew: false })
    expect(costCentreLabel("Room 5", book)).toEqual({ label: "Room 5", isNew: true })
    expect(costCentreLabel(undefined, book)).toEqual({ label: null, isNew: false })
  })
})


describe("bookFigures + figureChanges", () => {
  const today = "2026-10-20"
  const main = companyAccount("a1", "Main Bank")
  const later = { ...companyAccount("a2", "New Bank"), openingDate: new Date("2026-12-01T00:00:00") }
  const move = (id: string, over: Partial<CompanyMovement>): CompanyMovement => ({
    id, userId: "u", kind: "income", direction: "in", amount: 650, date: new Date("2026-10-03T00:00:00"), accountId: "a1",
    toAccountId: null, expenseId: null, description: id, documentRef: null, project: null, counterparty: "Room 2", notes: null,
    dateEstimated: false, importRef: null, ...ts, ...over,
  })
  const book = {
    accounts: [main, later],
    invoices: [],
    expenses: [cost("rent", { amount: 1850, accountId: "a1" }), cost("card", { amount: 40, paidByOwner: true }), cost("bill", { amount: 300, documentRef: "B-1" })],
    loans: [],
    movements: [move("rent-in", {}), move("deposit", { kind: "deposit_held", amount: 900 })],
    clients: [],
    engagements: [],
  }

  it("takes the page's figures: balances today (null before an account opens), owed, held, the Plan's month", () => {
    expect(Object.fromEntries(bookFigures(book, ["2026-10"], today))).toEqual({
      "Main Bank balance today": -300,
      "New Bank balance today": null,
      "You Owe Suppliers": 300,
      "SRL Owes You": 40,
      "Deposits to give back": 900,
      "Deposits to get back": 0,
      "Plan other costs in October 2026": 2190,
    })
  })

  it("says only what moved, in order, and words it as the pages do", () => {
    const after = { ...book, expenses: book.expenses.filter((e) => e.id !== "rent") }
    const changes = figureChanges(bookFigures(book, ["2026-10"], today), bookFigures(after, ["2026-10"], today))
    expect(changes).toEqual([
      { figure: "Main Bank balance today", before: -300, after: 1550 },
      { figure: "Plan other costs in October 2026", before: 2190, after: 340 },
    ])
    expect(changes.map(figureLine)).toEqual(["Main Bank balance today -€300.00 → €1,550.00", "Plan other costs in October 2026 €2,190.00 → €340.00"])
    expect(figureLine({ figure: "New Bank balance today", before: null, after: null })).toBe("New Bank balance today not open yet → not open yet")
  })
})

// ─── Month End ───────────────────────────────────────────────────────────────

describe("monthToClose", () => {
  it("takes the last month that has ended when none is asked", () => {
    expect(monthToClose(undefined, "2026-10-10")).toBe("2026-09")
    expect(monthToClose(undefined, "2027-01-01")).toBe("2026-12")
  })

  it("reads a month name as its most recent ended occurrence, across the year end", () => {
    expect(monthToClose("September", "2026-10-10")).toBe("2026-09")
    expect(monthToClose("sep", "2026-10-10")).toBe("2026-09")
    expect(monthToClose(" AUGUST ", "2026-10-10")).toBe("2026-08")
    // The current month's name is last year's: this year's has not ended.
    expect(monthToClose("October", "2026-10-10")).toBe("2025-10")
    expect(monthToClose("December", "2027-01-15")).toBe("2026-12")
    expect(monthToClose("january", "2027-01-15")).toBe("2026-01")
  })

  it("refuses the current month and a later one, naming the last it can close", () => {
    expect(() => monthToClose("2026-10", "2026-10-10")).toThrow(
      "2026-10 can't be closed until 1 November 2026: its hours and invoices are still open. Ask for 2026-09 or earlier.",
    )
    expect(() => monthToClose("2027-02-03", "2026-10-10")).toThrow(/until 1 March 2027/)
    expect(monthToClose("2026-09-15", "2026-10-10")).toBe("2026-09")
  })

  it("refuses what is not a month: an Italian name is translated first", () => {
    expect(() => monthToClose("settembre", "2026-10-10")).toThrow(ToolInputError)
    expect(() => monthToClose("settembre", "2026-10-10")).toThrow('Invalid month: "settembre". Use YYYY-MM, or an English month name such as September.')
    expect(() => monthToClose("ma", "2026-10-10")).toThrow(/Invalid month/)
    expect(() => monthToClose("2026-13", "2026-10-10")).toThrow(/Invalid date/)
  })
})

describe("monthEndNext", () => {
  // Made-up names and amounts. Today 10 Oct 2026, closing September.
  const TODAY = "2026-10-10"
  const day = (iso: string) => new Date(`${iso}T00:00:00`)
  const hours = (engagementId: string, ym: string, days: number): Timecard[] =>
    Array.from({ length: days }, (_, k) => ({
      id: `${engagementId}-${ym}-${k}`, userId: "u", engagementId, collaboratorId: null, date: `${ym}-${String(k + 1).padStart(2, "0")}`, hours: 8, notes: null, ...ts,
    }))
  const bill = (id: string, over: Partial<Invoice>): Invoice => ({ ...invoice(id, id), engagementId: null, vat: 0, ...over })
  const main = companyAccount("main", "Main Bank")
  const data = {
    clients: [client("c1", "Lumen Srl"), client("c2", "Studio Verdi"), client("c9", "Nordica Spa")],
    engagements: [
      engagement("e1", { clientId: "c1", name: "Retainer", dailyRate: 450, startMonth: "2026-09" }),
      engagement("e2", { clientId: "c2", name: "Support", dailyRate: 600, defaultDaysPerMonth: 5, startMonth: "2026-08", vatApplicable: false }),
    ],
    allocations: [allocation("e2", "2026-08", 5)],
    // Lumen: 9 days logged in September, 10 planned. Studio Verdi: August logged, September not.
    timecards: [...hours("e1", "2026-09", 9), ...hours("e2", "2026-08", 5)],
    invoices: [
      // Studio Verdi's August invoice, recorded on October.
      bill("15/2026", { clientId: "c2", yearMonth: "2026-10", amount: 3000, dueDate: day("2026-11-09") }),
      bill("9/2026", { clientId: "c9", yearMonth: "2026-06", amount: 1500, dueDate: day("2026-07-31") }),
      // Paid since the book began, into no account.
      bill("8/2026", { clientId: "c9", yearMonth: "2026-07", amount: 500, paidDate: day("2026-08-20") }),
    ],
    accounts: [main],
    movements: [
      {
        id: "m-est", userId: "u", kind: "income", direction: "in", amount: 200, date: day("2026-09-05"), accountId: "main",
        toAccountId: null, expenseId: null, description: "Room rent", documentRef: null, project: null, counterparty: "Room 1",
        notes: null, dateEstimated: true, importRef: null, ...ts,
      } satisfies CompanyMovement,
    ],
    expenses: [
      cost("cloud-est", { description: "Cloud plan", category: "software", amount: 50, isRecurring: true, date: day("2026-07-01") }),
      cost("cloud-sep", { description: "Cloud September", category: "software", amount: 50, accountId: "main", documentRef: "C-9", date: day("2026-09-12") }),
      cost("lunch", { description: "Team lunch", category: "office_supplies", amount: 80, accountId: "main", date: day("2026-09-03") }),
      cost("st-9", { description: "Studio fee", category: "accountant", amount: 1000, documentRef: "ST-9", date: day("2026-09-10") }),
    ],
    loans: [],
    deadlines: [{ ...deadline("d1", "Renew domain"), date: day("2026-09-20") }],
  }
  const checklist = monthEndChecklist(data, "2026-09", TODAY)
  const next = monthEndNext(checklist, data, TODAY)
  /** Each open item's text with what to call next. */
  const of = (key: keyof typeof checklist.steps) => checklist.steps[key].items.filter((i) => i.status !== "done").map((i) => [i.text, next.get(i)])

  it("hours: Use with the days logged, log the missing ones or set the month to 0", () => {
    expect(of("hours")).toEqual([
      [
        "Lumen Srl · Retainer: 9 d logged, 10 d planned",
        [{ tool: "log_allocation", args: { client: "Lumen Srl", engagementId: "e1", month: "2026-09", mode: "set", days: 9 }, note: "Use: puts the days logged in the plan." }],
      ],
      [
        "Studio Verdi · Support: no hours logged",
        [
          { tool: "log_time", args: { engagementId: "e2" }, note: "One call per day worked in September: date, and hours (the day's total)." },
          { tool: "log_allocation", args: { client: "Studio Verdi", engagementId: "e2", month: "2026-09", mode: "set", days: 0 }, note: "No work that month: sets it to 0 days." },
        ],
      ],
    ])
  })

  it("invoices: Ready to Invoice's draft, numbered as get_unbilled numbers it; a misdated invoice's period first", () => {
    const drafts = invoiceDrafts({
      invoices: data.invoices,
      engagements: data.engagements,
      billed: ["c1", "c2"].map((clientId) => clientBilling({ clientId, ...data, today: TODAY })),
      today: TODAY,
    })
    // Numbered in turn after the highest number recorded, 15/2026.
    const lumen = drafts.get("c1")![0]
    expect(lumen).toMatchObject({ yearMonth: "2026-09", amount: 4050, vat: 891, number: "16/2026" })
    expect(drafts.get("c2")![0]).toMatchObject({ yearMonth: "2026-08", amount: 3000, vat: 0, number: "17/2026" })
    // In the checklist's order: clients as their contracts come, each one's months oldest first.
    const [lumenItem, studio] = of("invoices")
    expect(studio[0]).toBe("Studio Verdi, August 2026: €3,000.00 not invoiced")
    expect(studio[1]).toEqual([
      { tool: "update_invoice", args: { invoice: "15/2026", fromMonth: null, yearMonth: "2026-08" }, note: "Only if 15/2026 is the August invoice: ask the owner first." },
      {
        tool: "create_invoice",
        args: { client: "Studio Verdi", number: "17/2026", yearMonth: "2026-08", amount: 3000, vat: 0 },
        note: "If it is not: record the August invoice. Ready to Invoice's draft: confirm the number with the owner, the accountant assigns it.",
      },
    ])
    expect(lumenItem).toEqual([
      "Lumen Srl, September 2026: €4,050.00 not invoiced",
      [{ tool: "create_invoice", args: { client: "Lumen Srl", number: lumen.number, yearMonth: "2026-09", amount: 4050, vat: 891 }, note: expect.stringMatching(/^Ready to Invoice's draft: confirm the number/) }],
    ])
  })

  it("numbers the drafts as get_unbilled does, largest amount first, whatever order the contracts come in", () => {
    // Studio Verdi's contract first: its €3,000 still comes after Lumen's €4,050.
    const swapped = { ...data, engagements: [...data.engagements].reverse() }
    const m = monthEndChecklist(swapped, "2026-09", TODAY)
    const n = monthEndNext(m, swapped, TODAY)
    const numbers = m.steps.invoices.items.map((i) => [i.text.split(",")[0], (n.get(i)!.at(-1) as { args: Record<string, unknown> }).args.number])
    expect(numbers).toEqual([
      ["Studio Verdi", "17/2026"],
      ["Lumen Srl", "16/2026"],
    ])
    const drafts = invoiceDrafts({
      invoices: data.invoices,
      engagements: data.engagements,
      billed: ["c2", "c1", "c9"].map((clientId) => clientBilling({ clientId, ...data, today: TODAY })),
      today: TODAY,
    })
    // Nordica owes nothing to invoice: no drafts, no number taken.
    expect([...drafts].map(([id, [d]]) => [id, d.number])).toEqual([
      ["c1", "16/2026"],
      ["c2", "17/2026"],
    ])
  })

  it("files: no tool attaches one, so each missing file points at the app", () => {
    const rows = of("files")
    expect(rows.length).toBeGreaterThan(0)
    for (const [, n] of rows) expect(n).toEqual([{ app: "In the app only: Month End → Invoice Files → Attach File. No tool attaches a file." }])
  })

  it("the amber steps: Mark Paid, pay the supplier invoice, link the payment or record one at the month end", () => {
    expect(of("waiting").map(([, n]) => n)).toEqual([
      [{ tool: "mark_invoice_paid", args: { invoice: "9/2026" }, note: "Once paid: paidDate, and account (the company account it arrived on)." }],
    ])
    expect(of("suppliers").map(([, n]) => n)).toEqual([
      [{ tool: "add_expense", args: { supplierInvoice: "ST-9", description: "Supplier Invoice Payment", total: 1000 }, note: expect.stringMatching(/^Once paid: paidFrom/) }],
    ])
    expect(of("recurring").map(([, n]) => n)).toEqual([
      [
        { tool: "update_expense", args: { id: "cloud-sep", paysRecurring: "cloud-est" }, note: 'If "Cloud September" was this payment.' },
        {
          tool: "add_expense",
          args: { description: "Cloud plan", total: 50, category: "software", paysRecurring: "cloud-est", date: "2026-09-30" },
          note: expect.stringMatching(/^If it was paid in September: paidFrom/),
        },
      ],
    ])
  })

  it("the recurring payment to record is at the price in force that month, VAT on top", () => {
    const priced = {
      ...data,
      expenses: [
        cost("cloud-est", {
          description: "Cloud plan", category: "software", amount: 50, vat: 11, isRecurring: true, date: day("2026-07-01"),
          priceChanges: [{ from: "2026-09", amount: 60 }],
        }),
      ],
    }
    const m = monthEndChecklist(priced, "2026-09", TODAY)
    const [it] = m.steps.recurring.items
    expect(monthEndNext(m, priced, TODAY).get(it)).toEqual([
      { tool: "add_expense", args: { description: "Cloud plan", total: 71, vat: 11, category: "software", paysRecurring: "cloud-est", date: "2026-09-30" }, note: expect.any(String) },
    ])
  })

  it("bank, To Chase and deadlines: check on the month end, the entry's own edit tool, Mark Done", () => {
    expect(of("bank").map(([, n]) => n)).toEqual([
      [{ tool: "check_balance", args: { account: "Main Bank", date: "2026-09-30" }, note: "balance: the statement's balance at the end of 30/09/2026." }],
    ])
    const chase = Object.fromEntries(of("chase").map(([text, n]) => [text, n]))
    expect(chase).toEqual({
      "Invoice 8/2026 paid on 20/08/2026, no account": [
        { tool: "update_invoice", args: { invoice: "8/2026", paidDate: null }, note: "First mark it unpaid (preview, then confirm)." },
        { tool: "mark_invoice_paid", args: { invoice: "8/2026", paidDate: "2026-08-20" }, note: "Then paid again, with account: the company account it arrived on." },
      ],
      "Team lunch, 03/09/2026, no document": [{ tool: "update_expense", args: { id: "lunch" }, note: "documentRef: the supplier's invoice or receipt number." }],
      "Main Bank ends 03/09/2026 at -€80.00": [
        {
          tool: "get_cash_book",
          args: { period: "2026-09", account: "Main Bank" },
          note: "A bank account can't go below zero: a row is missing, or has the wrong date or account. Find it, then add it or correct it.",
        },
      ],
      "Room rent, ~05/09/2026, date estimated": [{ tool: "update_movement", args: { id: "m-est" }, note: "date: the real day, from the bank statement." }],
    })
    expect(of("deadlines").map(([, n]) => n)).toEqual([[{ tool: "complete_deadline", args: { deadline: "d1" } }]])
  })

  it("a Missing IN short of an unpaid invoice by a bank fee: Mark Paid with received, on the check's day", () => {
    // Book on 30/09: 200 in, 50 and 80 out = 70. The bank shows 1,568: 9/2026's 1,500 less a 2.00 fee.
    const checked = { ...data, accounts: [{ ...main, statementBalance: 1568, statementDate: day("2026-09-30") }] }
    const m = monthEndChecklist(checked, "2026-09", TODAY)
    const [bank] = m.steps.bank.items
    expect(bank.text).toBe("Main Bank: Missing IN of €1,498.00 on 30/09/2026")
    expect(monthEndNext(m, checked, TODAY).get(bank)!.at(-1)).toEqual({
      tool: "mark_invoice_paid",
      args: { invoice: "9/2026", paidDate: "2026-09-30", account: "Main Bank", received: 1498 },
      note:
        "If this invoice was paid: it would explain the Missing IN, €2.00 short booked as a bank fee. " +
        "paidDate: confirm with the owner the day it reached the bank, from the statement, on or before 30/09/2026.",
    })
    // The exact amount: nothing to book as a fee.
    const exact = { ...data, accounts: [{ ...main, statementBalance: 1570, statementDate: day("2026-09-30") }] }
    const e = monthEndChecklist(exact, "2026-09", TODAY)
    expect(monthEndNext(e, exact, TODAY).get(e.steps.bank.items[0])!.at(-1)).toMatchObject({
      args: { invoice: "9/2026", paidDate: "2026-09-30", account: "Main Bank" },
      note: expect.stringMatching(/^If this invoice was paid: it would explain the Missing IN\. paidDate/),
    })
  })

  it("points at the app where no tool can fix it: hours before the contract's start month", () => {
    const early = { ...data, timecards: [...data.timecards, ...hours("e1", "2026-08", 2)] }
    const m = monthEndChecklist(early, "2026-08", TODAY)
    const outside = m.steps.hours.items.find((i) => i.kind === "hours_outside")!
    expect(monthEndNext(m, early, TODAY).get(outside)).toEqual([{ app: "In the app only: Clients → Lumen Srl, the contract's start month. No tool sets it." }])
  })
})

describe("collaborator invoices", () => {
  const collaborator = (id: string, name: string, over: Partial<Collaborator> = {}): Collaborator => ({
    id, userId: "u", name, type: "freelancer", notes: null, isActive: true, fee: null, ...ts, ...over,
  })
  const verdi = collaborator("verdi", "Studio Verdi", { type: "company", fee: { amount: 2400, from: "2026-01", until: null, changes: [] } })
  const giulia = collaborator("giulia", "Giulia Neri")
  const assignment = (id: string, collaboratorId: string, engagementId: string): Assignment => ({
    id, userId: "u", collaboratorId, engagementId, dailyRate: 320, from: "2026-09", until: null, defaultDays: 4, monthDays: {}, ...ts,
  })
  const clients = [client("c1", "Nordwind")]
  const contracts = [engagement("e1", { name: "Product Graph" }), engagement("e2", { name: "Data Platform" })]

  describe("resolveCollaborator", () => {
    it("finds by id or by name in any case, and lists the names on a miss", () => {
      expect(resolveCollaborator([verdi, giulia], "giulia").id).toBe("giulia")
      expect(resolveCollaborator([verdi, giulia], " STUDIO VERDI ").id).toBe("verdi")
      expect(resolveCollaborator([verdi, giulia], "verdi").id).toBe("verdi")
      expect(() => resolveCollaborator([verdi, giulia], "Mario")).toThrow('No collaborator matches "Mario". Collaborators: Studio Verdi, Giulia Neri.')
    })

    it("refuses two with the same name rather than guess", () => {
      expect(() => resolveCollaborator([giulia, collaborator("g2", "Giulia Neri")], "Giulia Neri")).toThrow(/Several collaborators are named "Giulia Neri"/)
    })
  })

  describe("resolveInvoiceContract", () => {
    const on = (mine: Assignment[]) => (query?: string) =>
      resolveInvoiceContract({ collaborator: giulia, assignments: mine, engagements: contracts, clients, query })

    it("takes the one contract they are on, or none for a fixed fee", () => {
      expect(on([assignment("a1", "giulia", "e1")])()).toBe("e1")
      expect(on([])()).toBeNull()
      // Other people's assignments are not theirs.
      expect(on([assignment("a2", "verdi", "e1")])()).toBeNull()
    })

    it("asks which of several, and takes none for the fixed fee", () => {
      const both = on([assignment("a1", "giulia", "e1"), assignment("a2", "giulia", "e2")])
      expect(() => both()).toThrow('Giulia Neri is on several contracts: Nordwind · Product Graph, Nordwind · Data Platform. Pass contract with one of them, or "none" for the fixed fee.')
      expect(both("data platform")).toBe("e2")
      expect(both("Nordwind · Product Graph")).toBe("e1")
      expect(both("e2")).toBe("e2")
      expect(both("None")).toBeNull()
    })

    it("refuses a contract that is not theirs", () => {
      expect(() => on([assignment("a1", "giulia", "e1")])("Data Platform")).toThrow(/Giulia Neri is not on "Data Platform"\. Their contracts: Nordwind · Product Graph\./)
    })
  })

  describe("invoicedLine", () => {
    const line = (expenses: CompanyExpense[]) =>
      invoicedLine(verdi, { assignments: [], timecards: [], expenses, yearMonth: "2026-09" })
    const invoice = (amount: number) => cost("i", { category: "collaborators", collaboratorId: "verdi", forMonth: "2026-09", amount })

    it.each([
      ["covered", [invoice(2400)], "September: invoiced €2,400 of €2,400 planned."],
      ["missing", [], "September: invoiced €0 of €2,400 planned, €2,400 missing."],
      ["part", [invoice(1000.5)], "September: invoiced €1,000.50 of €2,400 planned, €1,399.50 missing."],
      ["over", [invoice(2650)], "September: invoiced €2,650 of €2,400 planned."],
    ])("%s", (_, expenses, expected) => expect(line(expenses)).toBe(expected))
  })
})

describe("planMonths", () => {
  const at = (date: string, id: string | null) => ({ date: new Date(`${date}T00:00:00`), recurringExpenseId: id })
  const quarterly = cost("q", { isRecurring: true, recurrenceMonths: 3, date: new Date("2026-01-15T00:00:00") })

  it("a payment of a spread estimate moves the months of its period", () => {
    expect(planMonths([at("2026-04-10", "q")], [quarterly])).toEqual(["2026-04", "2026-05", "2026-06"])
  })

  it("a payment of a counted-when-paid estimate moves its own month and the payment month it stands for", () => {
    const paid = { ...quarterly, countedWhenPaid: true }
    expect(planMonths([at("2026-05-10", "q")], [paid])).toEqual(["2026-04", "2026-05"])
    expect(planMonths([at("2026-04-10", "q")], [paid])).toEqual(["2026-04"])
  })

  it("a payment of no estimate moves its own month", () => {
    expect(planMonths([at("2026-04-10", null)], [quarterly])).toEqual(["2026-04"])
  })
})

describe("fileSummary", () => {
  it("keeps the name, kind and size of a file and drops its path, and is null without one", () => {
    const file = { path: "users/u/company-files/a.pdf", name: "a.pdf", kind: "pdf" as const, size: 6, uploadedAt: new Date("2026-10-01T10:00:00Z") }
    expect(fileSummary(file)).toEqual({ name: "a.pdf", kind: "pdf", size: 6 })
    expect([fileSummary(null), fileSummary(undefined)]).toEqual([null, null])
  })
})

// ─── Month arithmetic (shared by every tool) ───────────────────────────────

describe("normalizeMonth", () => {
  it("keeps YYYY-MM", () => {
    expect(normalizeMonth("2026-08")).toBe("2026-08")
  })

  it("truncates a full date to its month", () => {
    expect(normalizeMonth("2026-08-19")).toBe("2026-08")
  })

  it("rejects month 00 and 13", () => {
    expect(() => normalizeMonth("2026-00")).toThrow(ToolInputError)
    expect(() => normalizeMonth("2026-13")).toThrow(ToolInputError)
  })

  it("rejects everything else with a readable message", () => {
    for (const bad of ["agosto", "2026/08", "08-2026", "2026-8", ""]) {
      expect(() => normalizeMonth(bad)).toThrow(/Invalid date/)
    }
  })
})

describe("resolveDateWindow", () => {
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`

  // The whole reason this exists next to normalizeMonth: asking for one day must
  // not silently answer for the month around it.
  it("keeps a single day to that day", () => {
    const { from, to } = resolveDateWindow({ from: "2026-07-05" })
    expect(iso(from)).toBe("2026-07-05")
    expect(iso(to)).toBe("2026-07-05")
    expect(to.getHours()).toBe(23)
    expect(to.getMinutes()).toBe(59)
  })

  it("widens a bare month to the whole month", () => {
    const { from, to } = resolveDateWindow({ from: "2026-07" })
    expect(iso(from)).toBe("2026-07-01")
    expect(iso(to)).toBe("2026-07-31")
  })

  it("mixes precisions: from a day, to a month", () => {
    const { from, to } = resolveDateWindow({ from: "2026-07-05", to: "2026-08" })
    expect(iso(from)).toBe("2026-07-05")
    expect(iso(to)).toBe("2026-08-31")
  })

  it("mixes the other way: from a month, to a day", () => {
    const { from, to } = resolveDateWindow({ from: "2026-07", to: "2026-08-10" })
    expect(iso(from)).toBe("2026-07-01")
    expect(iso(to)).toBe("2026-08-10")
  })

  it("handles February in a leap year", () => {
    expect(iso(resolveDateWindow({ from: "2028-02" }).to)).toBe("2028-02-29")
  })

  // new Date(2026, 1, 30) rolls into March rather than throwing.
  it("rejects a day that does not exist instead of rolling it forward", () => {
    expect(() => resolveDateWindow({ from: "2026-02-30" })).toThrow(ToolInputError)
  })

  it("rejects a reversed window", () => {
    expect(() => resolveDateWindow({ from: "2026-08-10", to: "2026-08-01" })).toThrow(ToolInputError)
  })

  // Same day both ends is a window, not a reversal.
  it("accepts from and to on the same day", () => {
    const { from, to } = resolveDateWindow({ from: "2026-07-05", to: "2026-07-05" })
    expect(to.getTime()).toBeGreaterThan(from.getTime())
  })

  it("rejects a malformed bound", () => {
    expect(() => resolveDateWindow({ from: "luglio" })).toThrow(ToolInputError)
    expect(() => resolveDateWindow({ from: "2026-13" })).toThrow(ToolInputError)
  })
})

describe("quarterOf", () => {
  it("maps months to calendar quarters", () => {
    expect(quarterOf("2026-01")).toBe("2026-Q1")
    expect(quarterOf("2026-03")).toBe("2026-Q1")
    expect(quarterOf("2026-04")).toBe("2026-Q2")
    expect(quarterOf("2026-12")).toBe("2026-Q4")
  })
})

describe("monthSpan", () => {
  it("is inclusive", () => {
    expect(monthSpan("2026-04", "2026-06")).toBe(3)
    expect(monthSpan("2026-08", "2026-08")).toBe(1)
  })

  it("crosses year boundaries", () => {
    expect(monthSpan("2026-11", "2027-02")).toBe(4)
  })

  it("rejects inverted windows", () => {
    expect(() => monthSpan("2026-09", "2026-08")).toThrow(ToolInputError)
  })
})

// ─── Client resolution ───────────────────────────────────────────────────────
