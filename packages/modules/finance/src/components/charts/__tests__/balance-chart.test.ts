import { describe, expect, it } from "vitest"

import { niceTicks } from "../balance-chart"

describe("niceTicks", () => {
  it.each([
    [788.86, 5294.48, [0, 2000, 4000, 6000]],
    [0, 450, [0, 200, 400, 600]],
    [-300, 200, [-400, -200, 0, 200]],
    [1000, 1000, [1000, 1250]],
  ])("rounds %d–%d to %j, enclosing the data", (min, max, want) => {
    const t = niceTicks(min, max)
    expect(t[0]).toBeLessThanOrEqual(min)
    expect(t.at(-1)).toBeGreaterThanOrEqual(max)
    expect(t).toEqual(want)
  })
})
