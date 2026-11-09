import { describe, expect, it } from "vitest"

import {
  isTaskOverdue,
  labelColor,
  normalizeLabels,
  sortDoneTasks,
  sortTasks,
  statusOf,
  taskClientId,
  taskStatusUpdate,
  labelSuggestions,
  usedLabels,
} from "@/lib/tasks"

import type { Task } from "@/types"

function task(o: Partial<Task>): Task {
  return {
    id: "t",
    userId: "u",
    clientId: "c",
    engagementId: "e",
    title: "Task",
    dueDate: null,
    notes: null,
    isDone: false,
    startedAt: null,
    labels: [],
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...o,
  }
}

describe("taskClientId", () => {
  const engagements = [{ id: "e1", clientId: "acme" }]

  it("reads the task's own client, attached or client-level", () => {
    expect(taskClientId(task({ clientId: "acme", engagementId: "e1" }), engagements)).toBe("acme")
    expect(taskClientId(task({ clientId: "globex", engagementId: null }), engagements)).toBe("globex")
  })

  it("falls back to the contract's client on a document written before #164", () => {
    expect(taskClientId(task({ clientId: null, engagementId: "e1" }), engagements)).toBe("acme")
  })

  it("is null when neither the task nor a known contract names one", () => {
    expect(taskClientId(task({ clientId: null, engagementId: "gone" }), engagements)).toBeNull()
  })
})

describe("sortTasks", () => {
  it("puts open before done, due-dated (soonest first) before undated, then creation order", () => {
    const done = task({ id: "done", isDone: true, dueDate: new Date("2026-01-05") })
    const dueSoon = task({ id: "soon", dueDate: new Date("2026-02-01") })
    const dueLate = task({ id: "late", dueDate: new Date("2026-03-01") })
    const undatedOld = task({ id: "old", createdAt: new Date("2026-01-01") })
    const undatedNew = task({ id: "new", createdAt: new Date("2026-01-10") })

    const sorted = sortTasks([done, undatedNew, dueLate, undatedOld, dueSoon])
    expect(sorted.map((t) => t.id)).toEqual(["soon", "late", "old", "new", "done"])
  })

  it("does not mutate the input", () => {
    const input = [task({ id: "b", isDone: true }), task({ id: "a" })]
    sortTasks(input)
    expect(input.map((t) => t.id)).toEqual(["b", "a"])
  })
})

describe("sortDoneTasks", () => {
  // No completion time is stored: the last write stands in for it.
  it("puts the most recently done first", () => {
    const older = task({ id: "older", isDone: true, updatedAt: new Date("2026-10-01") })
    const newer = task({ id: "newer", isDone: true, updatedAt: new Date("2026-10-10") })
    const middle = task({ id: "middle", isDone: true, updatedAt: new Date("2026-10-05") })
    expect(sortDoneTasks([older, newer, middle]).map((t) => t.id)).toEqual(["newer", "middle", "older"])
  })
})

describe("isTaskOverdue", () => {
  const today = new Date("2026-08-21T15:00:00")

  it("is overdue when the due date has passed and the task is open", () => {
    expect(isTaskOverdue(task({ dueDate: new Date("2026-08-20") }), today)).toBe(true)
  })

  it("is not overdue on the due date itself", () => {
    expect(isTaskOverdue(task({ dueDate: new Date("2026-08-21T00:00:00") }), today)).toBe(false)
  })

  it("is never overdue when done or undated", () => {
    expect(isTaskOverdue(task({ dueDate: new Date("2026-08-01"), isDone: true }), today)).toBe(false)
    expect(isTaskOverdue(task({ dueDate: null }), today)).toBe(false)
  })
})

describe("statusOf", () => {
  const started = new Date("2026-08-01")

  it("reads todo, doing and done from isDone and startedAt", () => {
    expect(statusOf(task({}))).toBe("todo")
    expect(statusOf(task({ startedAt: started }))).toBe("doing")
    expect(statusOf(task({ isDone: true }))).toBe("done")
    expect(statusOf(task({ isDone: true, startedAt: started }))).toBe("done")
  })

  // Intended: reopen and the checkboxes write isDone alone, so a task that was
  // in progress before it was ticked goes back to "in corso", not "da fare".
  it("reads a completed-then-reopened task with a lingering startedAt as doing", () => {
    const reopened = task({ isDone: false, startedAt: started })
    expect(statusOf(reopened)).toBe("doing")
  })
})

