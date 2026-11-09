import { resolve } from "node:path"

import { describe, expect, it } from "vitest"
import { startVitest } from "vitest/node"

const web = resolve(__dirname, "../../..")

// Runs vitest on a fixture that leaks a timer, with a probe that fails the file if a timer is
// still pending after vitest.setup.ts's cleanup. Red if `afterAll(cancelWindowTimers)` is removed.
describe("vitest.setup.ts timer cleanup", () => {
  it("leaves no window timer pending at the end of a file", async () => {
    const ctx = await startVitest("test", [], {
      root: web,
      config: false,
      watch: false,
      run: true,
      reporters: [],
      environment: "happy-dom",
      include: ["src/lib/__tests__/fixtures/timer-leak-fixture.ts"],
      setupFiles: ["src/lib/__tests__/fixtures/timer-probe-setup.ts", "vitest.setup.ts"],
    })
    const file = ctx.state.getFiles()[0]
    await ctx.close()
    expect({ state: file.result?.state, errors: file.result?.errors?.map((e) => e.message) }).toEqual({
      state: "pass",
      errors: undefined,
    })
  }, 60_000)
})
