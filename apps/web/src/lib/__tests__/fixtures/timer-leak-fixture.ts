import { afterAll, it } from "vitest"

// Arms a timer in afterAll, like Radix Toast does on unmount, and never clears it.
afterAll(() => {
  window.setTimeout(() => {}, 60_000)
})

it("passes", () => {})
