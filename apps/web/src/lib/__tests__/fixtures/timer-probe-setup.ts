import { afterAll } from "vitest"

import { pendingTimerCount } from "../../../../vitest.teardown"

// Listed before vitest.setup.ts, so (hooks run in stack order) this runs after its cleanup.
afterAll(() => {
  if (pendingTimerCount() !== 0) throw new Error("a timer outlived the file")
})
