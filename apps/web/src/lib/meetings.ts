import { isoDate } from "@alter-ego/kernel/dates"
import { format } from "date-fns"


import type { Meeting, MeetingHealth } from "@/types"

/**
 * The three lights, with their StatusPill tone, the chip each one shows and the
 * dot a toggle shows when not pressed. Full literal class strings, the chips copied from
 * LABEL_COLORS in lib/tasks: Tailwind only emits classes it can read in the
 * source, so these must never be assembled from parts.
 */
export const MEETING_HEALTH: Record<
  MeetingHealth,
  { label: "Green" | "Yellow" | "Red"; tone: "success" | "warning" | "danger"; chip: string; dot: string }
> = {
  green: {
    label: "Green",
    tone: "success",
    chip: "border-emerald-200 bg-emerald-100 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-300",
    dot: "text-emerald-500",
  },
  yellow: {
    label: "Yellow",
    tone: "warning",
    chip: "border-amber-200 bg-amber-100 text-amber-800 dark:border-amber-900 dark:bg-amber-950/60 dark:text-amber-300",
    dot: "text-amber-500",
  },
  red: {
    label: "Red",
    tone: "danger",
    chip: "border-red-200 bg-red-100 text-red-800 dark:border-red-900 dark:bg-red-950/60 dark:text-red-300",
    dot: "text-red-500",
  },
}

/**
 * A meeting's "YYYY-MM-DD" as "12 Sep 2026" by default. Read as a local day, so
 * no timezone moves it. Not formatShortDate, which drops the year in the current year.
 */
export function formatMeetingDate(date: string, pattern = "d MMM yyyy"): string {
  return format(new Date(`${date}T00:00:00`), pattern)
}

// "2026-09-12 10:30". An untimed verbale written on its own day sorts at the
// minute it was written: a status set that afternoon with no time is newer than
// the morning's timed call, and must win. A backdated untimed one gets
// "2026-09-12 ", a prefix of every timed key on its day, so it sorts below them.
// Sort key only, never stored; createdAt is read as local time, like isoDate.
const when = (m: Pick<Meeting, "date" | "time" | "createdAt">) =>
  `${m.date} ${m.time ?? (isoDate(m.createdAt) === m.date ? format(m.createdAt, "HH:mm") : "")}`

/** Newest first: by date, then time (untimed = when written, if that day), then createdAt. */
export function sortMeetings<M extends Pick<Meeting, "date" | "time" | "createdAt">>(meetings: M[]): M[] {
  return [...meetings].sort((a, b) => {
    const ka = when(a)
    const kb = when(b)
    if (ka !== kb) return ka < kb ? 1 : -1
    return b.createdAt.getTime() - a.createdAt.getTime()
  })
}

/**
 * Each contract's current status: its newest verbale that states a health. A
 * newer verbale with none leaves the status and its date alone, a backdated one
 * cannot override a newer assessment, and deleting the latest falls back to the
 * one before. Client-level verbali never enter. The UI chip and the MCP tools
 * all read this, so chat and screen cannot disagree.
 */
export function healthByContract(meetings: Meeting[]): Map<string, Meeting> {
  const out = new Map<string, Meeting>()
  for (const m of sortMeetings(meetings)) {
    if (m.engagementId !== null && m.health !== null && !out.has(m.engagementId)) out.set(m.engagementId, m)
  }
  return out
}

/** The first non-empty line, at most `max` characters, "…" when cut: a verbale's title. */
export function firstLine(text: string, max = 120): string {
  const line = text.split("\n").map((l) => l.trim()).find(Boolean) ?? ""
  // Array.from counts code points, so the cut never splits an emoji in half.
  const chars = Array.from(line)
  return chars.length <= max ? line : `${chars.slice(0, max - 1).join("").trimEnd()}…`
}
