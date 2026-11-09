/**
 * End-to-end OAuth 2.1 authorization-code flow, against the Firebase emulator.
 *
 * The route handlers are plain `(Request) => Response` functions, so they are
 * called directly — no HTTP server, but the same code path Claude drives, backed
 * by real Firestore and real Firebase ID-token verification.
 *
 * These assertions are the security contract: single-use codes, mandatory PKCE,
 * refresh rotation, and redirect_uri binding. Runs under vitest.emulator.ts.
 */
import { createUserWithEmailAndPassword } from "firebase/auth"
import { beforeAll, describe, expect, it } from "vitest"

import { POST as mcp } from "@/app/api/mcp/route"
import { POST as approve } from "@/app/api/oauth/authorize/route"
import { POST as disconnect } from "@/app/api/oauth/disconnect/route"
import { POST as register } from "@/app/api/oauth/register/route"
import { POST as token } from "@/app/api/oauth/token/route"
import { hashApiKey } from "@/lib/api-auth"
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin-client"
import { getFirebaseAuth } from "@/lib/firebase-client"
import { s256 } from "@/lib/oauth/pkce"
import { CLIENT_TTL_MS, getClient, markClientRedeemed, saveClient, saveCode, saveToken, sweepStaleClients } from "@/lib/oauth/store"
import { expiresAt, mintToken } from "@/lib/oauth/tokens"


const ORIGIN = "https://mcp.test"
const REDIRECT = "https://claude.ai/api/mcp/auth_callback"

let uid = ""
let idToken = ""

const VERIFIER = "a".repeat(43)
let challenge = ""

function json(path: string, body: unknown): Request {
  return new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

function form(path: string, params: Record<string, string>): Request {
  return new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  })
}

let nextIp = 0

async function newClient(redirectUris: string[] = [REDIRECT]): Promise<string> {
  // A fresh IP per call: registration is rate-limited to 10 an hour per IP.
  const req = json("/api/oauth/register", { client_name: "Test", redirect_uris: redirectUris })
  req.headers.set("x-forwarded-for", `198.51.100.${++nextIp}`)
  const res = await register(req)
  expect(res.status).toBe(201)
  return ((await res.json()) as { client_id: string }).client_id
}

async function newCode(clientId: string, overrides: Record<string, unknown> = {}): Promise<string> {
  const res = await approve(
    json("/api/oauth/authorize", {
      idToken,
      clientId,
      redirectUri: REDIRECT,
      scope: "data:read data:write",
      codeChallenge: challenge,
      codeChallengeMethod: "S256",
      ...overrides,
    })
  )
  const body = (await res.json()) as { code?: string }
  expect(body.code, `authorize failed: ${JSON.stringify(body)}`).toBeTruthy()
  return body.code!
}

async function exchange(clientId: string, code: string, verifier = VERIFIER) {
  const res = await token(
    form("/api/oauth/token", {
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
      client_id: clientId,
      redirect_uri: REDIRECT,
    })
  )
  return { status: res.status, body: (await res.json()) as Record<string, string> }
}

beforeAll(async () => {
  challenge = await s256(VERIFIER)
  const { user } = await createUserWithEmailAndPassword(
    getFirebaseAuth(),
    `oauth-${Date.now()}@example.com`,
    "Test1234!"
  )
  uid = user.uid
  idToken = await user.getIdToken()
})

