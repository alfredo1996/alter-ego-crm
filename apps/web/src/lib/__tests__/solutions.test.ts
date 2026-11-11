import { describe, expect, it } from "vitest"

import { contractUsage } from "@/lib/engagements"
import {
  completeStep,
  contractState,
  filledSections,
  filterSolutions,
  historyEntries,
  lineLabel,
  missingSections,
  moveStep,
  nowStep,
  pipelineSteps,
  saveStep,
  sectionsFor,
  stepContract,
  stepUsage,
  stepWhen,
  solutionFilters,
  solutionNameTaken,
  usedStack,
} from "@/lib/solutions"
import { normalizeSolutionSections } from "@/types/schemas"

import type { Solution, SolutionStep } from "@/types"

/** Made-up data: Nordwind Retail S.p.A.'s product knowledge graph and a second, older solution. */
const solution = (o: Partial<Solution> & Pick<Solution, "id">): Solution => ({
  userId: "u1", clientId: "c1", engagementId: null, name: o.id, status: "proposed", kind: "product", target: null, steps: [], domain: null, stack: [],
  sections: normalizeSolutionSections({}), entities: [], relations: [],
  createdAt: new Date(2026, 0, 1), updatedAt: new Date(2026, 0, 1), ...o,
})
const GRAPH = solution({
  id: "graph", name: "Product knowledge graph", status: "delivered", stack: ["neo4j", "gds", "kafka"],
  updatedAt: new Date(2026, 9, 1),
})
const SEARCH = solution({ id: "search", clientId: "c2", stack: ["kafka"], updatedAt: new Date(2026, 9, 5) })
const OLD = solution({ id: "old", status: "retired", stack: ["neo4j"], updatedAt: new Date(2025, 5, 1) })
const ALL = [GRAPH, OLD, SEARCH]
const none = { client: null, status: null, stack: null, q: null }
const ids = (list: Solution[]) => list.map((s) => s.id)

describe("filterSolutions", () => {
  it("lists every solution, the most recently updated first", () => {
    expect(ids(filterSolutions(ALL, none))).toEqual(["search", "graph", "old"])
  })

  it("narrows by client, status and stack, and by all three at once", () => {
    expect(ids(filterSolutions(ALL, { ...none, client: "c1" }))).toEqual(["graph", "old"])
    expect(ids(filterSolutions(ALL, { ...none, status: "retired" }))).toEqual(["old"])
    expect(ids(filterSolutions(ALL, { ...none, stack: "kafka" }))).toEqual(["search", "graph"])
    expect(ids(filterSolutions(ALL, { ...none, client: "c1", status: "delivered", stack: "neo4j" }))).toEqual(["graph"])
    expect(filterSolutions(ALL, { ...none, client: "c2", stack: "neo4j" })).toEqual([])
  })

  it("searches the name, domain, stack and every section's text, in any case", () => {
    const written = solution({
      id: "written", domain: "Retail",
      sections: normalizeSolutionSections({ kpis: "Search time from 4 s to 1 s", history: "2026-06-30 Threshold to 0.85" }),
    })
    const list = [...ALL, written]
    expect(ids(filterSolutions(list, { ...none, q: "knowledge" }))).toEqual(["graph"])
    expect(ids(filterSolutions(list, { ...none, q: "SEARCH TIME" }))).toEqual(["written"])
    expect(ids(filterSolutions(list, { ...none, q: "threshold" }))).toEqual(["written"])
    expect(ids(filterSolutions(list, { ...none, q: "retail" }))).toEqual(["written"])
    expect(ids(filterSolutions(list, { ...none, q: "GDS" }))).toEqual(["graph"])
    expect(ids(filterSolutions(list, { ...none, q: "kafka", client: "c1" }))).toEqual(["graph"])
    expect(filterSolutions(list, { ...none, q: "salesforce" })).toEqual([])
  })
})

describe("solutionFilters", () => {
  it("reads the four params, a tag in lowercase and the search trimmed", () => {
    expect(solutionFilters(new URLSearchParams("client=c1&status=building&stack=Neo4j&q=+Graph+"))).toEqual({
      client: "c1", status: "building", stack: "neo4j", q: "Graph",
    })
  })

  it("reads a missing, empty or unknown value as no filter", () => {
    expect(solutionFilters(new URLSearchParams("client=&status=done&q=%20"))).toEqual(none)
  })
})

describe("usedStack", () => {
  it("lists each technology once, alphabetically", () => {
    expect(usedStack(ALL)).toEqual(["gds", "kafka", "neo4j"])
  })
})

describe("filledSections", () => {
  it("counts the sections with text, a blank one as empty", () => {
    expect(filledSections(GRAPH)).toBe(0)
    const sections = normalizeSolutionSections({ purpose: "One graph for the catalog", kpis: "  \n", results: "Search time halved" })
    expect(filledSections({ sections })).toBe(2)
  })
})

