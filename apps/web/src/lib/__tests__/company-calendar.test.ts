import { describe, it, expect } from "vitest"

import { buildCompanyCalendar, groupByPeriod, nextDays, overdueItems, overdueSummary } from "../company-calendar"

import type { CalendarItem } from "../company-calendar"
import type { EngagementBurnDown } from "../engagement-burndown"
import type { Client, CompanyDeadline, Engagement, Invoice, Opportunity, Task } from "@/types"

const NOW = new Date("2026-01-01")
const TODAY = "2026-06-15"

function deadline(o: Partial<CompanyDeadline> = {}): CompanyDeadline {
  return {
    id: "d1", userId: "u1", title: "Parcella commercialista",
    date: new Date("2026-07-10"), kind: "admin", amount: 1200, notes: null,
    isDone: false, createdAt: NOW, updatedAt: NOW, ...o,
  }
}

function opportunity(o: Partial<Opportunity> = {}): Opportunity {
  return {
    id: "o1", userId: "u1", clientId: "c1", title: "Retainer Acme", stage: "proposal",
    probability: 50, dailyRate: 500, estimatedDaysPerMonth: 10,
    estimatedDurationMonths: 6, expectedStartMonth: null, vatApplicable: true,
    nextActionDate: new Date("2026-06-20"), nextActionNote: null, notes: null,
    lostReason: null, closedAt: null, engagementId: null,
    createdAt: NOW, updatedAt: NOW, ...o,
  }
}

function burnDown(o: Partial<EngagementBurnDown> = {}): EngagementBurnDown {
  return {
    sourceId: "e1", clientName: "Acme",
    cells: [], exhaustionMonth: "2026-09", cliffMonth: "2026-10",
    monthlyRevenueAtRisk: 5000, ...o,
  }
}

function invoice(o: Partial<Invoice> = {}): Invoice {
  return {
    id: "i1", userId: "u1", clientId: null, engagementId: "e1", number: "2026/14",
    fromMonth: null, yearMonth: "2026-04", amount: 5000, vat: 1100,
    dueDate: new Date("2026-05-31"), paidDate: null, paidAccountId: null,
    createdAt: NOW, updatedAt: NOW, ...o,
  }
}

function engagement(o: Partial<Engagement> = {}): Engagement {
  return {
    id: "e1", userId: "u1", clientId: "c1", name: null, opportunityId: null,
    dailyRate: 500, vatApplicable: true, contractedDays: null,
    defaultDaysPerMonth: 10, startMonth: null, endMonth: null, endDate: null, isActive: true, notes: null,
    createdAt: NOW, updatedAt: NOW, ...o,
  }
}

function task(o: Partial<Task> = {}): Task {
  return {
    id: "t1", userId: "u1", clientId: "c1", engagementId: "e1", title: "Consegna report",
    dueDate: new Date("2026-06-20"), notes: null, isDone: false, startedAt: null, labels: [],
    createdAt: NOW, updatedAt: NOW, ...o,
  }
}

function client(o: Partial<Client> = {}): Client {
  return {
    id: "c1", userId: "u1", name: "Acme", vatNumber: null, email: null, contactName: null, contactPhone: null,
    notes: null, isActive: true, createdAt: NOW, updatedAt: NOW, ...o,
  }
}

// ─── Manual deadlines ────────────────────────────────────────────────────────

describe("manual deadlines", () => {
  it("keeps the stored isDone rather than deriving it", () => {
    const [item] = buildCompanyCalendar({
      deadlines: [deadline({ date: new Date("2026-01-10"), isDone: false })],
      today: TODAY,
    })
    // Long past, but the user never ticked it — it stays open so it shows as overdue.
    expect(item.isDone).toBe(false)
  })

  it("exposes the id so the row stays editable", () => {
    const [item] = buildCompanyCalendar({ deadlines: [deadline({ id: "abc" })], today: TODAY })
    expect(item.deadlineId).toBe("abc")
    expect(item.source).toBe("manual")
  })

  it("carries the kind through", () => {
    const [item] = buildCompanyCalendar({ deadlines: [deadline({ kind: "contract" })], today: TODAY })
    expect(item.kind).toBe("contract")
  })

  it("is titled by what is due, and is yours", () => {
    const [item] = buildCompanyCalendar({ deadlines: [deadline()], today: TODAY })
    expect(item).toMatchObject({ label: "Parcella commercialista", detail: "Yours" })
  })
})

