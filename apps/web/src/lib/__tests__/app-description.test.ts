import { describe, expect, it, vi } from "vitest"

const on = vi.hoisted(() => ({ ids: new Set<string>() }))
vi.mock("@/modules", async () => {
  const { MODULES } = await import("@/modules/resolve")
  return { MODULES, isModuleOn: (id: string) => on.ids.has(id) }
})

import { appDescription } from "../app-description"

describe("appDescription", () => {
  it.each([
    [["rent"], "Tenants and leases"],
    [["accounting", "consulting"], "Pipeline, clients and contracts; invoices, costs and the cash book"],
    [[], "Alter Ego"],
  ])("%j reads %s, in MODULES order", (ids, text) => {
    on.ids = new Set(ids)
    expect(appDescription()).toBe(text)
  })
})
