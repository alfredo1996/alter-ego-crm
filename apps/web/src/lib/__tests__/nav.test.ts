/**
 * The nav table drives both the sidebar and route access, so these assertions are
 * the contract that a module switched off actually closes the URL and not just the link.
 *
 * NEXT_PUBLIC_DISABLED_MODULES is read by env.ts at module load, so switching it
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

const ORIGINAL_DISABLED = process.env.NEXT_PUBLIC_DISABLED_MODULES

async function loadNav(disabled = ""): Promise<typeof NavModule> {
  vi.resetModules()
  process.env.NEXT_PUBLIC_DISABLED_MODULES = disabled
  return import("../nav")
}

afterEach(() => {
  if (ORIGINAL_DISABLED === undefined) delete process.env.NEXT_PUBLIC_DISABLED_MODULES
  else process.env.NEXT_PUBLIC_DISABLED_MODULES = ORIGINAL_DISABLED
  vi.resetModules()
})

describe("nav with every module on", () => {
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

  it("shows only the company group", async () => {
    const nav = await loadNav()
    expect(nav.visibleNavGroups().map((g) => g.label)).toEqual(["Company"])
  })

  it("sends blocked routes to the first company page", async () => {
    const nav = await loadNav()
    expect(nav.homeRoute()).toBe("/pipeline")
  })

  it("lists the Cash Book right after Invoices", async () => {
    const nav = await loadNav()
    const hrefs = nav.visibleNavGroups()[0].items.map((i) => i.href)
    expect(hrefs.indexOf("/cash-book")).toBe(hrefs.indexOf("/invoices") + 1)
  })

  it("lists Contracts right after Clients", async () => {
    const nav = await loadNav()
    const hrefs = nav.visibleNavGroups()[0].items.map((i) => i.href)
    expect(hrefs.indexOf("/contracts")).toBe(hrefs.indexOf("/clients") + 1)
  })

  it("lists Collaborators right after Contracts, and Solutions after them", async () => {
    const nav = await loadNav()
    const hrefs = nav.visibleNavGroups()[0].items.map((i) => i.href)
    expect(hrefs.indexOf("/collaborators")).toBe(hrefs.indexOf("/contracts") + 1)
    expect(hrefs.indexOf("/solutions")).toBe(hrefs.indexOf("/collaborators") + 1)
  })

  it("lists Rent right after the Cash Book, and Month End after Rent", async () => {
    const nav = await loadNav()
    const hrefs = nav.visibleNavGroups()[0].items.map((i) => i.href)
    expect(hrefs.indexOf("/rent")).toBe(hrefs.indexOf("/cash-book") + 1)
    expect(hrefs.indexOf("/month-end")).toBe(hrefs.indexOf("/rent") + 1)
  })
})

describe("nav with modules left out", () => {
  it("drops the sidebar entries of a disabled module and keeps the rest of Company", async () => {
    const nav = await loadNav("invoicing,solutions")
    const company = nav.visibleNavGroups().find((g) => g.label === "Company")!
    expect(company.items.map((i) => i.label)).toEqual(["Pipeline", "Clients", "Contracts", "Collaborators", "Cash Book", "Rent", "Month End", "Tasks", "Plan", "Deadlines", "Costs"])
  })

  it.each(["/invoices", "/invoices/i1", "/solutions"])("closes %s", async (path) => {
    const nav = await loadNav("invoicing,solutions")
    expect(nav.isRouteEnabled(path)).toBe(false)
  })

  it("sends a blocked route to the first page that is left", async () => {
    const nav = await loadNav("crm,invoicing,solutions")
    expect(nav.homeRoute()).toBe("/cash-book")
  })

  it("leaves the other company routes open", async () => {
    const nav = await loadNav("invoicing,solutions")
    expect(["/clients", "/cash-book", "/plan"].map((p) => nav.isRouteEnabled(p))).toEqual([true, true, true])
  })

  it("leaving the crm module out takes the Contracts entry and its route", async () => {
    const nav = await loadNav("crm,invoicing,solutions")
    expect(nav.visibleNavGroups()[0].items.map((i) => i.href)).not.toContain("/contracts")
    expect(nav.isRouteEnabled("/contracts")).toBe(false)
  })

  it("leaving Books out takes the cash book, costs and Month End with it", async () => {
    const nav = await loadNav("books,rent")
    expect(["/cash-book", "/costs", "/month-end", "/costs/c1/file"].map((p) => nav.isRouteEnabled(p))).toEqual([false, false, false, false])
  })

  it("falls back to Settings when every page is left out", async () => {
    const nav = await loadNav("crm,invoicing,solutions,books,rent")
    expect(nav.visibleNavGroups()).toEqual([])
    expect(nav.homeRoute()).toBe("/settings")
  })

  it("fails to load when a module needs one that is left out", async () => {
    await expect(loadNav("crm")).rejects.toThrow("Invoicing needs CRM, but NEXT_PUBLIC_DISABLED_MODULES leaves CRM out.")
  })
})
