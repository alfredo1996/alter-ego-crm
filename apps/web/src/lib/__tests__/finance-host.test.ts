import { readFileSync } from "node:fs"

import { categorize, getBackend as hostBackend, useAuth as hostAuth } from "@alter-ego/finance/host"
import { renderHook } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { useAuth } from "@/hooks/use-auth"
import { getBackend } from "@/lib/backend"

// vitest.finance-host.setup.ts imports ./finance-host before each file, as the providers do before a page renders.
describe("the host's seam to Personal Finance", () => {
  it("hands finance the app's own backend", () => {
    expect(hostBackend()).toBe(getBackend())
  })

  it("hands finance the app's own sign-in state", () => {
    expect(renderHook(() => hostAuth()).result.current).toEqual(renderHook(() => useAuth()).result.current)
  })

  // This app has no AI adapter (AI is optional here, and absent), so nothing is ever suggested.
  it("suggests no category: there is no AI to ask", async () => {
    await expect(categorize("Corner cafe")).resolves.toBeNull()
  })

  it("is set before any page renders: the providers import it", () => {
    expect(readFileSync("src/components/providers.tsx", "utf8")).toMatch(/^import "@\/lib\/finance-host"$/m)
  })
})
