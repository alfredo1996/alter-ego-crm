/**
 * The nav table drives both the sidebar and route access, so these assertions are
 * the contract that a module switched off actually closes the URL and not just the link.
 *
 * NEXT_PUBLIC_PLUGINS is read by env.ts at module load, so switching it
 * means resetting the module registry and re-importing rather than mocking.
 */

import { afterEach, describe, expect, it, vi } from "vitest"

import type * as NavModule from "../nav"

/**
 * The nav table is icon-agnostic and nothing here asserts on icons, but
 * lucide-react is ~3,900 modules and every test below calls vi.resetModules()
 * and re-imports the nav graph from scratch. Loading the real library that many
 * times made these the slowest tests in the suite, and under the parallel run
 * they intermittently blew the 5s default timeout.
 *
 * Any icon name resolves to the same inert component.
 */
vi.mock("lucide-react", () => {
  const Icon = () => null
  return new Proxy(
    { __esModule: true },
    {
      get: (target, name) => {
        if (name in target) return Reflect.get(target, name)
        // `then` must stay undefined: a module namespace with a callable `then`
        // looks like a thenable, and `await import()` never resolves.
        if (name === "then" || typeof name === "symbol") return undefined
        return Icon
      },
      // Vitest checks that each imported name exists on the mock before it reads
      // it, and that check does not go through `get`.
      has: (_target, name) => name !== "then" && typeof name !== "symbol",
    },
  )
})

const ORIGINAL_PLUGINS = process.env.NEXT_PUBLIC_PLUGINS

async function loadNav(plugins?: string): Promise<typeof NavModule> {
  vi.resetModules()
  if (plugins === undefined) delete process.env.NEXT_PUBLIC_PLUGINS
  else process.env.NEXT_PUBLIC_PLUGINS = plugins
  return import("../nav")
}

afterEach(() => {
  delete process.env.NEXT_PUBLIC_DISABLED_MODULES
  if (ORIGINAL_PLUGINS === undefined) delete process.env.NEXT_PUBLIC_PLUGINS
  else process.env.NEXT_PUBLIC_PLUGINS = ORIGINAL_PLUGINS
  vi.resetModules()
})

describe("the retired variable", () => {
  it("stops the app from loading when it is defined, even empty", async () => {
    process.env.NEXT_PUBLIC_DISABLED_MODULES = ""
    await expect(loadNav("consulting")).rejects.toThrow("NEXT_PUBLIC_DISABLED_MODULES is no longer read")
  })
})

describe("nav with every plugin on", () => {
  it.each([
    ["/pipeline", true],
    ["/clients", true],
    ["/clients/c1", true],
    ["/contracts", true],
    ["/solutions", true],
    ["/collaborators", true],
    ["/invoices", true],
    ["/cash-book", true],
    ["/rent", true],
    // The nav item is Month End's only gate: an undeclared route would open anywhere.
    ["/month-end", true],
    ["/tasks", true],
    ["/plan", true],
    ["/deadlines", true],
    ["/costs", true],
    ["/settings", true],
    // Routes the nav does not declare fall through to Next's 404.
    ["/does-not-exist", true],
    // A shared prefix is not a match.
    ["/clientsx", true],
  ])("isRouteEnabled(%s) === %s", async (pathname, expected) => {
    const nav = await loadNav()
    expect(nav.isRouteEnabled(pathname)).toBe(expected)
  })

  it("shows one group per plugin, in order: Consulting, Accounting, Rent", async () => {
    const nav = await loadNav()
    expect(nav.visibleNavGroups().map((g) => g.label)).toEqual(["Consulting", "Accounting", "Rent"])
  })

  it("sends blocked routes to the first consulting page", async () => {
    const nav = await loadNav()
    expect(nav.homeRoute()).toBe("/pipeline")
  })

  it("orders each group exactly", async () => {
    const nav = await loadNav()
    expect(nav.visibleNavGroups().map((g) => g.items.map((i) => i.href))).toEqual([
      ["/pipeline", "/clients", "/contracts", "/collaborators", "/solutions", "/tasks", "/plan", "/deadlines"],
      ["/invoices", "/cash-book", "/costs", "/month-end"],
      ["/rent"],
    ])
  })

  it.each([
    ["/pipeline", "Consulting"],
    ["/clients/abc", "Consulting"],
    ["/deadlines", "Consulting"],
    ["/invoices", "Accounting"],
    ["/rent", "Rent"],
    ["/month-end", "Accounting"],
    ["/settings", null],
    ["/does-not-exist", null],
    ["/clientsx", null],
  ])("groupOf(%s) === %s", async (pathname, expected) => {
    const nav = await loadNav()
    expect(nav.groupOf(pathname)).toBe(expected)
  })
})

describe("nav with plugins left out", () => {
  it("a plugin that is off has no group, and the others keep theirs", async () => {
    const nav = await loadNav("consulting,accounting")
    expect(nav.visibleNavGroups().map((g) => [g.label, g.items.map((i) => i.label)])).toEqual([
      ["Consulting", ["Pipeline", "Clients", "Contracts", "Collaborators", "Solutions", "Tasks", "Plan", "Deadlines"]],
      ["Accounting", ["Invoices", "Cash Book", "Costs", "Month End"]],
    ])
  })

  it("Consulting alone leaves one group, and groupOf does not name the others", async () => {
    const nav = await loadNav("consulting")
    expect(nav.visibleNavGroups().map((g) => g.label)).toEqual(["Consulting"])
    expect(nav.groupOf("/cash-book")).toBeNull()
    expect(nav.groupOf("/rent")).toBeNull()
  })

  it.each(["/invoices", "/invoices/i1", "/cash-book", "/costs", "/costs/c1/file", "/month-end", "/rent"])(
    "closes %s when only consulting is listed",
    async (path) => {
      const nav = await loadNav("consulting")
      expect(nav.isRouteEnabled(path)).toBe(false)
    },
  )

  it("keeps the pages of the plugins that are listed open", async () => {
    const nav = await loadNav("consulting")
    expect(["/clients", "/solutions", "/plan", "/contracts"].map((p) => nav.isRouteEnabled(p))).toEqual([true, true, true, true])
  })

  it("closes only Rent when Accounting is listed without it", async () => {
    const nav = await loadNav("consulting,accounting")
    expect(["/rent", "/invoices", "/cash-book"].map((p) => nav.isRouteEnabled(p))).toEqual([false, true, true])
  })

  it("sends a blocked route to the first page of the first group", async () => {
    const nav = await loadNav("consulting")
    expect(nav.homeRoute()).toBe("/pipeline")
  })

  it("fails to load when a plugin needs one that is not listed", async () => {
    await expect(loadNav("accounting")).rejects.toThrow("Accounting needs Consulting, but NEXT_PUBLIC_PLUGINS does not list Consulting.")
  })
})