describe("missingSections", () => {
  it("lists the sections with no text in their order, a blank one included", () => {
    const sections = normalizeSolutionSections({ purpose: "One graph for the catalog", kpis: "  \n", results: "Search time halved" })
    expect(missingSections({ sections })).toEqual(["requirements", "kpis", "sources", "model", "architecture", "steps", "history"])
    // A solution carries its kind, and a product no longer asks for Steps and History.
    expect(missingSections(GRAPH)).toHaveLength(7)
  })
})

describe("contractState", () => {
  it("is Pre-sales without a contract, else the contract's own state", () => {
    expect(contractState(undefined)).toBe("Pre-sales")
    expect(contractState({ isActive: true })).toBe("Active")
    expect(contractState({ isActive: false })).toBe("Closed")
  })
})

describe("solutionNameTaken", () => {
  it("finds the client's solution with the name, ignoring case and the spaces at its ends", () => {
    expect(solutionNameTaken(ALL, "c1", "  product KNOWLEDGE graph ")).toBe(GRAPH)
    expect(solutionNameTaken(ALL, "c1", "Product knowledge graphs")).toBeUndefined()
  })

  it("lets a solution keep its own name in another case, and another client use the name", () => {
    expect(solutionNameTaken(ALL, "c1", "PRODUCT KNOWLEDGE GRAPH", "graph")).toBeUndefined()
    expect(solutionNameTaken(ALL, "c2", "Product knowledge graph")).toBeUndefined()
  })
})

describe("historyEntries", () => {
  it("reads one dated line per entry, newest first, a same-day pair in the order written", () => {
    const text = "2026-02-10 Kickoff, 48-day contract.\n2026-07-15 Go-live.\n2026-03-20: Model v1 approved\n2026-07-15 — Store pilot signed off"
    expect(historyEntries(text)).toEqual([
      { date: "2026-07-15", text: "Go-live." },
      { date: "2026-07-15", text: "Store pilot signed off" },
      { date: "2026-03-20", text: "Model v1 approved" },
      { date: "2026-02-10", text: "Kickoff, 48-day contract." },
    ])
  })

  it("keeps a line with no date as part of the entry above it, and skips blank lines", () => {
    expect(historyEntries("2026-05-12 From the nightly CSV to CDC:\n\n  24 hours of latency were blocking search.\n2026-06-30 Threshold 0.85")).toEqual([
      { date: "2026-06-30", text: "Threshold 0.85" },
      { date: "2026-05-12", text: "From the nightly CSV to CDC:\n24 hours of latency were blocking search." },
    ])
  })

  it("is null, so the text shows as written, when it does not open on a date", () => {
    expect(historyEntries("We moved to CDC in May.\n2026-07-15 Go-live.")).toBeNull()
    expect(historyEntries("2026-07-150 is not a date")).toBeNull()
    expect(historyEntries("   \n")).toBeNull()
  })

  it("never drops text: every line that is not blank is in some entry, or the whole text shows as written", () => {
    const texts = [
      "2026-02-10 Kickoff\nscope: graph only\n2026-03-20 Model v1\n\n- dropped Attribute nodes",
      "2026-02-10\nKickoff without words on the dated line",
      "Kickoff\n2026-03-20 Model v1",
    ]
    for (const text of texts) {
      const entries = historyEntries(text)
      if (!entries) continue
      const shown = entries.map((e) => `${e.date} ${e.text}`).join("\n")
      for (const line of text.split("\n").filter((l) => l.trim())) {
        expect(shown).toContain(line.trim().replace(/^\d{4}-\d{2}-\d{2}\s*/, ""))
      }
    }
  })
})

describe("lineLabel", () => {
  it("finds a short leading label before a colon and a space", () => {
    expect(lineLabel("Zero-result searches: 12% → under 5%")).toBe("Zero-result searches:")
    expect(lineLabel("SAP → graph latency: under 15 minutes")).toBe("SAP → graph latency:")
  })

  it("leaves a sentence, a link and a time alone", () => {
    expect(lineLabel("Duplicates flagged, never deleted: the category manager decides.")).toBeNull()
    expect(lineLabel("https://neo4j.com/docs for the details")).toBeNull()
    expect(lineLabel("10:30 standup with the catalogue team")).toBeNull()
    expect(lineLabel("A label that runs on for far too long to be one: text")).toBeNull()
    expect(lineLabel("Ends with a colon:")).toBeNull()
  })
})

// ─── The road of steps ───────────────────────────────────────────────────────

const stp = (title: string, state: SolutionStep["state"], over: Partial<SolutionStep> = {}): SolutionStep => ({
  title, state, fromMonth: "2026-03", toMonth: null, paidBy: null, goal: null, outcome: null, doneOn: null, ...over,
})

