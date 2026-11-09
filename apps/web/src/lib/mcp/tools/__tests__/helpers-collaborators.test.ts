import { describe, expect, it } from "vitest"

import { capacityForMonths, planFigures } from "@/lib/mcp/tools/helpers"

import type { PlanBook } from "@/lib/mcp/tools/helpers"
import type { Allocation, Assignment, Collaborator, Engagement } from "@/types"

const stamp = { userId: "u", createdAt: new Date("2026-01-01"), updatedAt: new Date("2026-01-01") }

const engagement = (id: string, over: Partial<Engagement> = {}): Engagement => ({
  id, userId: "u", clientId: "c1", name: null, opportunityId: null, dailyRate: 1000, vatApplicable: true, contractedDays: null,
  defaultDaysPerMonth: 15, startMonth: null, endMonth: null, endDate: null, isActive: true, notes: null,
  createdAt: stamp.createdAt, updatedAt: stamp.updatedAt, ...over,
})

const allocation = (engagementId: string, yearMonth: string, days: number): Allocation => ({ id: `${engagementId}:${yearMonth}`, engagementId, yearMonth, days, ...stamp })

const person = (id: string, isActive = true): Collaborator => ({ id, name: id, type: "freelancer", notes: null, isActive, fee: null, ...stamp })

const onE1 = (collaboratorId: string, defaultDays: number, over: Partial<Assignment> = {}): Assignment => ({
  id: `${collaboratorId}_e1`, collaboratorId, engagementId: "e1", dailyRate: 300, from: "2026-01", until: null, defaultDays, monthDays: {}, ...stamp, ...over,
})

// The Projection's own figures, so a preview can say them before and after a change.
describe("planFigures", () => {
  const client = { id: "c1", name: "Nordwind", vatNumber: null, email: null, contactName: null, contactPhone: null, notes: null, isActive: true, ...stamp }
  const verdi: Collaborator = { ...person("verdi"), fee: { amount: 500, from: "2026-01", until: null, changes: [] } }
  const book = (collaborators: Collaborator[], assignments: Assignment[]): PlanBook => ({
    engagements: [engagement("e1", { defaultDaysPerMonth: 10, name: "Product Graph" })], clients: [client], allocations: [], expenses: [], collaborators, assignments,
  })

  it("sums a year of the Projection: revenue 10 days × €1,000, fee €500 and 4 days × €300 a month", () => {
    const f = planFigures(book([verdi], [onE1("verdi", 4)]), "2026-09")
    expect([...f]).toEqual([
      ["Collaborators cost, next 12 months", 20400],
      ["Plan net, next 12 months", 99600],
    ])
  })

  it("adds the contract's margin over the next 6 months: €10,000 less 4 days × €300, six times", () => {
    const f = planFigures(book([verdi], [onE1("verdi", 4)]), "2026-09", "e1")
    expect(f.get("Margin on Nordwind · Product Graph, next 6 months")).toBe(52800)
  })

  it("an inactive collaborator is out of the plan", () => {
    const off = { ...verdi, isActive: false }
    expect(planFigures(book([off], [onE1("verdi", 4)]), "2026-09").get("Collaborators cost, next 12 months")).toBe(0)
  })
})

// #329: capacity is the owner's own load: the contract's days less the collaborators' counted days.
describe("capacityForMonths with collaborators", () => {
  const load = (collaborators: Collaborator[], assignments: Assignment[], allocations: Allocation[] = []) =>
    capacityForMonths({ engagements: [engagement("e1")], allocations, capacityDocs: [], from: "2026-08", months: 1, collaborators, assignments })[0]

  it("takes the collaborators' days off the owner's load", () => {
    const m = load([person("g")], [onE1("g", 6)])
    expect([m.allocatedDays, m.remaining]).toEqual([9, 12])
  })

  it.each([
    ["an inactive collaborator counts nothing", [person("g", false)], [onE1("g", 6)], 15],
    ["days past the month's billable are capped, so the owner's never go negative", [person("g")], [onE1("g", 20)], 0],
    ["two collaborators share what the contract bills", [person("g"), person("h")], [onE1("g", 6), onE1("h", 4)], 5],
    ["an assignment that has ended counts nothing", [person("g")], [onE1("g", 6, { until: "2026-07" })], 15],
  ])("%s", (_, people, assignments, expected) => expect(load(people, assignments).allocatedDays).toBe(expected))

  it("a typed month total still has the collaborators' counted days taken off", () => {
    expect(load([person("g")], [onE1("g", 6)], [allocation("e1", "2026-08", 12)]).allocatedDays).toBe(6)
  })
})
