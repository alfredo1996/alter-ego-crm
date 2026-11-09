import { beforeEach, describe, expect, it, vi } from "vitest"

const getClient = vi.hoisted(() => vi.fn())
vi.mock("@/lib/oauth/store", () => ({ getClient }))

import { GET } from "../route"

const registered = {
  clientId: "c1",
  clientName: "Claude",
  redirectUris: ["https://claude.ai/cb", "http://127.0.0.1/cb"],
  createdAt: 0,
}

async function ask(clientId: string | null, redirectUri: string | null) {
  const url = new URL("http://localhost/api/oauth/client")
  if (clientId) url.searchParams.set("client_id", clientId)
  if (redirectUri) url.searchParams.set("redirect_uri", redirectUri)
  return (await GET(new Request(url))).json()
}

// A poisoned or legacy registration: only the route's own guard can reject these.
const poisoned = {
  clientId: "c2",
  clientName: "Poisoned",
  redirectUris: ["javascript:alert(1)//", "https://claude.ai/cb#x"],
  createdAt: 0,
}

beforeEach(() => {
  getClient.mockReset()
  getClient.mockImplementation(async (id: string) => (id === "c1" ? registered : id === "c2" ? poisoned : null))
})

describe("GET /api/oauth/client", () => {
  it.each([
    ["an unknown client", "nope", "https://claude.ai/cb"],
    ["a mismatched URI", "c1", "https://evil.example/cb"],
    ["a javascript: URI", "c1", "javascript:alert(1)//"],
    ["a fragment", "c1", "https://claude.ai/cb#x"],
    ["a missing URI", "c1", null],
    ["a missing client", null, "https://claude.ai/cb"],
  ])("is not valid for %s", async (_n, id, uri) => {
    expect(await ask(id, uri)).toEqual({ valid: false })
  })

  it.each([
    ["a registered javascript: URI", "javascript:alert(1)//"],
    ["a registered fragment", "https://claude.ai/cb#x"],
  ])("is not valid for %s", async (_n, uri) => {
    expect(await ask("c2", uri)).toEqual({ valid: false })
  })

  it.each([
    ["an over-long client_id", "c".repeat(201), "https://claude.ai/cb"],
    ["an over-long redirect_uri", "c1", "https://claude.ai/" + "a".repeat(2048)],
  ])("is not valid for %s, without a store lookup", async (_n, id, uri) => {
    expect(await ask(id, uri)).toEqual({ valid: false })
    expect(getClient).not.toHaveBeenCalled()
  })

  it("is not valid when the store fails", async () => {
    getClient.mockRejectedValue(new Error("down"))
    expect(await ask("c1", "https://claude.ai/cb")).toEqual({ valid: false })
  })

  it.each([
    ["an exact match", "https://claude.ai/cb"],
    ["a loopback port", "http://127.0.0.1:54321/cb"],
  ])("is valid for %s, with only the name", async (_n, uri) => {
    expect(await ask("c1", uri)).toEqual({ valid: true, clientName: "Claude" })
  })
})