describe("completeStep", () => {
  const road = [stp("Audit", "done", { doneOn: "2026-04-02" }), stp("Tune", "now"), stp("Review", "next"), stp("Hand over", "later")]

  it("marks the Now step Done with its outcome and the day, and makes the next step Now", () => {
    const out = completeStep(road, 1, "Reports under 2 s", "2026-05-20")
    expect(out.map((s) => s.state)).toEqual(["done", "done", "now", "later"])
    expect(out[1]).toMatchObject({ outcome: "Reports under 2 s", doneOn: "2026-05-20" })
    expect(road[1].state).toBe("now")
  })

  it("moves Now past a step that is already Done, and to nobody after the last", () => {
    const skipped = [stp("A", "now"), stp("B", "done"), stp("C", "later")]
    expect(completeStep(skipped, 0, "ok", "2026-05-20").map((s) => s.state)).toEqual(["done", "done", "now"])
    expect(completeStep([stp("A", "now")], 0, "ok", "2026-05-20").map((s) => s.state)).toEqual(["done"])
  })

  it("leaves Now where it is when a step that was not Now is completed", () => {
    expect(completeStep(road, 3, "ok", "2026-05-20").map((s) => s.state)).toEqual(["done", "now", "next", "done"])
  })
})

describe("nowStep", () => {
  it("is the Now step, or undefined", () => {
    expect(nowStep([stp("A", "done"), stp("B", "now")])?.title).toBe("B")
    expect(nowStep([stp("A", "next")])).toBeUndefined()
  })
})

describe("stepContract", () => {
  const opportunities = [{ id: "o1", engagementId: "e1" }, { id: "o2", engagementId: null }]

  it.each([
    ["a won opportunity gives its contract", { type: "opportunity", id: "o1" }, { type: "contract", id: "e1" }],
    ["an open opportunity stays the opportunity", { type: "opportunity", id: "o2" }, { type: "opportunity", id: "o2" }],
    ["a contract stays the contract", { type: "contract", id: "e9" }, { type: "contract", id: "e9" }],
    ["an opportunity no longer there stays as stored", { type: "opportunity", id: "gone" }, { type: "opportunity", id: "gone" }],
  ] as const)("%s", (_, paidBy, expected) => {
    expect(stepContract(stp("A", "next", { paidBy }), opportunities)).toEqual(expected)
  })

  it("is null for a step nobody pays for", () => {
    expect(stepContract(stp("A", "next"), opportunities)).toBeNull()
  })
})

describe("sectionsFor", () => {
  it("lists the kind's sections in order, an Advisory's results as Results and Lessons", () => {
    expect(sectionsFor("advisory").map((s) => [s.key, s.label])).toEqual([
      ["purpose", "Purpose and Target"], ["kpis", "KPIs"], ["results", "Results and Lessons"],
    ])
    expect(sectionsFor("product").map((s) => s.key)).toEqual(["purpose", "requirements", "kpis", "sources", "model", "architecture", "results"])
    expect(sectionsFor("product").find((s) => s.key === "results")?.label).toBe("Results")
  })
})

describe("missingSections by kind", () => {
  it("asks only the kind's sections, and every section when the kind is not known", () => {
    const sections = normalizeSolutionSections({ purpose: "Why" })
    expect(missingSections({ sections, kind: "advisory" })).toEqual(["kpis", "results"])
    expect(missingSections({ sections, kind: "product" })).toEqual(["requirements", "kpis", "sources", "model", "architecture", "results"])
  })
})

describe("stepUsage", () => {
  const contract = { id: "e1", contractedDays: 11 }
  // 52 h = 6.5 days; the card's 7 h on another contract and a day after today are not counted.
  const timecards = [
    { engagementId: "e1", date: "2026-10-05", hours: 40 },
    { engagementId: "e1", date: "2026-11-03", hours: 12 },
    { engagementId: "e2", date: "2026-11-03", hours: 7 },
    { engagementId: "e1", date: "2026-11-20", hours: 8 },
  ]

  it("is the days the client page shows for the same contract and hours", () => {
    const page = contractUsage({ engagement: contract, timecards, cells: [{ yearMonth: "2026-11", billableDays: 3 }], today: "2026-11-10" })!
    expect(stepUsage(contract, timecards, "2026-11-10")).toEqual({ used: page.used, total: page.total })
    expect(stepUsage(contract, timecards, "2026-11-10")).toEqual({ used: 6.5, total: 11 })
  })

  it("is null for a contract with no cap", () => {
    expect(stepUsage({ id: "e1", contractedDays: null }, timecards, "2026-11-10")).toBeNull()
  })
})

