/**
 * Made-up data for the Solutions tests: Nordwind Retail S.p.A. has a delivered
 * product knowledge graph (4 of 9 sections written, two entities and a
 * relation) and a pre-sales store search; Lumen Srl a retired churn model.
 * DATA is what the faked backend's reads return; a test may swap an entry.
 */
import { normalizeSolutionSections } from "@/types/schemas"

import type { Meeting, Opportunity, Solution, SolutionStep, Task } from "@/types"

const at = new Date(2026, 0, 1)
export const client = (id: string, name: string) => ({
  id, userId: "u1", name, vatNumber: null, email: null, contactName: null,
  contactPhone: null, notes: null, isActive: true, createdAt: at, updatedAt: at,
})
export const contract = (id: string, clientId: string, name: string, isActive = true) => ({
  id, userId: "u1", clientId, name, opportunityId: null, dailyRate: 600, vatApplicable: true, contractedDays: null,
  defaultDaysPerMonth: 10, startMonth: null, endMonth: null, endDate: null, isActive, notes: null,
  createdAt: at, updatedAt: at,
})
export const solution = (o: Partial<Solution> & Pick<Solution, "id" | "clientId" | "name">): Solution => ({
  userId: "u1", engagementId: null, status: "proposed", kind: "product", target: null, steps: [], domain: null, stack: [],
  sections: normalizeSolutionSections({}), entities: [], relations: [], createdAt: at, updatedAt: at, ...o,
})
const meeting = (o: Partial<Meeting> & Pick<Meeting, "id" | "clientId" | "date">): Meeting => ({
  userId: "u1", engagementId: null, time: null, health: null, text: "Status call", createdAt: at, updatedAt: at, ...o,
})

export const GRAPH = solution({
  id: "s1", clientId: "c1", engagementId: "e1", name: "Product knowledge graph", status: "delivered",
  domain: "retail", stack: ["neo4j", "gds", "kafka"], updatedAt: new Date(2026, 9, 1),
  sections: normalizeSolutionSections({
    purpose: "One graph for the catalog,\nso search and merchandising read the same products.",
    requirements: "Nightly load from the ERP", kpis: "Search time: from 4 s to 1 s", sources: "SAP MARA, Kafka topics",
  }),
  entities: [
    { name: "Product", source: "SAP MARA", notes: null },
    { name: "Category", source: null, notes: "From the merchandising tree" },
  ],
  relations: [{ from: "Product", to: "Category", type: "IN_CATEGORY" }],
})
export const SEARCH = solution({ id: "s2", clientId: "c1", name: "Store search", stack: ["kafka"], updatedAt: new Date(2026, 9, 5) })
export const CHURN = solution({ id: "s3", clientId: "c2", engagementId: "e3", name: "Churn model", status: "retired", updatedAt: new Date(2026, 5, 1) })

export const opportunity = (id: string, title: string, stage: Opportunity["stage"]): Opportunity => ({
  id, userId: "u1", clientId: "c1", title, stage, probability: 50, dailyRate: 600, estimatedDaysPerMonth: 5, estimatedDurationMonths: 3,
  expectedStartMonth: null, vatApplicable: true, nextActionDate: null, nextActionNote: null, notes: null, lostReason: null,
  closedAt: null, engagementId: null, createdAt: at, updatedAt: at,
})
const step = (title: string, state: SolutionStep["state"], over: Partial<SolutionStep> = {}): SolutionStep => ({
  title, state, fromMonth: "2026-10", toMonth: null, paidBy: null, goal: null, outcome: null, doneOn: null, ...over,
})
/** A capped contract (11 days) with 6.5 days logged, and a road of five steps on it. */
export const CAPPED = { ...contract("e4", "c1", "Guest MVP"), contractedDays: 11 }
/** An hourly contract capped at 5 days (40 hours), with 44 hours logged: over budget. */
export const HOURLY = { ...contract("e5", "c1", "Hourly pilot"), contractedDays: 5, unit: "hour" as const }
export const ROAD = solution({
  id: "s4", clientId: "c1", engagementId: "e4", name: "Guest 360", status: "building",
  target: "One guest record on the front desk's screen.",
  steps: [
    step("Proof of concept", "done", { fromMonth: "2026-08", toMonth: "2026-08", paidBy: { type: "contract", id: "e2" }, outcome: "15 questions answered", doneOn: "2026-09-12" }),
    step("MVP on the client's server", "now", { toMonth: "2026-11", paidBy: { type: "contract", id: "e4" }, goal: "Runs every night on their server." }),
    step("Front-desk guest card", "next", { fromMonth: "2027-01", paidBy: { type: "opportunity", id: "o1" }, goal: "Opens the guest's story." }),
    step("Campaign segments", "later", { fromMonth: "2027-03", paidBy: { type: "opportunity", id: "o2" } }),
    step("Offers assistant", "later", { fromMonth: "2027-06", paidBy: { type: "opportunity", id: "o3" } }),
  ],
})
const task = (id: string, title: string, over: Partial<Task> = {}): Task =>
  ({ id, userId: "u1", clientId: "c1", engagementId: "e4", title, dueDate: null, notes: null, isDone: false, startedAt: null, labels: [], createdAt: at, updatedAt: at, ...over }) as Task

export const DATA: Record<string, unknown> = {
  getClients: [client("c1", "Nordwind Retail S.p.A."), client("c2", "Lumen Srl")],
  getEngagements: [contract("e1", "c1", "Product graph"), CAPPED, HOURLY, contract("e2", "c1", "Search pilot", false), contract("e3", "c2", "Retainer", false)],
  getSolutions: [GRAPH, CHURN, SEARCH],
  getJournal: [],
  getOpportunities: [
    opportunity("o1", "Front-desk card", "proposal"), opportunity("o2", "Segments", "lead"), opportunity("o3", "Assistant", "lost"),
    { ...opportunity("o4", "Graph build", "won"), engagementId: "e1" },
  ],
  // 52 h = 6.5 days on the capped contract; a day in the future and another contract's hours do not count.
  getTimecards: [
    { id: "t1", userId: "u1", engagementId: "e4", date: "2026-10-05", hours: 52 },
    { id: "t2", userId: "u1", engagementId: "e4", date: "2099-01-01", hours: 8 },
    { id: "t3", userId: "u1", engagementId: "e1", date: "2026-10-05", hours: 8 },
    { id: "t4", userId: "u1", engagementId: "e5", date: "2026-10-05", hours: 44 },
  ],
  getTasks: [
    task("k1", "Back up and restore", { dueDate: new Date(2026, 10, 12) }),
    task("k2", "Handover session", { dueDate: new Date(2026, 10, 20) }),
    task("k3", "Old chore", { isDone: true }),
    task("k4", "Another contract's task", { engagementId: "e1" }),
  ],
  // The graph contract's newest status is green; a later call that states none moves only "Last meeting".
  getMeetings: [
    meeting({ id: "m1", clientId: "c1", engagementId: "e1", date: "2026-09-20", health: "yellow" }),
    meeting({ id: "m2", clientId: "c1", engagementId: "e1", date: "2026-10-09", health: "green" }),
    meeting({ id: "m3", clientId: "c1", engagementId: "e1", date: "2026-10-12" }),
    // The Guest MVP's newest stated status is yellow; its last call, a later one, stated none.
    meeting({ id: "m4", clientId: "c1", engagementId: "e4", date: "2026-10-20", health: "yellow" }),
    meeting({ id: "m5", clientId: "c1", engagementId: "e4", date: "2026-10-25" }),
  ],
}
