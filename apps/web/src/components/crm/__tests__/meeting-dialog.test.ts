import { describe, expect, it } from "vitest"

import { meetingForm, meetingUpdate } from "../meeting-dialog"

import type { Meeting } from "@/types"

function meeting(o: Partial<Meeting> = {}): Meeting {
  return {
    id: "m",
    userId: "u",
    clientId: "acme",
    engagementId: "e1",
    date: "2026-09-12",
    time: "10:30",
    health: "yellow",
    text: "Call di avanzamento",
    createdAt: new Date("2026-09-12"),
    updatedAt: new Date("2026-09-12"),
    ...o,
  }
}

describe("meetingForm", () => {
  // A call is logged afterwards: the time starts empty, never "now".
  it("starts a new verbale today, untimed, with no light, on the section's contract", () => {
    expect(meetingForm(null, "e1", "2026-09-26")).toEqual({
      date: "2026-09-26",
      time: "",
      engagementId: "e1",
      health: null,
      text: "",
    })
    expect(meetingForm(null, null, "2026-09-26").engagementId).toBeNull()
  })

  it("holds a verbale as the inputs show it", () => {
    expect(meetingForm(meeting({ time: null, health: null }), "other", "2026-09-26")).toEqual({
      date: "2026-09-12",
      time: "",
      engagementId: "e1",
      health: null,
      text: "Call di avanzamento",
    })
  })
})

describe("meetingUpdate", () => {
  it("writes nothing when nothing changed", () => {
    expect(meetingUpdate(meeting(), meetingForm(meeting(), null, "2026-09-26"))).toEqual({})
    const untimed = meeting({ time: null, health: null, engagementId: null })
    expect(meetingUpdate(untimed, meetingForm(untimed, null, "2026-09-26"))).toEqual({})
  })

  // Only what changed: a field left alone must not overwrite the MCP's edit.
  it("writes only the changed fields", () => {
    const form = { ...meetingForm(meeting(), null, "2026-09-26"), date: "2026-09-11", health: "red" as const }
    expect(meetingUpdate(meeting(), form)).toEqual({ date: "2026-09-11", health: "red" })
  })

  it("turns an emptied time into null, and a cleared light into null", () => {
    const form = { ...meetingForm(meeting(), null, "2026-09-26"), time: "", health: null }
    expect(meetingUpdate(meeting(), form)).toEqual({ time: null, health: null })
  })

  it("compares the text trimmed, as it is stored", () => {
    const form = meetingForm(meeting(), null, "2026-09-26")
    expect(meetingUpdate(meeting(), { ...form, text: "  Call di avanzamento \n" })).toEqual({})
    expect(meetingUpdate(meeting(), { ...form, text: " Call rimandata " })).toEqual({ text: "Call rimandata" })
  })

  it("moves a verbale to another contract, or to the client", () => {
    const form = meetingForm(meeting(), null, "2026-09-26")
    expect(meetingUpdate(meeting(), { ...form, engagementId: "e2" })).toEqual({ engagementId: "e2" })
    expect(meetingUpdate(meeting(), { ...form, engagementId: null })).toEqual({ engagementId: null })
  })
})
