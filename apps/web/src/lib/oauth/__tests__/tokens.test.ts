import { describe, expect, it } from "vitest"

import { hashApiKey } from "@/lib/api-auth"
import {
  ACCESS_TTL_SECONDS,
  expiresAt,
  hasScopes,
  isExpired,
  mintToken,
  parseScopes,
  SCOPES,
} from "@/lib/oauth/tokens"

describe("mintToken", () => {
  it("returns 256 bits as 64 hex characters", async () => {
    const { value } = await mintToken()
    expect(value).toMatch(/^[0-9a-f]{64}$/)
  })

  it("returns the SHA-256 of the value as its hash", async () => {
    const { value, hash } = await mintToken()
    await expect(hashApiKey(value)).resolves.toBe(hash)
  })

  it("never repeats", async () => {
    const values = await Promise.all(Array.from({ length: 50 }, () => mintToken()))
    expect(new Set(values.map((v) => v.value)).size).toBe(50)
  })
})

describe("expiry", () => {
  it("is expressed in seconds, not milliseconds", () => {
    const now = 1_700_000_000_000
    expect(expiresAt(ACCESS_TTL_SECONDS, now)).toBe(1_700_000_000 + 3600)
  })

  it("treats the exact expiry second as expired", () => {
    const now = 1_700_000_000_000
    expect(isExpired(1_700_000_000, now)).toBe(true)
    expect(isExpired(1_700_000_001, now)).toBe(false)
  })
})

describe("parseScopes", () => {
  it("grants the defaults only when the parameter is absent", () => {
    expect(parseScopes(null)).toEqual([...SCOPES])
    expect(parseScopes(undefined)).toEqual([...SCOPES])
  })

  it.each(["", " ", "read", "openid profile"])("grants nothing for %j", (asked) => {
    expect(parseScopes(asked)).toEqual([])
  })

  it("narrows to the requested subset", () => {
    expect(parseScopes("data:read")).toEqual(["data:read"])
  })

  it("drops unknown scopes instead of failing", () => {
    expect(parseScopes("data:read openid offline_access")).toEqual(["data:read"])
  })

  it("tolerates arbitrary whitespace between scopes", () => {
    expect(parseScopes("data:read   data:write")).toEqual(["data:read", "data:write"])
  })
})

describe("hasScopes", () => {
  it("requires every listed scope", () => {
    expect(hasScopes(["data:read"], ["data:read"])).toBe(true)
    expect(hasScopes(["data:read"], ["data:write"])).toBe(false)
    expect(hasScopes(["data:read", "data:write"], ["data:read", "data:write"])).toBe(true)
  })

  it("is false for an empty grant", () => {
    expect(hasScopes([], ["data:read"])).toBe(false)
  })
})
