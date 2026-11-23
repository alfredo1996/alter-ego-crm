import { fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

const on = vi.hoisted(() => ({ ids: new Set<string>(), scope: null as string | null }))
vi.mock("@/modules", async () => {
  const { MODULES } = await import("@/modules/resolve")
  return { MODULES, isModuleOn: (id: string) => on.ids.has(id) }
})
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => {
    const q = new URLSearchParams(
      "client_id=c1&redirect_uri=https%3A%2F%2Fclaude.ai%2Fcb&response_type=code&code_challenge=x&code_challenge_method=S256",
    )
    if (on.scope !== null) q.set("scope", on.scope)
    return q
  },
}))
// One stable object: a fresh `user` each render would re-run the lookup effect.
const auth = vi.hoisted(() => ({ user: { id: "u1", email: "marta@nordwind.example" }, loading: false, getIdToken: vi.fn() }))
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => auth }))

import { AuthorizeConsent } from "../authorize-consent"

afterEach(() => {
  vi.unstubAllGlobals()
  on.scope = null
})

const cases: { plugins: string[]; read: string; data: string }[] = [
  { plugins: ["finance"], read: "Read your personal accounts, budgets and reports", data: "personal accounts, budgets and reports" },
  { plugins: ["consulting"], read: "Read your pipeline, clients and contracts", data: "pipeline, clients and contracts" },
  {
    plugins: ["consulting", "accounting", "rent"],
    read: "Read your pipeline, clients and contracts; invoices, costs and the cash book; tenants and leases",
    data: "pipeline, clients and contracts; invoices, costs and the cash book; tenants and leases",
  },
  {
    plugins: ["finance", "consulting", "accounting", "rent"],
    read: "Read your personal accounts, budgets and reports; pipeline, clients and contracts; invoices, costs and the cash book; tenants and leases",
    data: "personal accounts, budgets and reports; pipeline, clients and contracts; invoices, costs and the cash book; tenants and leases",
  },
  // resolveModules never yields an empty set; this is only the guard
  { plugins: [], read: "Read your Alter Ego data", data: "Alter Ego data" },
]

const stubClient = () =>
  vi.stubGlobal("fetch", async () => ({ ok: true, json: async () => ({ valid: true, clientName: "Claude" }) }))
const lines = () => screen.getAllByRole("listitem").map((li) => li.textContent)

describe("the consent scope list", () => {
  it.each(cases)("with $plugins: each line names the data, and none refers to another", async ({ plugins, read, data }) => {
    on.ids = new Set(plugins)
    stubClient()
    render(<AuthorizeConsent />)
    await screen.findByRole("button", { name: "Approve" })
    expect(lines()).toEqual([`•${read}`, `•Create, update and delete your ${data} on your behalf`])
  })

  it.each([
    ["data:write", ["data:write"]],
    ["data:read data:write", ["data:read", "data:write"]],
  ])("scope=%s: the read line comes first and once, then the write line", async (scope) => {
    on.ids = new Set(["consulting"])
    on.scope = scope
    stubClient()
    render(<AuthorizeConsent />)
    await screen.findByRole("button", { name: "Approve" })
    expect(lines()).toEqual([
      "•Read your pipeline, clients and contracts",
      "•Create, update and delete your pipeline, clients and contracts on your behalf",
    ])
  })

  it("a write-only request is still granted data:write alone, though the list shows the read line", async () => {
    on.ids = new Set(["consulting"])
    on.scope = "data:write"
    auth.getIdToken.mockResolvedValue("tok")
    const calls: { url: string; body?: string }[] = []
    vi.stubGlobal("fetch", async (url: string, init?: { body?: string }) => {
      calls.push({ url, body: init?.body })
      return url.startsWith("/api/oauth/client")
        ? { ok: true, json: async () => ({ valid: true, clientName: "Claude" }) }
        : { ok: false, json: async () => ({ error_description: "stop" }) }
    })
    render(<AuthorizeConsent />)
    fireEvent.click(await screen.findByRole("button", { name: "Approve" }))
    await screen.findByText("stop")
    const post = calls.find((c) => c.url === "/api/oauth/authorize")
    expect(JSON.parse(post!.body!).scope).toBe("data:write")
  })
})
