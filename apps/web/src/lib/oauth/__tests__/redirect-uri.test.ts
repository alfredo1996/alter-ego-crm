import { describe, expect, it } from "vitest"

import { isAllowedRedirectUri, matchesRegistered } from "@/lib/oauth/redirect-uri"

const CLAUDE = "https://claude.ai/api/mcp/auth_callback"

describe("isAllowedRedirectUri", () => {
  it("accepts https", () => {
    expect(isAllowedRedirectUri(CLAUDE)).toBe(true)
  })

  it("accepts http only on loopback", () => {
    expect(isAllowedRedirectUri("http://localhost:3118/callback")).toBe(true)
    expect(isAllowedRedirectUri("http://127.0.0.1:51234/callback")).toBe(true)
    expect(isAllowedRedirectUri("http://[::1]:8080/callback")).toBe(true)
  })

  it("rejects plain http on a public host", () => {
    expect(isAllowedRedirectUri("http://evil.example.com/callback")).toBe(false)
  })

  it("rejects non-http schemes", () => {
    expect(isAllowedRedirectUri("javascript:alert(1)")).toBe(false)
    expect(isAllowedRedirectUri("data:text/html,x")).toBe(false)
  })

  it("rejects a fragment", () => {
    expect(isAllowedRedirectUri("https://claude.ai/cb#x")).toBe(false)
  })

  it("rejects garbage", () => {
    expect(isAllowedRedirectUri("not a url")).toBe(false)
    expect(isAllowedRedirectUri("")).toBe(false)
  })
})

describe("matchesRegistered", () => {
  it("matches an identical https URI", () => {
    expect(matchesRegistered(CLAUDE, [CLAUDE])).toBe(true)
  })

  it("requires https URIs to match exactly", () => {
    expect(matchesRegistered("https://claude.ai/api/mcp/auth_callback2", [CLAUDE])).toBe(false)
    expect(matchesRegistered("https://claude.ai/api/mcp/", [CLAUDE])).toBe(false)
    expect(matchesRegistered("https://evil.example.com/cb", [CLAUDE])).toBe(false)
  })

  // The one exception RFC 8252 requires: native clients bind a port at runtime.
  it("ignores the port for loopback URIs", () => {
    expect(matchesRegistered("http://127.0.0.1:51234/callback", ["http://127.0.0.1/callback"])).toBe(
      true
    )
    expect(matchesRegistered("http://localhost:9999/callback", ["http://localhost/callback"])).toBe(
      true
    )
  })

  it("still requires the loopback path to match", () => {
    expect(matchesRegistered("http://127.0.0.1:51234/steal", ["http://127.0.0.1/callback"])).toBe(
      false
    )
  })

  it("does not let a loopback registration authorise a public host", () => {
    expect(matchesRegistered("http://evil.example.com/callback", ["http://127.0.0.1/callback"])).toBe(
      false
    )
  })

  // localhost and 127.0.0.1 are different registrations; don't silently equate them.
  it("does not equate different loopback hostnames", () => {
    expect(matchesRegistered("http://localhost:1/callback", ["http://127.0.0.1/callback"])).toBe(
      false
    )
  })

  it("is false against an empty registration list", () => {
    expect(matchesRegistered(CLAUDE, [])).toBe(false)
  })
})
