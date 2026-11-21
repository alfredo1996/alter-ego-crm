import { beforeEach, describe, expect, it, vi } from "vitest"

import { isOwner } from "@/lib/owner-uid"

import { POST } from "../route"

// The owner is stubbed per case: the committed uid is a placeholder that admits nobody (#32).
const OWNER_UID = "owner-test-uid"
vi.mock("@/lib/owner-uid", async (orig) => ({ ...(await orig<object>()), isOwner: vi.fn() }))

// Tokens "token-<uid>" verify to <uid>.
vi.mock("@/lib/firebase-admin-client", () => ({
  getAdminAuth: () => ({ verifyIdToken: async (t: string) => ({ uid: t.slice(6) }) }),
}))
vi.mock("@/lib/oauth/store", async (orig) => ({
  ...(await orig<object>()),
  getClient: async () => ({ redirectUris: ["https://claude.ai/cb"] }),
  saveCode: vi.fn(),
}))

const post = (scope: unknown, idToken = "t") =>
  POST(
    new Request("http://localhost/api/oauth/authorize", {
      method: "POST",
      body: JSON.stringify({
        idToken,
        clientId: "c",
        redirectUri: "https://claude.ai/cb",
        codeChallenge: "x",
        codeChallengeMethod: "S256",
        scope,
      }),
    })
  )

describe("POST /api/oauth/authorize scope", () => {
  it.each(["", " ", "read", "openid profile"])("refuses %j with invalid_scope", async (scope) => {
    const res = await post(scope)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe("invalid_scope")
  })

  it.each([false, 0, ["data:read"]])("refuses non-string scope %j with invalid_request", async (scope) => {
    const res = await post(scope)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe("invalid_request")
  })
})

describe("POST /api/oauth/authorize owner check", () => {
  beforeEach(() => {
    vi.mocked(isOwner).mockImplementation((uid) => uid === OWNER_UID)
  })

  it("refuses a signed-in uid that is not the owner with access_denied, 403", async () => {
    const res = await post("data:read", "token-someone-else")
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe("access_denied")
  })

  it("issues a code to the owner", async () => {
    const res = await post("data:read", `token-${OWNER_UID}`)
    expect(res.status).toBe(200)
    expect(typeof (await res.json()).code).toBe("string")
  })
})