describe("happy path", () => {
  it("registers, authorizes, exchanges, and reaches the MCP tool as the right user", async () => {
    const clientId = await newClient()
    const { status, body } = await exchange(clientId, await newCode(clientId))

    expect(status).toBe(200)
    expect(body.token_type).toBe("Bearer")
    expect(body.scope).toBe("data:read data:write")
    expect(Number(body.expires_in)).toBe(3600)

    const res = await mcp(
      new Request(`${ORIGIN}/api/mcp`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${body.access_token}`,
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "ping", arguments: {} },
        }),
      })
    )
    expect(res.status).toBe(200)
    // The token must resolve to the Firebase account that actually consented.
    const sse = await res.text()
    expect(sse).toContain(uid)
    // #157: ping answers "what can this credential do?" without provoking a 403.
    const rpc = JSON.parse(sse.split("\n").find((l) => l.startsWith("data: "))!.slice(6)) as {
      result: { content: [{ text: string }] }
    }
    expect(JSON.parse(rpc.result.content[0].text)).toMatchObject({ scopes: ["data:read", "data:write"] })
  })

  it("narrows the grant to the requested scope", async () => {
    const clientId = await newClient()
    const code = await newCode(clientId, { scope: "data:read" })
    const { body } = await exchange(clientId, code)
    expect(body.scope).toBe("data:read")
  })
})

describe("authorization code is single-use", () => {
  it("rejects a replayed code with invalid_grant", async () => {
    const clientId = await newClient()
    const code = await newCode(clientId)

    expect((await exchange(clientId, code)).status).toBe(200)

    const replay = await exchange(clientId, code)
    expect(replay.status).toBe(400)
    // Claude only retries on invalid_grant; any other code reads as a dead connection.
    expect(replay.body.error).toBe("invalid_grant")
  })
})

describe("PKCE is enforced", () => {
  it("rejects a wrong verifier", async () => {
    const clientId = await newClient()
    const res = await exchange(clientId, await newCode(clientId), "b".repeat(43))
    expect(res.status).toBe(400)
    expect(res.body.error).toBe("invalid_grant")
  })

  it("refuses to issue a code without a challenge", async () => {
    const clientId = await newClient()
    const res = await approve(
      json("/api/oauth/authorize", { idToken, clientId, redirectUri: REDIRECT })
    )
    expect(res.status).toBe(400)
  })

  it("refuses the plain challenge method", async () => {
    const clientId = await newClient()
    const res = await approve(
      json("/api/oauth/authorize", {
        idToken,
        clientId,
        redirectUri: REDIRECT,
        codeChallenge: challenge,
        codeChallengeMethod: "plain",
      })
    )
    expect(res.status).toBe(400)
  })
})

describe("identity and client binding", () => {
  it("rejects a forged ID token", async () => {
    const clientId = await newClient()
    const res = await approve(
      json("/api/oauth/authorize", {
        idToken: "not.a.real.token",
        clientId,
        redirectUri: REDIRECT,
        codeChallenge: challenge,
        codeChallengeMethod: "S256",
      })
    )
    expect(res.status).toBe(401)
  })

  it("rejects an unregistered client", async () => {
    const res = await approve(
      json("/api/oauth/authorize", {
        idToken,
        clientId: "00000000-0000-0000-0000-000000000000",
        redirectUri: REDIRECT,
        codeChallenge: challenge,
        codeChallengeMethod: "S256",
      })
    )
    expect(res.status).toBe(401)
  })

  // Without this check a forged authorize link delivers the code to an attacker.
  it("rejects a redirect_uri the client never registered", async () => {
    const clientId = await newClient()
    const res = await approve(
      json("/api/oauth/authorize", {
        idToken,
        clientId,
        redirectUri: "https://evil.example.com/cb",
        codeChallenge: challenge,
        codeChallengeMethod: "S256",
      })
    )
    expect(res.status).toBe(400)
  })

  it("refuses to redeem a code issued to another client", async () => {
    const clientA = await newClient()
    const clientB = await newClient()
    const res = await exchange(clientB, await newCode(clientA))
    expect(res.body.error).toBe("invalid_grant")
  })
})

describe("refresh token rotation", () => {
  it("issues a new pair and kills the old refresh token", async () => {
    const clientId = await newClient()
    const first = await exchange(clientId, await newCode(clientId))

    const refreshed = await token(
      form("/api/oauth/token", {
        grant_type: "refresh_token",
        refresh_token: first.body.refresh_token,
        client_id: clientId,
      })
    )
    const next = (await refreshed.json()) as Record<string, string>
    expect(refreshed.status).toBe(200)
    expect(next.refresh_token).not.toBe(first.body.refresh_token)
    expect(next.scope).toBe("data:read data:write")

    // OAuth 2.1 requires rotation for public clients: reuse must fail.
    const reused = await token(
      form("/api/oauth/token", {
        grant_type: "refresh_token",
        refresh_token: first.body.refresh_token,
        client_id: clientId,
      })
    )
    expect(reused.status).toBe(400)
    expect(((await reused.json()) as Record<string, string>).error).toBe("invalid_grant")
  })

  it("rejects an access token presented as a refresh token", async () => {
    const clientId = await newClient()
    const { body } = await exchange(clientId, await newCode(clientId))
    const res = await token(
      form("/api/oauth/token", { grant_type: "refresh_token", refresh_token: body.access_token })
    )
    expect(res.status).toBe(400)
  })
})

describe("MCP endpoint rejects bad credentials", () => {
  it("returns 401 with a resource_metadata and scope challenge", async () => {
    const res = await mcp(
      new Request(`${ORIGIN}/api/mcp`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      })
    )
    expect(res.status).toBe(401)
    const challengeHeader = res.headers.get("WWW-Authenticate") ?? ""
    expect(challengeHeader).toContain("/.well-known/oauth-protected-resource/api/mcp")
    expect(challengeHeader).toContain('scope="data:read data:write"')
  })

  it("returns 401 for an unknown bearer token", async () => {
    const res = await mcp(
      new Request(`${ORIGIN}/api/mcp`, {
        method: "POST",
        headers: {
          authorization: "Bearer deadbeef",
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      })
    )
    expect(res.status).toBe(401)
  })

  it("rejects an unsupported grant_type", async () => {
    const res = await token(form("/api/oauth/token", { grant_type: "client_credentials" }))
    expect(res.status).toBe(400)
    expect(((await res.json()) as Record<string, string>).error).toBe("unsupported_grant_type")
  })
})

// ---- #343: revocation, atomic rotation, scope preservation, untested checks ----

async function newUser() {
  const { user } = await createUserWithEmailAndPassword(
    getFirebaseAuth(),
    `oauth-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
    "Test1234!"
  )
  return { uid: user.uid, idToken: await user.getIdToken() }
}

/** A connector grant for one user: the token pair the exchange returned. */
async function grantFor(who: { idToken: string }, scope = "data:read data:write") {
  const clientId = await newClient()
  const res = await approve(
    json("/api/oauth/authorize", {
      idToken: who.idToken,
      clientId,
      redirectUri: REDIRECT,
      scope,
      codeChallenge: challenge,
      codeChallengeMethod: "S256",
    })
  )
  const { code } = (await res.json()) as { code: string }
  const { body } = await exchange(clientId, code)
  return { clientId, access_token: body.access_token, refresh_token: body.refresh_token }
}

function refresh(clientId: string, refreshToken: string) {
  return token(form("/api/oauth/token", { grant_type: "refresh_token", refresh_token: refreshToken, client_id: clientId }))
}

async function mcpCall(accessToken: string, name = "ping") {
  return mcp(
    new Request(`${ORIGIN}/api/mcp`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: {} } }),
    })
  )
}

