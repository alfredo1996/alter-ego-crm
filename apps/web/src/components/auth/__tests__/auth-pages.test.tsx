import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const query = vi.hoisted(() => ({ value: "" }))
const signIn = vi.hoisted(() => vi.fn())
const lookup = vi.hoisted(() => vi.fn())
const assigned = vi.hoisted(() => vi.fn())
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(query.value),
}))
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ user: { id: "u1", email: "marta@nordwind.example" }, loading: false, signIn, signUp: vi.fn(), getIdToken: vi.fn() }),
}))

import { AuthShell } from "../auth-shell"
import { AuthorizeConsent } from "../authorize-consent"
import { LoginForm } from "../login-form"
import { RegisterForm } from "../register-form"

beforeEach(() => {
  lookup.mockReset()
  lookup.mockResolvedValue({ valid: true, clientName: "Claude" })
  vi.stubGlobal("fetch", async (url: string) => {
    if (String(url).startsWith("/api/oauth/client")) return { ok: true, json: async () => lookup(url) }
    throw new Error("unexpected " + url)
  })
  vi.stubGlobal("location", {
    set href(v: string) {
      assigned(v)
    },
    pathname: "/oauth/authorize",
    search: "",
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  assigned.mockReset()
  query.value = ""
})

describe("sign-in", () => {
  it("is one h1 under the brand, and says why a sign-in failed as an alert", async () => {
    signIn.mockRejectedValueOnce(new Error("Invalid email or password"))
    render(<AuthShell><LoginForm /></AuthShell>)
    expect(screen.getByRole("main")).toContainElement(screen.getByText("Alter Ego"))
    expect(screen.getAllByRole("heading", { level: 1 }).map((h) => h.textContent)).toEqual(["Sign In"])
    expect(screen.queryByRole("link", { name: "Sign up" })).toBeNull()
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "marta@nordwind.example" } })
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "password123" } })
    fireEvent.click(screen.getByRole("button", { name: "Sign In" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid email or password")
  })
})

describe("sign-up", () => {
  it("is closed: no form, and the way back to sign-in", () => {
    render(<RegisterForm />)
    expect(screen.getByRole("heading", { level: 1, name: "Sign-Up Is Closed" })).toBeInTheDocument()
    expect(screen.getByText("This app is private, so new accounts can't be created.")).toBeInTheDocument()
    expect(screen.queryByLabelText("Email")).toBeNull()
    expect(screen.queryByRole("button", { name: "Create Account" })).toBeNull()
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login")
  })
})

describe("the OAuth consent", () => {
  it("asks for approval with an h1 and both choices", async () => {
    query.value = "client_id=c1&redirect_uri=https%3A%2F%2Fclaude.ai%2Fcb&response_type=code&code_challenge=x&code_challenge_method=S256"
    render(<AuthorizeConsent />)
    await screen.findByRole("button", { name: "Approve" })
    expect(screen.getByRole("heading", { level: 1, name: "Authorize Connector" })).toBeInTheDocument()
    expect(screen.getByText("Signed in as marta@nordwind.example")).toBeInTheDocument()
    // Both products sit behind the connector, so the copy names neither.
    expect(screen.getByText(/connect to your Alter Ego data/)).toBeInTheDocument()
    expect(screen.queryByText(/CRM/)).toBeNull()
    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Deny" })).toBeInTheDocument()
  })

  it("explains a broken link as an alert, with nothing to approve", () => {
    render(<AuthorizeConsent />)
    expect(screen.getByRole("alert")).toHaveTextContent("missing client_id or redirect_uri")
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull()
  })

  const link = (uri: string) =>
    `client_id=c1&redirect_uri=${encodeURIComponent(uri)}&state=s1&response_type=code&code_challenge=x&code_challenge_method=S256`

  it.each([
    ["a javascript: URI", "javascript:alert(1)//"],
    ["an unregistered https URI", "https://evil.example/cb"],
  ])("offers neither choice and goes nowhere for %s", async (_n, uri) => {
    query.value = link(uri)
    lookup.mockResolvedValue({ valid: false })
    render(<AuthorizeConsent />)
    expect(await screen.findByRole("alert")).toHaveTextContent("This connector's return address isn't registered.")
    expect(screen.queryByRole("button", { name: "Deny" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull()
    expect(assigned).not.toHaveBeenCalled()
  })

  it("sends Deny to the registered URI with access_denied and state", async () => {
    query.value = link("https://claude.ai/cb")
    render(<AuthorizeConsent />)
    fireEvent.click(await screen.findByRole("button", { name: "Deny" }))
    await waitFor(() => expect(assigned).toHaveBeenCalledWith("https://claude.ai/cb?error=access_denied&state=s1"))
    expect(lookup).toHaveBeenCalledWith(`/api/oauth/client?client_id=c1&redirect_uri=${encodeURIComponent("https://claude.ai/cb")}`)
  })

  it("drops the verdict when the link changes, so Deny can never go to the unchecked URI", async () => {
    query.value = link("https://claude.ai/cb")
    const { rerender } = render(<AuthorizeConsent />)
    await screen.findByRole("button", { name: "Deny" })
    lookup.mockReturnValue(new Promise(() => {})) // the new pair's check never answers
    query.value = link("javascript:alert(1)//")
    rerender(<AuthorizeConsent />)
    expect(screen.queryByRole("button", { name: "Deny" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull()
    expect(assigned).not.toHaveBeenCalled()
  })

  it.each([
    ["an empty scope", "%20"],
    ["only unknown scopes", "read"],
  ])("offers nothing to approve for %s", async (_n, scope) => {
    query.value = link("https://claude.ai/cb") + `&scope=${scope}`
    render(<AuthorizeConsent />)
    expect(await screen.findByRole("alert")).toHaveTextContent("asks for no access that can be granted")
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull()
  })

  it("lists exactly the scopes that will be granted", async () => {
    query.value = link("https://claude.ai/cb") + "&scope=data%3Aread%20read"
    render(<AuthorizeConsent />)
    await screen.findByRole("button", { name: "Approve" })
    const items = screen.getAllByRole("listitem")
    expect(items).toHaveLength(1)
    expect(items[0]).toHaveTextContent(/^•Read your clients/)
  })

  it("lists both scopes when none is asked for", async () => {
    query.value = link("https://claude.ai/cb")
    render(<AuthorizeConsent />)
    await screen.findByRole("button", { name: "Approve" })
    expect(screen.getAllByRole("listitem")).toHaveLength(2)
  })
})
