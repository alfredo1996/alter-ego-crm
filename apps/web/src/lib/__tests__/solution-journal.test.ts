import { describe, expect, it } from "vitest"

import { journalItems, type JOURNAL_FILTERS } from "@/lib/solution-journal"

import type { JournalEntry, Meeting, SolutionStep } from "@/types"

// Synthetic: the Guest 360 solution of Alpine Resorts Group.
const at = (day: number) => new Date(2026, 10, day)

const entry = (o: Partial<JournalEntry>): JournalEntry => ({
  id: "e", userId: "u", solutionId: "s1", clientId: "c1", kind: "work", date: "2026-11-07", stepTitle: null,
  text: "Did", decisions: [], links: [], next: null, source: null, createdAt: at(7), updatedAt: at(7), ...o,
})

const meeting = (o: Partial<Meeting>): Meeting => ({
  id: "m", userId: "u", clientId: "c1", engagementId: "k1", date: "2026-11-04", time: null, health: "green",
  text: "Call", createdAt: at(4), updatedAt: at(4), ...o,
})

const step = (o: Partial<SolutionStep>): SolutionStep => ({
  title: "Step", state: "next", fromMonth: "2026-09", toMonth: null, paidBy: null, goal: null, outcome: null, doneOn: null, ...o,
})

const steps = [
  step({ title: "Proof of concept", state: "done", outcome: "Report sent", doneOn: "2026-09-12" }),
  step({ title: "MVP", state: "now", paidBy: { type: "contract", id: "k1" } }),
  step({ title: "Rollout", state: "later" }),
]

const input = {
  entries: [
    entry({ id: "w1", date: "2026-11-07", text: "Rewrote the load", decisions: ["Spend goes to the booking holder"], stepTitle: "MVP" }),
    entry({ id: "d1", kind: "decision", date: "2026-11-04", text: "Keep the old hotels", createdAt: at(4) }),
    entry({ id: "w2", date: "2026-10-31", text: "Installed the stack", createdAt: at(1) }),
    entry({ id: "other", solutionId: "s2", date: "2026-11-08", text: "Another solution" }),
  ],
  meetings: [
    meeting({ id: "m1", date: "2026-11-04", text: "Third data drop" }),
    meeting({ id: "m2", engagementId: "k9", date: "2026-11-05", text: "Another contract" }),
    meeting({ id: "m3", engagementId: null, date: "2026-11-06", text: "About the client" }),
  ],
  steps,
  solutionId: "s1",
  contractIds: ["k1"],
}

const ids = (filter: (typeof JOURNAL_FILTERS)[number]) => journalItems(input, filter).map((i) => i.id)

describe("journalItems", () => {
  it("merges entries, the calls of the step contracts and done steps, newest first, decisions of a session on its own line", () => {
    expect(ids("all")).toEqual(["w1", "w1:decision:0", "d1", "m1", "w2", "step:0"].map((id) => id))
  })

  it.each([
    ["work", ["w1", "w2"]],
    ["calls", ["m1"]],
    ["decisions", ["w1:decision:0", "d1"]],
    ["steps", ["step:0"]],
  ] as const)("%s keeps only its kind", (filter, expected) => {
    expect(ids(filter)).toEqual(expected)
  })

  it("a done step is dated by the day it was done", () => {
    expect(journalItems(input, "steps")[0]).toMatchObject({ type: "step", date: "2026-09-12", number: 1 })
  })
})
