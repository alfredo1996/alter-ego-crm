import { describe, expect, it } from "vitest"

import { MEETING_HEALTH, firstLine, formatMeetingDate, healthByContract, sortMeetings } from "@/lib/meetings"
import { MEETING_TEXT_MAX, createMeetingSchema, updateMeetingSchema } from "@/types/schemas"

import type { Meeting } from "@/types"

let n = 0
const meeting = (o: Partial<Meeting> = {}): Meeting => {
  n++
  return {
    id: `m${n}`,
    userId: "u1",
    clientId: "c1",
    engagementId: "e1",
    date: "2026-09-12",
    time: null,
    health: null,
    text: "Call",
    createdAt: new Date(2026, 8, 1, 0, 0, n),
    updatedAt: new Date(2026, 8, 1, 0, 0, n),
    ...o,
  }
}
const ids = (ms: Meeting[]) => ms.map((m) => m.id)

describe("sortMeetings", () => {
  it("puts the newest day first, then the latest time, untimed last on its day", () => {
    const old = meeting({ id: "old", date: "2026-09-01", time: "18:00" })
    const untimed = meeting({ id: "untimed", date: "2026-09-12" })
    const morning = meeting({ id: "morning", date: "2026-09-12", time: "09:00" })
    const afternoon = meeting({ id: "afternoon", date: "2026-09-12", time: "15:30" })
    expect(ids(sortMeetings([old, untimed, morning, afternoon]))).toEqual(["afternoon", "morning", "untimed", "old"])
  })

  it("breaks a tie on the same day and time by createdAt, newest first", () => {
    const first = meeting({ id: "first", time: "10:00", createdAt: new Date(2026, 8, 12, 11) })
    const second = meeting({ id: "second", time: "10:00", createdAt: new Date(2026, 8, 12, 12) })
    expect(ids(sortMeetings([first, second]))).toEqual(["second", "first"])
  })

  it("sorts an untimed verbale written on its own day at the time it was written", () => {
    const call = meeting({ id: "call", time: "10:30", createdAt: new Date(2026, 8, 12, 11) })
    const later = meeting({ id: "later", createdAt: new Date(2026, 8, 12, 16) })
    const earlier = meeting({ id: "earlier", createdAt: new Date(2026, 8, 12, 9) })
    expect(ids(sortMeetings([earlier, call, later]))).toEqual(["later", "call", "earlier"])
  })

  it("orders a backdated verbale by its date, not by when it was written", () => {
    const recent = meeting({ id: "recent", date: "2026-09-20", createdAt: new Date(2026, 8, 20) })
    const backdated = meeting({ id: "backdated", date: "2026-09-10", createdAt: new Date(2026, 8, 25) })
    expect(ids(sortMeetings([backdated, recent]))).toEqual(["recent", "backdated"])
  })

  it("does not mutate its input", () => {
    const input = [meeting({ date: "2026-01-01" }), meeting({ date: "2026-02-01" })]
    const before = ids(input)
    sortMeetings(input)
    expect(ids(input)).toEqual(before)
  })
})

describe("healthByContract", () => {
  it("is empty for no verbali", () => {
    expect(healthByContract([]).size).toBe(0)
  })

  it("takes the newest verbale that states a health", () => {
    const green = meeting({ date: "2026-09-02", health: "green" })
    const yellow = meeting({ date: "2026-09-12", health: "yellow" })
    expect(healthByContract([yellow, green]).get("e1")).toBe(yellow)
  })

  it("keeps the older status and its date when a newer verbale states none", () => {
    const yellow = meeting({ date: "2026-09-12", health: "yellow" })
    const silent = meeting({ date: "2026-09-20", health: null })
    const current = healthByContract([yellow, silent]).get("e1")
    expect(current).toBe(yellow)
    expect(current?.date).toBe("2026-09-12")
  })

  it("lets a status set later the same day with no time override that morning's timed call", () => {
    const call = meeting({ date: "2026-09-26", time: "10:30", health: "yellow", createdAt: new Date(2026, 8, 26, 10, 40) })
    const red = meeting({ date: "2026-09-26", health: "red", createdAt: new Date(2026, 8, 26, 15) })
    expect(healthByContract([call, red]).get("e1")).toBe(red)
  })

  it("does not let a backdated verbale override a newer assessment", () => {
    const newer = meeting({ date: "2026-09-20", health: "yellow", createdAt: new Date(2026, 8, 20) })
    const backdated = meeting({ date: "2026-09-10", health: "red", createdAt: new Date(2026, 8, 25) })
    expect(healthByContract([newer, backdated]).get("e1")).toBe(newer)
  })

  it("falls back to the previous stated one when the latest is deleted", () => {
    const green = meeting({ date: "2026-09-02", health: "green" })
    const red = meeting({ date: "2026-09-12", health: "red" })
    expect(healthByContract([green, red]).get("e1")).toBe(red)
    expect(healthByContract([green]).get("e1")).toBe(green)
  })

  it("keeps each contract's status apart", () => {
    const a = meeting({ engagementId: "e1", health: "red" })
    const b = meeting({ engagementId: "e2", health: "green" })
    const map = healthByContract([a, b])
    expect(map.get("e1")).toBe(a)
    expect(map.get("e2")).toBe(b)
  })

  it("never includes client-level verbali", () => {
    const map = healthByContract([meeting({ engagementId: null, health: "red" })])
    expect(map.size).toBe(0)
  })

  it("has no entry for a contract whose verbali never stated one", () => {
    expect(healthByContract([meeting({ health: null })]).has("e1")).toBe(false)
  })
})