// ─── CRM follow-ups ──────────────────────────────────────────────────────────

describe("CRM follow-ups", () => {
  it("includes an open opportunity's next action, with its client to open the deals", () => {
    const [item] = buildCompanyCalendar({ opportunities: [opportunity()], clients: [client()], today: TODAY })
    expect(item).toMatchObject({
      date: "2026-06-20", source: "crm", label: "Retainer Acme", detail: "Acme", clientId: "c1",
    })
  })

  it("is titled by the note when there is one, the deal moving to the detail", () => {
    const [item] = buildCompanyCalendar({
      opportunities: [opportunity({ nextActionNote: "richiamare" })],
      clients: [client()],
      today: TODAY,
    })
    expect(item).toMatchObject({ label: "richiamare", detail: "Retainer Acme · Acme" })
  })

  it("skips an opportunity with no next action", () => {
    const items = buildCompanyCalendar({
      opportunities: [opportunity({ nextActionDate: null })],
      today: TODAY,
    })
    expect(items).toHaveLength(0)
  })

  // A closed deal cannot be chased; a stale date on it is not a to-do.
  it.each(["won", "lost"] as const)("skips %s opportunities", (stage) => {
    const items = buildCompanyCalendar({ opportunities: [opportunity({ stage })], today: TODAY })
    expect(items).toHaveLength(0)
  })

  it("never marks a follow-up done", () => {
    const [item] = buildCompanyCalendar({
      opportunities: [opportunity({ nextActionDate: new Date("2026-01-05") })],
      today: TODAY,
    })
    expect(item.isDone).toBe(false)
  })
})

// ─── Budget milestones ───────────────────────────────────────────────────────

describe("budget exhaustion milestones", () => {
  it("lands on the last day of the exhaustion month", () => {
    const [item] = buildCompanyCalendar({ burnDowns: [burnDown({ exhaustionMonth: "2026-09" })], today: TODAY })
    expect(item.date).toBe("2026-09-30")
    expect(item).toMatchObject({ label: "Contract budget used up", detail: "Acme · from the plan" })
    expect(item.kind).toBe("contract")
  })

  it("names the contract that runs out when it has a name", () => {
    const [item] = buildCompanyCalendar({
      burnDowns: [burnDown({ sourceId: "e1" })],
      engagements: [engagement({ id: "e1", name: "Product Graph" })],
      today: TODAY,
    })
    expect(item.label).toBe("Product Graph budget used up")
  })

  it("handles a 31-day month and February", () => {
    const [dec] = buildCompanyCalendar({ burnDowns: [burnDown({ exhaustionMonth: "2026-12" })], today: TODAY })
    const [feb] = buildCompanyCalendar({ burnDowns: [burnDown({ exhaustionMonth: "2028-02" })], today: TODAY })
    expect(dec.date).toBe("2026-12-31")
    expect(feb.date).toBe("2028-02-29") // 2028 is a leap year
  })

  it("skips a contract that never exhausts", () => {
    const items = buildCompanyCalendar({ burnDowns: [burnDown({ exhaustionMonth: null })], today: TODAY })
    expect(items).toHaveLength(0)
  })
})

// ─── Invoice due dates ───────────────────────────────────────────────────────

