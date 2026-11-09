import { beforeEach, describe, expect, it, vi } from "vitest"

const saveClient = vi.hoisted(() => vi.fn())
const sweepStaleClients = vi.hoisted(() => vi.fn())
vi.mock("@/lib/oauth/store", () => ({ saveClient, sweepStaleClients }))

import { resetRegisterLimit } from "@/lib/oauth/rate-limit"

import { POST } from "../route"



function register(body: unknown, headers: Record<string, string> = {}) {
  return POST(
    new Request("http://localhost/api/oauth/register", {
      method: "POST",
      headers: { "x-forwarded-for": "203.0.113.1", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    })
  )
}

const ok = { client_name: "Claude", redirect_uris: ["https://claude.ai/cb"] }

beforeEach(() => {
  saveClient.mockReset()
  sweepStaleClients.mockReset().mockResolvedValue(0)
  resetRegisterLimit()
})

describe("POST /api/oauth/register", () => {
  it("registers a valid client with unredeemedSince = createdAt and sweeps stale ones", async () => {
    const res = await register(ok)
    expect(res.status).toBe(201)
    const saved = saveClient.mock.calls[0][0]
    expect(saved.unredeemedSince).toBe(saved.createdAt)
    expect(sweepStaleClients).toHaveBeenCalledTimes(1)
  })

  it("accepts a 2048-character URI and a 100-character name", async () => {
    const uri = "https://claude.ai/" + "a".repeat(2048 - "https://claude.ai/".length)
    expect((await register({ client_name: "n".repeat(100), redirect_uris: [uri] })).status).toBe(201)
  })

  it.each([
    ["a URI over 2048 characters", { ...ok, redirect_uris: ["https://claude.ai/" + "a".repeat(2048)] }],
    ["a name over 100 characters", { ...ok, client_name: "n".repeat(101) }],
    ["11 redirect URIs", { ...ok, redirect_uris: Array(11).fill("https://claude.ai/cb") }],
  ])("rejects %s with 400 and stores nothing", async (_n, body) => {
    const res = await register(body)
    expect(res.status).toBe(400)
    expect(saveClient).not.toHaveBeenCalled()
  })

  it.each([
    ["a name over 100 characters", { ...ok, client_name: "n".repeat(101) }],
    ["a null name", { ...ok, client_name: null }],
  ])("answers %s with invalid_client_metadata", async (_n, body) => {
    const res = await register(body)
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toBe("invalid_client_metadata")
  })

  // App Hosting shape: [caller, google hop, google hop]; client-supplied entries land before the caller.
  const xff = (...e: string[]) => ({ "x-forwarded-for": e.join(", ") })

  it("shares the bucket when only Google's last hop varies, and splits it per caller", async () => {
    for (let i = 0; i < 30; i++) {
      expect((await register(ok, xff("192.0.2.44", "35.219.200.5", i % 2 ? "74.125.212.9" : "64.233.172.3"))).status).toBe(201)
    }
    expect((await register(ok, xff("192.0.2.44", "35.219.200.5", "74.125.212.1"))).status).toBe(429)
    expect((await register(ok, xff("192.0.2.45", "35.219.200.5", "74.125.212.1"))).status).toBe(201)
  })

  it("rejects an oversized body with 413 by its declared length, before reading it", async () => {
    // Request() overrides content-length from the body, so hand the route a bare request.
    const text = vi.fn()
    const req = { headers: new Headers({ "content-length": "999999" }), text } as unknown as Request
    expect((await POST(req)).status).toBe(413)
    expect(text).not.toHaveBeenCalled()
  })

  it("rejects an oversized body with 413 when no length is declared", async () => {
    const res = await register(JSON.stringify({ ...ok, padding: "x".repeat(40_000) }))
    expect(res.status).toBe(413)
  })

  it("rate-limits one IP to 30 registrations an hour, not another IP", async () => {
    for (let i = 0; i < 30; i++) expect((await register(ok)).status).toBe(201)
    const blocked = await register(ok)
    expect(blocked.status).toBe(429)
    expect(blocked.headers.get("retry-after")).not.toBeNull()
    expect((await register(ok, { "x-forwarded-for": "203.0.113.2" })).status).toBe(201)
  })
})
