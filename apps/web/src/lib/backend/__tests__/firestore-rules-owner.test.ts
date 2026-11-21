/**
 * Only the owner's uid reaches the database (#389). Runs the PRODUCTION rules in projects of
 * their own (the shared one runs `testRules`, see rules-source.ts) and talks to the emulator
 * over REST with unsigned tokens, the way rules-unit-testing does. Two states (#32): the rules as
 * committed, which carry a placeholder and admit nobody, and the rules `pnpm setup:owner` builds
 * on a temporary copy for a made-up uid.
 */
import { beforeAll, describe, expect, it } from "vitest"

import { emulatorHosts } from "./emulator-hosts"
import { rulesFor } from "./owner-copy"
import { loadRules, productionRules } from "./rules-source"

const PLACEHOLDER = "OWNER_UID_NOT_SET"
const OWNER_UID = "owner-test-uid"
const STRANGER = "some-other-user-uid"
const { firestore: HOST } = emulatorHosts()

const token = (uid: string) => {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url")
  return `${b64({ alg: "none", typ: "JWT" })}.${b64({ user_id: uid, sub: uid, firebase: { sign_in_provider: "custom" } })}.`
}

/** The HTTP status of one REST call as `uid` (undefined: signed out). */
const caller = (project: string) => async (method: string, path: string, uid?: string, fields?: object): Promise<number> => {
  const res = await fetch(`http://${HOST}/v1/projects/${project}/databases/(default)/documents/${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(uid ? { Authorization: `Bearer ${token(uid)}` } : {}) },
    body: fields ? JSON.stringify({ fields }) : undefined,
  })
  return res.status
}

const account = (userId: string) => ({
  userId: { stringValue: userId }, name: { stringValue: "Bank A" }, openingBalance: { integerValue: "0" },
  openingDate: { timestampValue: "2026-01-01T00:00:00Z" }, statementBalance: { nullValue: null },
  statementDate: { nullValue: null }, importRef: { nullValue: null },
})


describe("the rules as committed (placeholder: nobody)", () => {
  const call = caller("demo-alter-ego-placeholder")
  beforeAll(() => loadRules(HOST, "demo-alter-ego-placeholder", productionRules()))

  it.each([
    ["a random signed-in uid", STRANGER],
    ["a token whose uid is the placeholder", PLACEHOLDER],
  ])("refuses %s everywhere", async (_, uid) => {
    expect(await call("PATCH", `users/${uid}/company_accounts/a1`, uid, account(uid))).toBe(403)
    expect(await call("GET", `users/${uid}/company_accounts/a1`, uid)).toBe(403)
    expect(await call("GET", "categories/c1", uid)).toBe(403)
    expect(await call("GET", `users/${uid}/accounts/a1`, uid)).toBe(403)
  })

  it("refuses a signed-out caller", async () => {
    expect(await call("PATCH", `users/${PLACEHOLDER}/company_accounts/a2`, undefined, account(PLACEHOLDER))).toBe(403)
    expect(await call("GET", "categories/c1")).toBe(403)
  })
})

describe("the rules after setup:owner (a made-up uid)", () => {
  const call = caller("demo-alter-ego-owner-only")
  beforeAll(() => loadRules(HOST, "demo-alter-ego-owner-only", rulesFor(OWNER_UID).firestore))

  it("lets the owner write and read its own area", async () => {
    expect(await call("PATCH", `users/${OWNER_UID}/company_accounts/a1`, OWNER_UID, account(OWNER_UID))).toBe(200)
    expect(await call("GET", `users/${OWNER_UID}/company_accounts/a1`, OWNER_UID)).toBe(200)
  })

  it("lets the owner read the system categories and its Personal Finance accounts (404: allowed, none stored)", async () => {
    expect(await call("GET", "categories/c1", OWNER_UID)).toBe(404)
    expect(await call("GET", `users/${OWNER_UID}/accounts/a1`, OWNER_UID)).toBe(404)
  })

  it.each([
    ["writes its own area", () => call("PATCH", `users/${STRANGER}/company_accounts/a1`, STRANGER, account(STRANGER))],
    ["reads its own area", () => call("GET", `users/${STRANGER}/company_accounts/a1`, STRANGER)],
    ["reads the owner's area", () => call("GET", `users/${OWNER_UID}/company_accounts/a1`, STRANGER)],
    ["writes the owner's area", () => call("PATCH", `users/${OWNER_UID}/company_accounts/a2`, STRANGER, account(OWNER_UID))],
    ["reads the system categories", () => call("GET", "categories/c1", STRANGER)],
    ["reads the owner's Personal Finance accounts", () => call("GET", `users/${OWNER_UID}/accounts/a1`, STRANGER)],
  ])("refuses another signed-in uid that %s", async (_, run) => {
    expect(await run()).toBe(403)
  })

  it.each([
    ["reads the owner's area", () => call("GET", `users/${OWNER_UID}/company_accounts/a1`)],
    ["writes the owner's area", () => call("PATCH", `users/${OWNER_UID}/company_accounts/a2`, undefined, account(OWNER_UID))],
    ["reads the system categories", () => call("GET", "categories/c1")],
    ["reads the owner's Personal Finance accounts", () => call("GET", `users/${OWNER_UID}/accounts/a1`)],
  ])("refuses a signed-out caller that %s", async (_, run) => {
    expect(await run()).toBe(403)
  })
})
