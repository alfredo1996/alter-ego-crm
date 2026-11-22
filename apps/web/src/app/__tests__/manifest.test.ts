import { describe, expect, it, vi } from "vitest"

const on = vi.hoisted(() => ({ ids: new Set<string>() }))
vi.mock("@/modules", async () => {
  const { MODULES } = await import("@/modules/resolve")
  return { MODULES, isModuleOn: (id: string) => on.ids.has(id) }
})

vi.mock("next/font/google", () => ({ Geist: () => ({ variable: "" }), Geist_Mono: () => ({ variable: "" }) }))
vi.mock("@/components/providers", () => ({ Providers: () => null }))

import { appDescription } from "@/lib/app-description"

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
  it.each(cases)(
    "with $plugins: shortcuts and description name only what is on",
    async ({ plugins, shortcuts, description }) => {
      on.ids = new Set(plugins)
      const m = manifest()
      expect((m.shortcuts ?? []).map((s) => s.url)).toEqual(shortcuts)
      expect(m.description).toBe(description)
      // the page's meta description reads the same helper (metadata is built at import)
      vi.resetModules()
      expect((await import("../layout")).metadata.description).toBe(description)
    },
  )

  it("falls back to the app name when no plugin is on", () => {
    on.ids = new Set()
    expect(appDescription()).toBe("Alter Ego")
  })
})