describe("invoice due dates", () => {
  const names = { engagements: [engagement()], clients: [client()] }

  it("puts an unpaid past-due invoice in the overdue list", () => {
    const items = buildCompanyCalendar({
      ...names,
      invoices: [invoice({ dueDate: new Date("2026-05-31"), paidDate: null })],
      today: TODAY,
    })
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ date: "2026-05-31", source: "invoice", isDone: false })
    expect(overdueItems(items, TODAY).map((i) => i.invoiceId)).toEqual(["i1"])
  })

  it("does not chase a paid invoice, however late it was", () => {
    const items = buildCompanyCalendar({
      ...names,
      invoices: [invoice({ dueDate: new Date("2026-05-31"), paidDate: new Date("2026-06-10") })],
      today: TODAY,
    })
    expect(items[0].isDone).toBe(true)
    expect(overdueItems(items, TODAY)).toHaveLength(0)
  })

  // An untracked due date is not a deadline — asserting "scaduta" about it would be a lie.
  it("never shows an invoice with no due date", () => {
    const items = buildCompanyCalendar({
      ...names,
      invoices: [invoice({ dueDate: null }), invoice({ id: "i2", dueDate: null, paidDate: NOW })],
      today: TODAY,
    })
    expect(items).toHaveLength(0)
  })

  it("is titled by its number, its client in the detail", () => {
    const [item] = buildCompanyCalendar({ ...names, invoices: [invoice()], today: TODAY })
    expect(item).toMatchObject({ label: "Invoice 2026/14", detail: "Acme" })
  })

  it("names the client of an invoice that names it, with no contract", () => {
    const [item] = buildCompanyCalendar({
      engagements: [], clients: [client()], invoices: [invoice({ clientId: "c1", engagementId: null })], today: TODAY,
    })
    expect(item.detail).toBe("Acme")
  })

  it("falls back when the engagement or client cannot be resolved", () => {
    const [noClient] = buildCompanyCalendar({
      engagements: [engagement()], clients: [], invoices: [invoice()], today: TODAY,
    })
    const [noEngagement] = buildCompanyCalendar({
      clients: [client()], invoices: [invoice({ engagementId: "ghost" })], today: TODAY,
    })
    expect(noClient.detail).toBe("Unknown client")
    expect(noEngagement.detail).toBe("Unknown client")
  })

  it("shows what the client owes: imponibile + IVA", () => {
    const [item] = buildCompanyCalendar({
      ...names,
      invoices: [invoice({ amount: 5000, vat: 1100 })],
      today: TODAY,
    })
    expect(item.amount).toBe(6100)
  })

  // A nota di credito is a negative invoice; the calendar must not flinch at it.
  it("carries a credit note through with its negative total", () => {
    const [item] = buildCompanyCalendar({
      ...names,
      invoices: [invoice({ amount: -1000, vat: -220 })],
      today: TODAY,
    })
    expect(item.amount).toBe(-1220)
  })
})

// ─── Engagement tasks ────────────────────────────────────────────────────────

describe("engagement tasks", () => {
  const ctx = { engagements: [engagement()], clients: [client()], today: TODAY }

  it("names the client the task's contract belongs to", () => {
    const [item] = buildCompanyCalendar({ tasks: [task()], ...ctx })
    expect(item).toMatchObject({
      date: "2026-06-20",
      source: "task",
      kind: "admin",
      label: "Consegna report",
      detail: "Acme",
      amount: null,
      isDone: false,
      taskId: "t1",
    })
  })

  // Same rule the invoices follow: no due date, no row. Otherwise the list would
  // call something "scaduta" on a date the user never gave it.
  it("drops a task with no due date", () => {
    expect(buildCompanyCalendar({ tasks: [task({ dueDate: null })], ...ctx })).toEqual([])
  })

  // A task carries a real done flag, unlike a pipeline follow-up.
  it("carries isDone through, so a ticked task stops nagging", () => {
    const [item] = buildCompanyCalendar({
      tasks: [task({ dueDate: new Date("2026-06-01"), isDone: true })],
      ...ctx,
    })
    expect(item.isDone).toBe(true)
    expect(overdueItems([item], TODAY)).toEqual([])
  })

  it("still shows an open past-due task as overdue", () => {
    const items = buildCompanyCalendar({
      tasks: [task({ dueDate: new Date("2026-06-01") })],
      ...ctx,
    })
    expect(overdueItems(items, TODAY)).toHaveLength(1)
  })

  // The engagement may be gone, or belong to a client that was deleted — the row
  // must still render rather than crash the whole calendar.
  it("falls back when the contract resolves to no client", () => {
    const [item] = buildCompanyCalendar({
      tasks: [task({ clientId: null, engagementId: "missing" })],
      ...ctx,
    })
    expect(item.detail).toBe("Unknown client")
  })

  // #164: a client-level task has no contract to go through, and one written
  // before tasks carried a clientId has only its contract.
  it("labels a client-level task by its client, and an old one by its contract's", () => {
    const clients = [client(), client({ id: "c2", name: "Globex" })]
    const [clientLevel, legacy] = buildCompanyCalendar({
      tasks: [
        task({ id: "t1", clientId: "c2", engagementId: null }),
        task({ id: "t2", clientId: null, dueDate: new Date("2026-06-21") }),
      ],
      ...ctx,
      clients,
    })
    expect(clientLevel.detail).toBe("Globex")
    expect(legacy.detail).toBe("Acme")
  })
})