describe("disconnect all connectors", () => {
  it("counts only live tokens, not spent refresh tokens", async () => {
    const me = await newUser()
    const g = await grantFor(me)
    await refresh(g.clientId, g.refresh_token) // leaves one spent refresh token behind
    const res = await disconnect(
      new Request(`${ORIGIN}/api/oauth/disconnect`, { method: "POST", headers: { authorization: `Bearer ${me.idToken}` } })
    )
    expect(((await res.json()) as { revoked: number }).revoked).toBe(3) // two access tokens and the new refresh token; the spent one is not counted
  })

  it("kills every access and refresh token of the user, and no one else's", async () => {
    const me = await newUser()
    const other = await newUser()
    const mine = await grantFor(me)
    const theirs = await grantFor(other)

    const res = await disconnect(
      new Request(`${ORIGIN}/api/oauth/disconnect`, { method: "POST", headers: { authorization: `Bearer ${me.idToken}` } })
    )
    expect(res.status).toBe(200)
    expect(((await res.json()) as { revoked: number }).revoked).toBe(2)

    expect((await mcpCall(mine.access_token)).status).toBe(401)
    const r = await refresh(mine.clientId, mine.refresh_token)
    expect(r.status).toBe(400)
    expect(((await r.json()) as Record<string, string>).error).toBe("invalid_grant")
    expect((await mcpCall(theirs.access_token)).status).toBe(200)
  })

  it("needs a verified ID token", async () => {
    const res = await disconnect(
      new Request(`${ORIGIN}/api/oauth/disconnect`, { method: "POST", headers: { authorization: "Bearer nope" } })
    )
    expect(res.status).toBe(401)
  })
})