describe("firstLine", () => {
  it("skips blank lines and trims", () => {
    expect(firstLine("\n   \n  Test slittati  \nsecond line")).toBe("Test slittati")
  })

  it("truncates with an ellipsis, at most max characters", () => {
    const out = firstLine("a".repeat(200), 120)
    expect(out).toBe(`${"a".repeat(119)}…`)
    expect(Array.from(out)).toHaveLength(120)
    expect(firstLine("a".repeat(120), 120)).toBe("a".repeat(120))
  })

  it("never splits an emoji", () => {
    expect(firstLine("ab🙂🙂", 3)).toBe("ab…")
    expect(firstLine("a🙂b🙂", 3)).toBe("a🙂…")
  })

  it("gives an empty string for blank text", () => {
    expect(firstLine("  \n ")).toBe("")
  })
})

describe("MEETING_HEALTH", () => {
  it("labels all three lights, each with its own literal chip", () => {
    expect(Object.keys(MEETING_HEALTH).sort()).toEqual(["green", "red", "yellow"])
    expect(MEETING_HEALTH.green.label).toBe("Green")
    expect(MEETING_HEALTH.yellow.label).toBe("Yellow")
    expect(MEETING_HEALTH.red.label).toBe("Red")
    expect(MEETING_HEALTH.green.chip).toContain("bg-emerald-100")
    expect(MEETING_HEALTH.yellow.chip).toContain("bg-amber-100")
    expect(MEETING_HEALTH.red.chip).toContain("bg-red-100")
  })
})

describe("formatMeetingDate", () => {
  it("writes the day as a local day", () => {
    expect(formatMeetingDate("2026-09-12")).toBe("12 Sep 2026")
    expect(formatMeetingDate("2026-01-01", "d MMM")).toBe("1 Jan")
  })
})

describe("createMeetingSchema", () => {
  const valid = { clientId: "c1", engagementId: "e1", date: "2026-09-12", time: "10:30", health: "yellow", text: "Call" }
  const ok = (over: Record<string, unknown>) => createMeetingSchema.safeParse({ ...valid, ...over }).success

  it("accepts a full verbale, and a client-level one with no time or health", () => {
    expect(ok({})).toBe(true)
    expect(ok({ engagementId: null, time: null, health: null })).toBe(true)
  })

  it.each(["10:30", "00:00", "23:59"])("accepts the time %s", (time) => {
    expect(ok({ time })).toBe(true)
  })

  it.each(["9:30", "24:00", "10:30:00", "10:60", ""])("rejects the time %s", (time) => {
    expect(ok({ time })).toBe(false)
  })

  it.each(["2026-02-30", "2026-9-1", "12/09/2026", ""])("rejects the date %s", (date) => {
    expect(ok({ date })).toBe(false)
  })

  it("caps the text at MEETING_TEXT_MAX and refuses a blank one", () => {
    expect(MEETING_TEXT_MAX).toBe(5000)
    expect(ok({ text: "x".repeat(5000) })).toBe(true)
    expect(ok({ text: "x".repeat(5001) })).toBe(false)
    expect(ok({ text: "   \n " })).toBe(false)
  })

  it("stores the text trimmed", () => {
    expect(createMeetingSchema.parse({ ...valid, text: "  Call \n" }).text).toBe("Call")
  })

  it("rejects an unknown health", () => {
    expect(ok({ health: "blue" })).toBe(false)
  })

  it("requires a client, and every nullable field to be present", () => {
    expect(ok({ clientId: "" })).toBe(false)
    expect(ok({ time: undefined })).toBe(false)
  })

  it("speaks English", () => {
    const issue = createMeetingSchema.safeParse({ ...valid, time: "9:30" }).error?.issues[0]
    expect(issue?.message).toBe("Invalid time: use HH:MM")
  })
})

describe("updateMeetingSchema", () => {
  it("accepts any subset, and null to clear time and health", () => {
    expect(updateMeetingSchema.safeParse({}).success).toBe(true)
    expect(updateMeetingSchema.safeParse({ time: null, health: null, engagementId: null }).success).toBe(true)
  })

  it("validates what it is given", () => {
    expect(updateMeetingSchema.safeParse({ time: "24:00" }).success).toBe(false)
    expect(updateMeetingSchema.safeParse({ health: "blue" }).success).toBe(false)
    expect(updateMeetingSchema.safeParse({ text: "" }).success).toBe(false)
  })

  it("has no clientId: a verbale never changes client", () => {
    expect(updateMeetingSchema.parse({ clientId: "c2" })).toEqual({})
  })
})