describe("pipelineSteps", () => {
  const opps = [
    { id: "o1", stage: "proposal", engagementId: null },
    { id: "o2", stage: "lead", engagementId: null },
    { id: "o3", stage: "lost", engagementId: null },
    { id: "o4", stage: "won", engagementId: "e4" },
  ] as never
  it("lists, with their number, only the steps paid by an open opportunity", () => {
    const road = [
      stp("A", "done", { paidBy: { type: "contract", id: "e1" } }),
      stp("B", "now", { paidBy: { type: "opportunity", id: "o4" } }),
      stp("C", "next", { paidBy: { type: "opportunity", id: "o1" } }),
      stp("D", "later", { paidBy: { type: "opportunity", id: "o3" } }),
      stp("E", "later"),
      stp("F", "later", { paidBy: { type: "opportunity", id: "o2" } }),
    ]
    expect(pipelineSteps(road, opps).map((p) => [p.number, p.step.title, p.opportunity.id])).toEqual([
      [3, "C", "o1"],
      [6, "F", "o2"],
    ])
  })
})

describe("moveStep", () => {
  it.each([
    ["later", 0, 1, ["B", "A", "C"]],
    ["earlier", 2, 1, ["A", "C", "B"]],
    ["to the end", 0, 2, ["B", "C", "A"]],
    ["nowhere past the end", 2, 3, ["A", "B", "C"]],
    ["nowhere before the start", 0, -1, ["A", "B", "C"]],
  ])("%s", (_, from, to, expected) => {
    const road = [stp("A", "done"), stp("B", "now"), stp("C", "next")]
    expect(moveStep(road, from, to).map((s) => s.title)).toEqual(expected)
  })
})

describe("stepWhen", () => {
  it.each([
    [{ fromMonth: "2026-10", toMonth: "2026-11" }, "Oct – Nov 2026"],
    [{ fromMonth: "2026-10", toMonth: "2026-10" }, "Oct 2026"],
    [{ fromMonth: "2026-10", toMonth: null }, "From Oct 2026"],
    [{ fromMonth: "2026-11", toMonth: "2027-02" }, "Nov 2026 – Feb 2027"],
  ])("%j", (months, expected) => expect(stepWhen(months)).toBe(expected))
})

describe("saveStep", () => {
  const road = [stp("A", "done", { outcome: "ok", doneOn: "2026-04-02" }), stp("B", "now"), stp("C", "next")]
  const draft = (over: Partial<Parameters<typeof saveStep>[2]> = {}) => ({
    title: "B", state: "now" as const, fromMonth: "2026-03", toMonth: "", paidBy: null, goal: "", outcome: "", ...over,
  })
  const steps = (r: ReturnType<typeof saveStep>) => ("steps" in r ? r.steps : [])

  it("adds a step at the end, blanks stored as null", () => {
    const out = steps(saveStep(road, null, draft({ title: " D ", state: "later", goal: " Hand over " }), "2026-05-20"))
    expect(out).toHaveLength(4)
    expect(out[3]).toEqual({ title: "D", state: "later", fromMonth: "2026-03", toMonth: null, paidBy: null, goal: "Hand over", outcome: null, doneOn: null })
  })

  it("marks the Now step Done with its outcome: the day is today and the next step becomes Now", () => {
    const out = steps(saveStep(road, 1, draft({ state: "done", outcome: "Live" }), "2026-05-20"))
    expect(out.map((s) => s.state)).toEqual(["done", "done", "now"])
    expect(out[1]).toMatchObject({ outcome: "Live", doneOn: "2026-05-20" })
  })

  it("asks for the outcome of a step marked Done, and writes nothing without it", () => {
    expect(saveStep(road, 1, draft({ state: "done", outcome: "  " }), "2026-05-20")).toEqual({ errors: ["Say what came of it to mark the step Done"] })
  })

  it("keeps the day of a step that stays Done, and clears day and outcome when it is reopened", () => {
    const kept = steps(saveStep(road, 0, draft({ title: "A", state: "done", outcome: "Better" }), "2026-05-20"))
    expect(kept[0]).toMatchObject({ outcome: "Better", doneOn: "2026-04-02" })
    const reopened = steps(saveStep(road, 0, draft({ title: "A", state: "next", outcome: "Better" }), "2026-05-20"))
    expect(reopened[0]).toMatchObject({ state: "next", outcome: null, doneOn: null })
  })

  it("makes another step Now by moving the current Now to Next", () => {
    const out = steps(saveStep(road, 2, draft({ title: "C", state: "now" }), "2026-05-20"))
    expect(out.map((s) => s.state)).toEqual(["done", "next", "now"])
  })

  it("reports the schema's complaint, naming nothing written", () => {
    expect(saveStep(road, 2, draft({ title: "C", state: "next", toMonth: "2026-01" }), "2026-05-20")).toEqual({ errors: ["The end is before the start"] })
    expect(saveStep(road, 2, draft({ title: " ", state: "next" }), "2026-05-20")).toEqual({ errors: ["Name the step"] })
  })
})