describe("refresh checks the user", () => {
  it.each([
    ["deleted", (id: string) => getAdminAuth().deleteUser(id)],
    ["disabled", (id: string) => getAdminAuth().updateUser(id, { disabled: true })],
  ])("refuses a refresh once the user is %s", async (_, act) => {
    const u = await newUser()
    const g = await grantFor(u)
    await act(u.uid)
    const r = await refresh(g.clientId, g.refresh_token)
    expect(r.status).toBe(400)
    expect(((await r.json()) as Record<string, string>).error).toBe("invalid_grant")
  })

  it("refuses a token issued before the user's tokensValidAfterTime", async () => {
    const u = await newUser()
    const g = await grantFor(u)
    await new Promise((r) => setTimeout(r, 1100))
    await getAdminAuth().revokeRefreshTokens(u.uid)
    expect((await refresh(g.clientId, g.refresh_token)).status).toBe(400)
  })
})

/** Moves a spent refresh token's redemption past the reuse grace window. */
async function ageSpentToken(refreshToken: string) {
  await getAdminFirestore()
    .collection("oauth_tokens")
    .doc(await hashApiKey(refreshToken))
    .update({ usedAt: Date.now() - 60_000 })
}

describe("refresh rotation is atomic", () => {
  it("does not revoke the family when a spent token comes back within the grace window", async () => {
    const g = await grantFor(await newUser())
    const next = (await (await refresh(g.clientId, g.refresh_token)).json()) as Record<string, string>
    expect((await refresh(g.clientId, g.refresh_token)).status).toBe(400) // lost race, not a replay
    expect((await mcpCall(next.access_token)).status).toBe(200)
  })

  it("lets exactly one of three concurrent refreshes through", async () => {
    const g = await grantFor(await newUser())
    const results = await Promise.all([1, 2, 3].map(() => refresh(g.clientId, g.refresh_token)))
    expect(results.map((r) => r.status).sort()).toEqual([200, 400, 400])

    // The losers must not take the winner's grant down with them.
    const won = results.find((r) => r.status === 200)!
    const next = (await won.json()) as Record<string, string>
    expect((await mcpCall(next.access_token)).status).toBe(200)
    expect((await refresh(g.clientId, next.refresh_token)).status).toBe(200)
  })

  it("revokes the whole family when a rotated token is replayed", async () => {
    const g = await grantFor(await newUser())
    const next = (await (await refresh(g.clientId, g.refresh_token)).json()) as Record<string, string>
    expect((await mcpCall(next.access_token)).status).toBe(200)

    await ageSpentToken(g.refresh_token)
    expect((await refresh(g.clientId, g.refresh_token)).status).toBe(400)

    // The replay burned the descendants too: neither the new access nor refresh token works.
    expect((await mcpCall(next.access_token)).status).toBe(401)
    expect((await refresh(g.clientId, next.refresh_token)).status).toBe(400)
  })

  it("leaves other grants of the same user alone", async () => {
    const u = await newUser()
    const a = await grantFor(u)
    const b = await grantFor(u)
    await refresh(a.clientId, a.refresh_token)
    await ageSpentToken(a.refresh_token)
    await refresh(a.clientId, a.refresh_token) // replay
    expect((await refresh(b.clientId, b.refresh_token)).status).toBe(200)
  })

  it("still refreshes a token stored before families existed", async () => {
    const u = await newUser()
    const clientId = await newClient()
    const { value, hash } = await mintToken()
    await saveToken(hash, { type: "refresh", clientId, userId: u.uid, scopes: ["data:read"], expiresAt: expiresAt(600) })
    expect((await refresh(clientId, value)).status).toBe(200)
    // Replaying it revokes the family of one (itself) without throwing.
    expect((await refresh(clientId, value)).status).toBe(400)
  })
})