describe("taskStatusUpdate", () => {
  const now = new Date("2026-09-24T10:00:00")
  const started = new Date("2026-08-01")

  it("todo reopens and clears the start", () => {
    expect(taskStatusUpdate("todo", { startedAt: started }, now)).toEqual({ isDone: false, startedAt: null })
  })

  it("doing stamps now, or keeps an existing start", () => {
    expect(taskStatusUpdate("doing", { startedAt: null }, now)).toEqual({ isDone: false, startedAt: now })
    expect(taskStatusUpdate("doing", { startedAt: started }, now)).toEqual({ isDone: false, startedAt: started })
  })

  it("done only ticks isDone, leaving startedAt untouched", () => {
    expect(taskStatusUpdate("done", { startedAt: started }, now)).toEqual({ isDone: true })
  })

  it("round-trips: the update lands the task in the target column", () => {
    for (const target of ["todo", "doing", "done"] as const) {
      for (const from of [task({}), task({ startedAt: started }), task({ isDone: true, startedAt: started })]) {
        expect(statusOf({ ...from, ...taskStatusUpdate(target, from, now) })).toBe(target)
      }
    }
  })
})

describe("normalizeLabels", () => {
  it("trims, collapses inner whitespace and drops empties", () => {
    expect(normalizeLabels(["  Da   rivedere ", "", "   ", "\tBug\n"])).toEqual(["Da rivedere", "Bug"])
  })

  it("caps each label at 30 code points without leaving a trailing space", () => {
    expect(normalizeLabels(["x".repeat(40)])).toEqual(["x".repeat(30)])
    expect(normalizeLabels(["a".repeat(29) + " tail"])).toEqual(["a".repeat(29)])
  })

  it("counts code points, so the cap never splits an emoji", () => {
    expect(normalizeLabels(["🔥".repeat(31)])).toEqual(["🔥".repeat(30)])
  })

  it("de-duplicates case-insensitively, keeping the first spelling", () => {
    expect(normalizeLabels(["Urgente", "urgente", "URGENTE ", "Cliente"])).toEqual(["Urgente", "Cliente"])
  })

  it("keeps at most 10 labels, counting only the ones that survive", () => {
    const input = ["", "a", "A", ...Array.from({ length: 12 }, (_, i) => `l${i}`)]
    const out = normalizeLabels(input)
    expect(out).toHaveLength(10)
    expect(out.slice(0, 2)).toEqual(["a", "l0"])
  })
})

describe("labelColor", () => {
  it("is case-insensitive and stable", () => {
    expect(labelColor("Urgente")).toBe(labelColor("urgente"))
    expect(labelColor("Urgente")).toBe(labelColor("Urgente"))
  })

  // A TagChip's dot: the chip itself stays neutral, so the colour never carries the text.
  it("returns a dot colour", () => {
    expect(labelColor("Bug")).toMatch(/^#[0-9a-f]{6}$/)
  })

  it("spreads different labels across the palette", () => {
    const labels = ["Urgente", "Cliente", "Bug", "Fattura", "Design", "Backend", "Frontend", "Riunione",
      "Documentazione", "Revisione", "Bloccato", "Idea", "Admin", "Legale", "Marketing", "Ricerca"]
    expect(new Set(labels.map(labelColor)).size).toBeGreaterThanOrEqual(6)
  })
})

describe("usedLabels", () => {
  it("lists every label once whatever its case, first spelling kept, A to Z", () => {
    const tasks = [task({ labels: ["Urgente", "bug"] }), task({ labels: ["urgente", "Admin"] }), task({ labels: [] })]
    expect(usedLabels(tasks)).toEqual(["Admin", "bug", "Urgente"])
  })
})

describe("labelSuggestions", () => {
  const used = ["Admin", "Bug", "Cliente VIP", "Urgente"]

  it("offers every label the task lacks when nothing is typed", () => {
    expect(labelSuggestions(used, ["bug"], "")).toEqual(["Admin", "Cliente VIP", "Urgente"])
  })

  it("narrows to the labels containing the typed text, ignoring case", () => {
    expect(labelSuggestions(used, [], " EN")).toEqual(["Cliente VIP", "Urgente"])
  })

  it("stops at the limit", () => {
    expect(labelSuggestions(used, [], "", 2)).toEqual(["Admin", "Bug"])
  })
})
