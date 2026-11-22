import { describe, expect, it, vi } from "vitest"

const on = vi.hoisted(() => ({ ids: new Set<string>() }))
vi.mock("@/modules", async () => {
  const { MODULES } = await import("@/modules/resolve")
  return { MODULES, isModuleOn: (id: string) => on.ids.has(id) }
})

import manifest from "../manifest"

const cases: { plugins: string[]; shortcuts: string[]; description: string }[] = [
  { plugins: ["finance"], shortcuts: [], description: "Personal accounts, budgets and reports" },
  { plugins: ["consulting"], shortcuts: ["/pipeline"], description: "Pipeline, clients and contracts" },
  {
    plugins: ["consulting", "accounting"],
    shortcuts: ["/pipeline", "/invoices"],
    description: "Pipeline, clients and contracts; invoices, costs and the cash book",
  },
  {
    plugins: ["consulting", "accounting", "rent"],
    shortcuts: ["/pipeline", "/invoices"],
    description: "Pipeline, clients and contracts; invoices, costs and the cash book; tenants and leases",
  },
  {
    plugins: ["finance", "consulting", "accounting", "rent"],
    shortcuts: ["/pipeline", "/invoices"],
    description:
      "Personal accounts, budgets and reports; pipeline, clients and contracts; invoices, costs and the cash book; tenants and leases",
  },
]

describe("manifest", () => {
  it.each(cases)("with $plugins: shortcuts and description name only what is on", ({ plugins, shortcuts, description }) => {
    on.ids = new Set(plugins)
    const m = manifest()
    expect((m.shortcuts ?? []).map((s) => s.url)).toEqual(shortcuts)
    expect(m.description).toBe(description)
  })
})
