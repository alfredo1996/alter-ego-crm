import { FieldValue } from "firebase-admin/firestore"

import { getAdminFirestore } from "@/lib/firebase-admin-client"

import { isExpired, type Scope } from "./tokens"

/**
 * Firestore-backed storage for OAuth artifacts.
 *
 * Every document is keyed by the SHA-256 of its credential, so a lookup is a
 * direct `doc().get()` — no query, no composite index, and no way to enumerate
 * by prefix. Only the Admin SDK touches these collections; `firestore.rules`
 * denies client access outright.
 */

export type OAuthClient = {
  clientId: string
  clientName: string
  redirectUris: string[]
  createdAt: number
  /** ms since epoch of registration; removed when the client first redeems a code. Absent on redeemed clients and on those registered before 0.15.1, which are never swept. */
  unredeemedSince?: number
}

export type AuthCode = {
  clientId: string
  userId: string
  redirectUri: string
  scopes: Scope[]
  codeChallenge: string
  codeChallengeMethod: string
  expiresAt: number
}

export type StoredToken = {
  type: "access" | "refresh"
  clientId: string
  userId: string
  scopes: Scope[]
  expiresAt: number
  /** ms since epoch. Absent on tokens issued before 0.15.1, which skip the tokensValidAfterTime check. */
  issuedAt?: number
  /** One per consent; every rotation keeps it. Absent = the token is its own family (its hash). */
  familyId?: string
  /** A refresh token that was redeemed. Kept (not deleted) so a replay is recognised and revokes the family. Never cleaned up; no TTL policy exists. */
  used?: boolean
  /** ms since epoch of the redemption; a second presentation within the grace window is a lost race, not a replay. */
  usedAt?: number
}

const db = () => getAdminFirestore()

export async function saveClient(client: OAuthClient): Promise<void> {
  await db().collection("oauth_clients").doc(client.clientId).set(client)
}

/** A client that never redeemed a code is deleted after this long. */
export const CLIENT_TTL_MS = 30 * 24 * 60 * 60 * 1000

/** First code redemption: the client is real, so it leaves the sweep for good. */
export async function markClientRedeemed(clientId: string): Promise<void> {
  await db().collection("oauth_clients").doc(clientId).update({ unredeemedSince: FieldValue.delete() })
}

/** Lazy sweep, run on registration: deletes up to 100 clients that never redeemed a code within the TTL. */
export async function sweepStaleClients(now = Date.now(), afterQuery?: () => Promise<unknown>): Promise<number> {
  const cutoff = now - CLIENT_TTL_MS
  const snap = await db().collection("oauth_clients").where("unredeemedSince", "<", cutoff).limit(100).get()
  // Test seam: lets a test redeem a client between the query and the deletes.
  await afterQuery?.()
  // Precondition delete: a client that redeemed since the query was rewritten, so its updateTime moved and the delete fails; it stays.
  const results = await Promise.allSettled(snap.docs.map((d) => d.ref.delete({ lastUpdateTime: d.updateTime })))
  return results.filter((r) => r.status === "fulfilled").length
}

export async function getClient(clientId: string): Promise<OAuthClient | null> {
  const snap = await db().collection("oauth_clients").doc(clientId).get()
  return snap.exists ? (snap.data() as OAuthClient) : null
}

export async function saveCode(hash: string, code: AuthCode): Promise<void> {
  await db().collection("oauth_codes").doc(hash).set(code)
}

/**
 * Reads and deletes an authorization code in one transaction.
 *
 * Single-use is enforced here rather than by a "used" flag: a get-then-delete
 * pair would let two concurrent redemptions of the same code both succeed.
 */
export async function takeCode(hash: string): Promise<AuthCode | null> {
  const ref = db().collection("oauth_codes").doc(hash)
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists) return null
    tx.delete(ref)
    return snap.data() as AuthCode
  })
}

export async function saveToken(hash: string, token: StoredToken): Promise<void> {
  await db().collection("oauth_tokens").doc(hash).set(token)
}

export async function getToken(hash: string): Promise<StoredToken | null> {
  const snap = await db().collection("oauth_tokens").doc(hash).get()
  return snap.exists ? (snap.data() as StoredToken) : null
}

/**
 * Marks a refresh token redeemed, in one transaction, so of N concurrent
 * redemptions exactly one gets "ok". "reused" means it was already redeemed.
 */
export async function takeRefreshToken(
  hash: string
): Promise<{ status: "ok" | "reused"; token: StoredToken } | null> {
  const ref = db().collection("oauth_tokens").doc(hash)
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists) return null
    const token = snap.data() as StoredToken
    if (token.type !== "refresh") return null
    if (token.used) return { status: "reused", token }
    tx.update(ref, { used: true, usedAt: Date.now() })
    return { status: "ok", token }
  })
}

/** Revokes every token of one consent, spent refresh tokens included. */
export async function deleteTokenFamily(familyId: string, hash: string): Promise<void> {
  const snap = await db().collection("oauth_tokens").where("familyId", "==", familyId).get()
  await Promise.all(snap.docs.map((d) => d.ref.delete()))
  // A legacy token has no familyId field: it is its own family.
  await deleteToken(hash)
}

export async function deleteToken(hash: string): Promise<void> {
  await db().collection("oauth_tokens").doc(hash).delete()
}

/** Revokes every token issued to a user — the panic button, and the sign-out path. */
export async function deleteTokensForUser(userId: string): Promise<number> {
  const snap = await db().collection("oauth_tokens").where("userId", "==", userId).get()
  await Promise.all(snap.docs.map((d) => d.ref.delete()))
  // Count live tokens only: spent and expired ones linger in the collection.
  return snap.docs.filter((d) => {
    const t = d.data() as StoredToken
    return !t.used && !isExpired(t.expiresAt)
  }).length
}