// ─── Merge, order, window ────────────────────────────────────────────────────

describe("merging", () => {
  const everything = {
    deadlines: [deadline({ date: new Date("2026-07-10") })],
    opportunities: [opportunity({ nextActionDate: new Date("2026-06-20") })],
    burnDowns: [burnDown({ exhaustionMonth: "2026-09" })],
    today: TODAY,
  }

  it("puts all three sources in one date-ordered list", () => {
    const items = buildCompanyCalendar(everything)
    expect(items.map((i) => i.date)).toEqual(["2026-06-20", "2026-07-10", "2026-09-30"])
    expect(items.map((i) => i.source)).toEqual(["crm", "manual", "milestone"])
  })

  it("breaks a date tie on the label so the order is stable", () => {
    const items = buildCompanyCalendar({
      deadlines: [
        deadline({ id: "z", title: "Zeta", date: new Date("2026-07-16") }),
        deadline({ id: "a", title: "Alfa", date: new Date("2026-07-16") }),
      ],
      today: TODAY,
    })
    expect(items.map((i) => i.label)).toEqual(["Alfa", "Zeta"])
  })

  it("windows inclusively on both ends", () => {
    const items = buildCompanyCalendar({ ...everything, from: "2026-06-20", to: "2026-07-10" })
    expect(items.map((i) => i.date)).toEqual(["2026-06-20", "2026-07-10"])
  })

  it("returns an empty list when given nothing", () => {
    expect(buildCompanyCalendar({ today: TODAY })).toEqual([])
  })
})

describe("overdueItems", () => {
  it("keeps only open items whose date has passed", () => {
    const items = buildCompanyCalendar({
      deadlines: [
        deadline({ id: "old-open", date: new Date("2026-01-10"), isDone: false }),
        deadline({ id: "old-done", date: new Date("2026-01-11"), isDone: true }),
        deadline({ id: "future", date: new Date("2026-12-01"), isDone: false }),
      ],
      today: TODAY,
    })
    expect(overdueItems(items, TODAY).map((i) => i.deadlineId)).toEqual(["old-open"])
  })
})

// ─── Periods and the next 30 days ────────────────────────────────────────────

/** Thursday 15 October 2026, as the Deadlines mockups draw it: the week ends Sunday the 18th. */
const THU = "2026-10-15"

function item(date: string, o: Partial<CalendarItem> = {}): CalendarItem {
  return { date, source: "manual", kind: "admin", label: date, detail: "Yours", amount: null, isDone: false, ...o }
}

