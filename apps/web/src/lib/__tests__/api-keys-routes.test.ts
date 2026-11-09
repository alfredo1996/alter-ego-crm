import { beforeEach, describe, expect, it, vi } from "vitest"

import { DELETE } from "@/app/api/keys/[id]/route"
import { POST } from "@/app/api/keys/route"
import { __resetMockState, createMockAdapter } from "@/lib/backend/mock"
import { OWNER_UID } from "@/lib/owner-uid"

// Tokens "token-<uid>" verify to <uid>; anything else is rejected.
vi.mock("@/lib/firebase-admin-client", () => ({
  getAdminAuth: () => ({
    verifyIdToken: async (t: string) => {
      if (!t.startsWith("token-")) throw new Error("bad token")
      return { uid: t.slice(6) }
    },
  }),
}))

const req = (method: string, token?: string) =>
  new Request("http://x/api/keys", {
    method,
    headers: token ? { authorization: `Bearer ${token}` } : {},
  })
const params = (id: string) => ({ params: Promise.resolve({ id }) })

describe("/api/keys", () => {
  beforeEach(() => __resetMockState())

  it("POST without or with an invalid ID token is 401 and creates nothing", async () => {
    expect((await POST(req("POST"))).status).toBe(401)
    expect((await POST(req("POST", "garbage"))).status).toBe(401)
    expect(await createMockAdapter().db.getApiKeys(OWNER_UID)).toHaveLength(0)
  })

  it("POST for a signed-in uid that is not the owner is 403 and creates nothing", async () => {
    expect((await POST(req("POST", "token-u1"))).status).toBe(403)
    expect(await createMockAdapter().db.getApiKeys("u1")).toHaveLength(0)
  })

  it("POST creates a key for the token's user", async () => {
    const res = await POST(req("POST", `token-${OWNER_UID}`))
    const body = (await res.json()) as { key: string; id: string }
    expect(res.status).toBe(200)
    expect(body.key).toMatch(/^ak_/)
    expect((await createMockAdapter().db.getApiKeys(OWNER_UID)).map((k) => k.id)).toEqual([body.id])
  })

  it("DELETE without a valid token is 401 and revokes nothing", async () => {
    const { id } = (await (await POST(req("POST", `token-${OWNER_UID}`))).json()) as { id: string }
    expect((await DELETE(req("DELETE"), params(id))).status).toBe(401)
    expect(await createMockAdapter().db.getApiKeys(OWNER_UID)).toHaveLength(1)
  })

  it("DELETE by another user leaves the key; by its owner revokes it", async () => {
    const { id } = (await (await POST(req("POST", `token-${OWNER_UID}`))).json()) as { id: string }
    await DELETE(req("DELETE", "token-u2"), params(id))
    expect(await createMockAdapter().db.getApiKeys(OWNER_UID)).toHaveLength(1)
    expect((await DELETE(req("DELETE", `token-${OWNER_UID}`), params(id))).status).toBe(204)
    expect(await createMockAdapter().db.getApiKeys(OWNER_UID)).toHaveLength(0)
  })

  it("DELETE with a malformed id is 400, not a 500", async () => {
    for (const id of ["a/b", "..", " "]) {
      expect((await DELETE(req("DELETE", `token-${OWNER_UID}`), params(id))).status).toBe(400)
    }
  })
})
