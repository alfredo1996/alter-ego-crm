import { describe, it, expect } from "vitest"

import { yearMonthSchema } from "../schemas"

describe("yearMonthSchema", () => {
  it.each([
    ["2026-01", true],
    ["2026-12", true],
    ["2026-00", false],
    ["2026-13", false],
    ["2026-1", false],
  ])("%s -> %s", (v, ok) => {
    expect(yearMonthSchema.safeParse(v).success).toBe(ok)
  })
})
