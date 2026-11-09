import { beforeEach, describe, expect, it, vi } from "vitest"

import { validateApiKey } from "@/lib/api-auth"
import { authenticate, challenge, insufficientScope, unauthorized } from "@/lib/mcp/auth"
import { getToken } from "@/lib/oauth/store"

import type * as ApiAuthModule from "@/lib/api-auth"

vi.mock("@/lib/api-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof ApiAuthModule>()),
  validateApiKey: vi.fn(),
}))
vi.mock("@/lib/oauth/store", () => ({ getToken: vi.fn() }))

const mockValidateApiKey = vi.mocked(validateApiKey)
const mockGetToken = vi.mocked(getToken)

const nowSec = () => Math.floor(Date.now() / 1000)

function req(headers: Record<string, string> = {}) {
  return new Request("https://mcp.test/api/mcp", { method: "POST", headers })
}

const accessToken = (over: Partial<Awaited<ReturnType<typeof getToken>>> = {}) => ({
  type: "access" as const,
  clientId: "client-1",
  userId: "user-1",
  scopes: ["data:read" as const],
  expiresAt: nowSec() + 3600,
  ...over,
})

beforeEach(() => {
  mockValidateApiKey.mockReset()
  mockGetToken.mockReset()
  mockGetToken.mockResolvedValue(null)
  mockValidateApiKey.mockResolvedValue(null)
})

describe("challenge", () => {
  it("points at the path-inserted protected resource metadata", () => {
    expect(challenge(req())).toContain(
      'resource_metadata="https://mcp.test/.well-known/oauth-protected-resource/api/mcp"'
    )
  })

  // Without an explicit scope Claude asks for whatever discovery advertises,
  // which produces a broader consent prompt than the tools need.
  it("names the scopes to request", () => {
    expect(challenge(req())).toContain('scope="data:read data:write"')
  })

  it("honours the forwarded host, since TLS terminates upstream", () => {
    const forwarded = req({ "x-forwarded-host": "real.example.com", "x-forwarded-proto": "https" })
    expect(challenge(forwarded)).toContain('resource_metadata="https://real.example.com/')
  })
})

describe("unauthorized", () => {
  it("is a 401 — Claude ignores the challenge on a 200", async () => {
    const res = unauthorized(req())
    expect(res.status).toBe(401)
    expect(res.headers.get("WWW-Authenticate")).toContain("Bearer")
    await expect(res.json()).resolves.toMatchObject({ error: "invalid_token" })
  })

  // #157 parameterised challenge(); the 401 must not become a credential oracle.
  it("stays byte-for-byte the generic challenge", async () => {
    const res = unauthorized(req())
    expect(res.headers.get("WWW-Authenticate")).toBe(
      'Bearer error="invalid_token", error_description="Authentication required", ' +
        'resource_metadata="https://mcp.test/.well-known/oauth-protected-resource/api/mcp", ' +
        'scope="data:read data:write"'
    )
    await expect(res.json()).resolves.toEqual({
      error: "invalid_token",
      error_description: "Authentication required",
    })
  })
})

describe("insufficientScope", () => {
  const readOnly = () => insufficientScope(req(), "create_client", ["data:write"], ["data:read"])

  it("is a 403 carrying the step-up challenge", async () => {
    const res = readOnly()
    expect(res.status).toBe(403)
    expect(res.headers.get("WWW-Authenticate")).toContain('error="insufficient_scope"')
    await expect(res.json()).resolves.toMatchObject({ error: "insufficient_scope" })
  })

  // Claude does not reliably carry earlier scopes forward, so send the full set.
  it("advertises every scope, not just the missing one", () => {
    expect(readOnly().headers.get("WWW-Authenticate")).toContain('scope="data:read data:write"')
  })

  it("points at the protected resource metadata, like the 401", () => {
    expect(readOnly().headers.get("WWW-Authenticate")).toContain(
      'resource_metadata="https://mcp.test/.well-known/oauth-protected-resource/api/mcp"'
    )
  })

  // #157: the body is all a Streamable-HTTP client can show for a refused POST.
  it("says what an OAuth read-only token holds, what the tool needs, and how to get it", async () => {
    const { error_description } = (await readOnly().json()) as { error_description: string }
    expect(error_description).toBe(
      "This credential was granted: data:read. The create_client tool needs data:write. " +
        "Scopes are fixed when a credential is issued and never change afterwards: " +
        "to get data:write, reconnect the connector (re-authorize) and approve it, " +
        "or use an API key, which carries every scope (data:read data:write)."
    )
  })

  it("puts the same description in the challenge, as a single auth-param", () => {
    const header = readOnly().headers.get("WWW-Authenticate") ?? ""
    expect(header.match(/error_description=/g)).toHaveLength(1)
    expect(header).toContain('error_description="This credential was granted: data:read. ')
  })

  // A token from before the crm:* → data:* rename does hold write, under the old name.
  it("prints granted scopes unfiltered, so a pre-rename token explains itself", async () => {
    const res = insufficientScope(req(), "add_transaction", ["data:write"], ["crm:read", "crm:write"])
    const { error_description } = (await res.json()) as { error_description: string }
    expect(error_description).toContain("This credential was granted: crm:read crm:write.")
  })

  it("says none rather than an empty list", async () => {
    const { error_description } = (await insufficientScope(req(), "x", ["data:write"], []).json()) as {
      error_description: string
    }
    expect(error_description).toContain("granted: none.")
  })

  it("cannot close the quote or split the header with a stored scope", () => {
    const header =
      insufficientScope(req(), "x", ["data:write"], ['data:read"\r\nSet-Cookie: a=b\\']).headers.get(
        "WWW-Authenticate"
      ) ?? ""
    expect(header).not.toMatch(/[\r\n\\]/)
    expect(header).toContain('granted: data:readSet-Cookie: a=b. The x tool')
    expect(header.match(/"/g)).toHaveLength(8)
  })
})

describe("authenticate", () => {
  it("returns null without a bearer token", async () => {
    await expect(authenticate(req())).resolves.toBeNull()
    expect(mockGetToken).not.toHaveBeenCalled()
  })

  it("returns null for an empty bearer value", async () => {
    await expect(authenticate(req({ authorization: "Bearer " }))).resolves.toBeNull()
  })

  it("resolves an OAuth access token to its user and granted scopes", async () => {
    mockGetToken.mockResolvedValue(accessToken())
    await expect(authenticate(req({ authorization: "Bearer tok" }))).resolves.toEqual({
      userId: "user-1",
      scopes: ["data:read"],
      clientId: "client-1",
    })
  })

  it("rejects an expired access token", async () => {
    mockGetToken.mockResolvedValue(accessToken({ expiresAt: nowSec() - 1 }))
    await expect(authenticate(req({ authorization: "Bearer tok" }))).resolves.toBeNull()
  })

  // A refresh token is a bearer credential too; it must not open the resource.
  it("rejects a refresh token presented as an access token", async () => {
    mockGetToken.mockResolvedValue(accessToken({ type: "refresh" }))
    await expect(authenticate(req({ authorization: "Bearer tok" }))).resolves.toBeNull()
  })

  it("falls back to an API key, which grants every scope", async () => {
    mockValidateApiKey.mockResolvedValue("user-9")
    await expect(authenticate(req({ authorization: "Bearer ak_x" }))).resolves.toEqual({
      userId: "user-9",
      scopes: ["data:read", "data:write"],
      clientId: "api-key",
    })
  })

  it("returns null when neither credential matches", async () => {
    await expect(authenticate(req({ authorization: "Bearer nope" }))).resolves.toBeNull()
  })
})