describe("groupByPeriod", () => {
  it("files open items under overdue, this week, this month and later, and done ones apart", () => {
    const groups = groupByPeriod(
      [
        item("2026-10-05"),
        item("2026-10-12", { source: "task" }),
        item("2026-10-15"),
        item("2026-10-18"),
        item("2026-10-19"),
        item("2026-10-31"),
        item("2026-11-01"),
        item("2027-04-30"),
        item("2026-09-30", { isDone: true }),
        item("2026-10-31", { isDone: true }),
        item("2026-10-03", { isDone: true }),
      ],
      THU,
    )
    expect(groups.map((g) => [g.key, g.title, g.range, g.items.map((i) => i.date)])).toEqual([
      ["overdue", "Overdue", "before today", ["2026-10-05", "2026-10-12"]],
      ["week", "This week", "15–18 Oct", ["2026-10-15", "2026-10-18"]],
      ["month", "This month", "19–31 Oct", ["2026-10-19", "2026-10-31"]],
      ["later", "Later", "Nov 2026 – Apr 2027", ["2026-11-01", "2027-04-30"]],
      // Newest first: the last thing done is the one worth undoing.
      ["done", "Done", "newest first", ["2026-10-31", "2026-10-03", "2026-09-30"]],
    ])
  })

  it("lists done days newest first, but a day's items A to Z", () => {
    const done = (date: string, label: string) => item(date, { label, isDone: true })
    const [group] = groupByPeriod(
      [done("2026-09-30", "Invoice 23"), done("2026-10-03", "Timesheet"), done("2026-09-30", "Annual filing")],
      THU,
    )
    expect(group.items.map((i) => i.label)).toEqual(["Timesheet", "Annual filing", "Invoice 23"])
  })

  it("leaves out an empty period", () => {
    expect(groupByPeriod([item("2026-10-16")], THU).map((g) => g.key)).toEqual(["week"])
    expect(groupByPeriod([], THU)).toEqual([])
  })

  // A week that runs into the next month leaves this month nothing: its days are this week's.
  it("lets this week run across the month's end, and later start after it", () => {
    const groups = groupByPeriod([item("2026-10-30"), item("2026-11-01"), item("2026-11-02")], "2026-10-29")
    expect(groups.map((g) => [g.key, g.range, g.items.length])).toEqual([
      ["week", "29 Oct – 1 Nov", 2],
      ["later", "Nov 2026", 1],
    ])
  })

  it("names a week of one day, a Sunday, by that day", () => {
    expect(groupByPeriod([item("2026-10-18")], "2026-10-18")[0].range).toBe("18 Oct")
  })
})

describe("nextDays", () => {
  const items = [
    item("2026-10-05", { source: "invoice", amount: 1756.8, invoiceId: "i27" }),
    item("2026-10-12", { source: "task", taskId: "t1" }),
    item("2026-10-16", { amount: 480 }),
    item("2026-10-31", { source: "invoice", amount: 5075.2, invoiceId: "i25" }),
    item("2026-11-01", { amount: 620 }),
    item("2026-11-14", { amount: 10 }),
    // Past the 30 days, already paid or done, or with no amount: none of them count.
    item("2026-11-15", { amount: 2350 }),
    item("2026-11-16", { source: "invoice", amount: 999, invoiceId: "i28" }),
    item("2026-10-20", { source: "invoice", amount: 5490, invoiceId: "i26", isDone: true }),
    item("2026-10-20", { amount: 150, isDone: true }),
    item("2026-10-21"),
  ]

  it("adds up what comes in and goes out over the next 30 days, late items included", () => {
    expect(nextDays(items, THU)).toEqual({
      to: "2026-11-14",
      collect: { total: 6832, count: 2 },
      pay: { total: 1110, count: 3 },
      overdue: 2,
    })
  })

  it("is zero with nothing due", () => {
    expect(nextDays([], THU)).toEqual({ to: "2026-11-14", collect: { total: 0, count: 0 }, pay: { total: 0, count: 0 }, overdue: 0 })
  })
})

describe("overdueSummary", () => {
  it("counts what is late by source, in words", () => {
    expect(overdueSummary([item("2026-10-05", { source: "invoice" }), item("2026-10-12", { source: "task" })])).toBe(
      "1 invoice, 1 task",
    )
    expect(
      overdueSummary([item("a", { source: "crm" }), item("b", { source: "crm" }), item("c"), item("d"), item("e")]),
    ).toBe("3 deadlines, 2 follow-ups")
    expect(overdueSummary([])).toBe("Nothing late")
  })
})
