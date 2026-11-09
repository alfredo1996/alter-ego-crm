import { describe, expect, it } from "vitest"

import { taskDetailForm, taskDetailUpdate } from "../task-detail-dialog"

import type { Task } from "@/types"

function task(o: Partial<Task> = {}): Task {
  return {
    id: "t",
    userId: "u",
    clientId: "acme",
    engagementId: "e1",
    title: "Consegna",
    dueDate: new Date(2026, 9, 1),
    notes: "Prima bozza",
    isDone: false,
    startedAt: null,
    labels: ["Urgente"],
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...o,
  }
}

const now = new Date("2026-09-25T10:00:00")

describe("taskDetailForm", () => {
  it("holds the task as the inputs show it", () => {
    expect(taskDetailForm(task({ notes: null, dueDate: null }))).toEqual({
      title: "Consegna",
      status: "todo",
      dueDate: "",
      notes: "",
      labels: ["Urgente"],
      engagementId: "e1",
    })
    expect(taskDetailForm(task()).dueDate).toBe("2026-10-01")
  })
})

describe("taskDetailUpdate", () => {
  it("writes nothing when nothing changed", () => {
    expect(taskDetailUpdate(task(), taskDetailForm(task()), "acme", now)).toEqual({})
  })

  // Only what changed: a field left alone must not overwrite the MCP's edit.
  it("writes only the changed fields, trimmed and normalized", () => {
    const form = { ...taskDetailForm(task()), title: " Consegna finale ", notes: "  ", labels: ["Urgente", " bug  "] }
    expect(taskDetailUpdate(task(), form, "acme", now)).toEqual({
      title: "Consegna finale",
      notes: null,
      labels: ["Urgente", "bug"],
    })
  })

  it("does not count an unnormalized copy of the same labels as a change", () => {
    const form = { ...taskDetailForm(task()), labels: ["Urgente", "urgente", ""] }
    expect(taskDetailUpdate(task(), form, "acme", now)).toEqual({})
  })

  it("writes a due date as local midnight, or clears it", () => {
    const set = { ...taskDetailForm(task()), dueDate: "2026-12-24" }
    expect(taskDetailUpdate(task(), set, "acme", now)).toEqual({ dueDate: new Date(2026, 11, 24) })
    const cleared = { ...taskDetailForm(task()), dueDate: "" }
    expect(taskDetailUpdate(task(), cleared, "acme", now)).toEqual({ dueDate: null })
  })

  // The column and the checkbox read isDone/startedAt: the dialog writes them the board's way.
  it("moves the status through taskStatusUpdate", () => {
    const doing = { ...taskDetailForm(task()), status: "doing" as const }
    expect(taskDetailUpdate(task(), doing, "acme", now)).toEqual({ isDone: false, startedAt: now })
    const started = task({ startedAt: new Date("2026-09-01") })
    const done = { ...taskDetailForm(started), status: "done" as const }
    expect(taskDetailUpdate(started, done, "acme", now)).toEqual({ isDone: true })
  })

  it("detaches to client level, restating the client", () => {
    const form = { ...taskDetailForm(task()), engagementId: null }
    expect(taskDetailUpdate(task(), form, "acme", now)).toEqual({ engagementId: null, clientId: "acme" })
  })

  // #164: a document written before clientId existed would otherwise name neither.
  it("gives a pre-#164 task its client when it moves", () => {
    const old = task({ clientId: null })
    const form = { ...taskDetailForm(old), engagementId: null }
    expect(taskDetailUpdate(old, form, "acme", now)).toEqual({ engagementId: null, clientId: "acme" })
  })

  it("attaches a client-level task to a contract", () => {
    const clientLevel = task({ engagementId: null })
    const form = { ...taskDetailForm(clientLevel), engagementId: "e2" }
    expect(taskDetailUpdate(clientLevel, form, "acme", now)).toEqual({ engagementId: "e2", clientId: "acme" })
  })
})