describe("a refreshed grant keeps its scope", () => {
  it("stays read-only: the new token gets 403 on a write tool", async () => {
    const g = await grantFor(await newUser(), "data:read")
    const r = await refresh(g.clientId, g.refresh_token)
    const next = (await r.json()) as Record<string, string>
    expect(next.scope).toBe("data:read")
    expect((await mcpCall(next.access_token, "create_client")).status).toBe(403)
  })
})

describe("checks at /token", () => {
  it("refuses an expired code", async () => {
    const clientId = await newClient()
    const { value, hash } = await mintToken()
    await saveCode(hash, {
      clientId,
      userId: uid,
      redirectUri: REDIRECT,
      scopes: ["data:read"],
      codeChallenge: challenge,
      codeChallengeMethod: "S256",
      expiresAt: expiresAt(-10),
    })
    const res = await exchange(clientId, value)
    expect(res.status).toBe(400)
    expect(res.body.error_description).toBe("Authorization code has expired")
  })

  it("refuses a redirect_uri that differs from the authorization request", async () => {
    const clientId = await newClient()
    const res = await token(
      form("/api/oauth/token", {
        grant_type: "authorization_code",
        code: await newCode(clientId),
        code_verifier: VERIFIER,
        client_id: clientId,
        redirect_uri: "https://claude.ai/other",
      })
    )
    expect(res.status).toBe(400)
    expect(((await res.json()) as Record<string, string>).error_description).toBe(
      "redirect_uri does not match the authorization request"
    )
  })

  it("refuses a refresh token presented by another client", async () => {
    const g = await grantFor(await newUser())
    const r = await refresh(await newClient(), g.refresh_token)
    expect(r.status).toBe(400)
    expect(((await r.json()) as Record<string, string>).error_description).toBe(
      "Refresh token was issued to another client"
    )
  })

  it("refuses an expired refresh token", async () => {
    const clientId = await newClient()
    const { value, hash } = await mintToken()
    await saveToken(hash, { type: "refresh", clientId, userId: uid, scopes: ["data:read"], expiresAt: expiresAt(-10) })
    const r = await refresh(clientId, value)
    expect(r.status).toBe(400)
    expect(((await r.json()) as Record<string, string>).error_description).toBe("Refresh token has expired")
  })
})

describe("never-redeemed client sweep", () => {
  const stale = Date.now() - CLIENT_TTL_MS - 1000

  it("deletes a never-redeemed client past the TTL and keeps a fresh one and a legacy one", async () => {
    const base = { clientName: "x", redirectUris: [REDIRECT] }
    await saveClient({ ...base, clientId: "sweep-stale", createdAt: stale, unredeemedSince: stale })
    await saveClient({ ...base, clientId: "sweep-fresh", createdAt: stale, unredeemedSince: Date.now() })
    await saveClient({ ...base, clientId: "sweep-legacy", createdAt: stale })
    await sweepStaleClients()
    expect(await getClient("sweep-stale")).toBeNull()
    expect(await getClient("sweep-fresh")).not.toBeNull()
    expect(await getClient("sweep-legacy")).not.toBeNull()
  })

  it("redeeming a code takes the client out of the sweep for good", async () => {
    const clientId = await newClient()
    const doc = getAdminFirestore().collection("oauth_clients").doc(clientId)
    expect((await exchange(clientId, await newCode(clientId))).status).toBe(200)
    expect((await doc.get()).data()).not.toHaveProperty("unredeemedSince")
  })

  it("keeps a client that redeems between the sweep's query and its delete", async () => {
    // Not yet stale in real time, so a parallel file's sweep ignores them; the injected `now` makes this sweep catch them.
    const unredeemedSince = Date.now() - CLIENT_TTL_MS + 60_000
    const base = { clientName: "x", redirectUris: [REDIRECT], createdAt: unredeemedSince, unredeemedSince }
    await saveClient({ ...base, clientId: "sweep-race-redeemed" })
    await saveClient({ ...base, clientId: "sweep-race-untouched" })
    const deleted = await sweepStaleClients(Date.now() + 120_000, () => markClientRedeemed("sweep-race-redeemed"))
    expect(await getClient("sweep-race-redeemed")).not.toBeNull()
    expect(await getClient("sweep-race-untouched")).toBeNull()
    expect(deleted).toBeGreaterThanOrEqual(1)
  })
})
