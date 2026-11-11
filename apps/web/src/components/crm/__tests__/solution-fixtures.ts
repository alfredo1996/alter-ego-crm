/**
 * Made-up data for the Solutions tests: Nordwind Retail S.p.A. has a delivered
 * product knowledge graph (4 of 9 sections written, two entities and a
 * relation) and a pre-sales store search; Lumen Srl a retired churn model.
 * DATA is what the faked backend's reads return; a test may swap an entry.
 */
import { normalizeSolutionSections } from "@/types/schemas"

import type { Meeting, Solution } from "@/types"

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

export const DATA: Record<string, unknown> = {
  getClients: [client("c1", "Nordwind Retail S.p.A."), client("c2", "Lumen Srl")],
  getEngagements: [contract("e1", "c1", "Product graph"), contract("e2", "c1", "Search pilot", false), contract("e3", "c2", "Retainer", false)],
  getSolutions: [GRAPH, CHURN, SEARCH],
  // The graph contract's newest status is green; a later call that states none moves only "Last meeting".
  getMeetings: [
    meeting({ id: "m1", clientId: "c1", engagementId: "e1", date: "2026-09-20", health: "yellow" }),
    meeting({ id: "m2", clientId: "c1", engagementId: "e1", date: "2026-10-09", health: "green" }),
    meeting({ id: "m3", clientId: "c1", engagementId: "e1", date: "2026-10-12" }),
  ],
}
