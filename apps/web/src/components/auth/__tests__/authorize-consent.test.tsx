import { render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

const on = vi.hoisted(() => ({ ids: new Set<string>() }))
vi.mock("@/modules", async () => {
  const { MODULES } = await import("@/modules/resolve")
  return { MODULES, isModuleOn: (id: string) => on.ids.has(id) }
})
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () =>
    new URLSearchParams(
      "client_id=c1&redirect_uri=https%3A%2F%2Fclaude.ai%2Fcb&response_type=code&code_challenge=x&code_challenge_method=S256",
    ),
}))
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ user: { id: "u1", email: "marta@nordwind.example" }, loading: false, getIdToken: vi.fn() }),
}))

import { AuthorizeConsent } from "../authorize-consent"

afterEach(() => vi.unstubAllGlobals())

const WRITE = "Create, update and delete that same data on your behalf"
const cases: { plugins: string[]; read: string }[] = [
  { plugins: ["finance"], read: "Read your personal accounts, budgets and reports" },
  { plugins: ["consulting"], read: "Read your pipeline, clients and contracts" },
  {
    plugins: ["consulting", "accounting", "rent"],
    read: "Read your pipeline, clients and contracts; invoices, costs and the cash book; tenants and leases",
  },
  {
    plugins: ["finance", "consulting", "accounting", "rent"],
    read: "Read your personal accounts, budgets and reports; pipeline, clients and contracts; invoices, costs and the cash book; tenants and leases",
  },
  // resolveModules never yields an empty set; this is only the guard
  { plugins: [], read: "Read your Alter Ego data" },
]

describe("the consent scope list", () => {
  it.each(cases)("with $plugins: the read line names only what is on, the write line is unchanged", async ({ plugins, read }) => {
    on.ids = new Set(plugins)
    vi.stubGlobal("fetch", async () => ({ ok: true, json: async () => ({ valid: true, clientName: "Claude" }) }))
    render(<AuthorizeConsent />)
    await screen.findByRole("button", { name: "Approve" })
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual([`•${read}`, `•${WRITE}`])
  })
})
