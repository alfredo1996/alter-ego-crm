import { describe, expect, it } from "vitest"

import { s256, verifyPkce } from "@/lib/oauth/pkce"

// The worked example from RFC 7636 Appendix B.
const RFC_VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
const RFC_CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"

describe("s256", () => {
  it("matches the RFC 7636 test vector", async () => {
    await expect(s256(RFC_VERIFIER)).resolves.toBe(RFC_CHALLENGE)
  })

  it("emits unpadded base64url", async () => {
    const out = await s256("a".repeat(43))
    expect(out).not.toMatch(/[+/=]/)
  })
})

describe("verifyPkce", () => {
  it("accepts a matching S256 verifier", async () => {
    await expect(verifyPkce(RFC_VERIFIER, RFC_CHALLENGE, "S256")).resolves.toBe(true)
  })

  it("rejects a mismatched verifier", async () => {
    await expect(verifyPkce("x".repeat(43), RFC_CHALLENGE, "S256")).resolves.toBe(false)
  })

  // OAuth 2.1 forbids plain; accepting it would make an intercepted code redeemable.
  it("rejects the plain method even when the values match", async () => {
    await expect(verifyPkce(RFC_CHALLENGE, RFC_CHALLENGE, "plain")).resolves.toBe(false)
  })

  it("rejects a missing method", async () => {
    await expect(verifyPkce(RFC_VERIFIER, RFC_CHALLENGE, undefined)).resolves.toBe(false)
  })

  it("rejects a missing verifier or challenge", async () => {
    await expect(verifyPkce(undefined, RFC_CHALLENGE, "S256")).resolves.toBe(false)
    await expect(verifyPkce(RFC_VERIFIER, undefined, "S256")).resolves.toBe(false)
  })

  it("rejects verifiers outside the 43-128 character range", async () => {
    const short = "a".repeat(42)
    const long = "a".repeat(129)
    await expect(verifyPkce(short, await s256(short), "S256")).resolves.toBe(false)
    await expect(verifyPkce(long, await s256(long), "S256")).resolves.toBe(false)
  })
})
