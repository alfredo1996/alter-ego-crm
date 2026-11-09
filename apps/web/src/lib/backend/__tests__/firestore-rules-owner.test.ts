/**
 * Only the owner's uid reaches the database (#389). Runs the PRODUCTION rules in a
 * project of its own (the shared one runs `testRules`, see rules-source.ts) and
 * talks to the emulator over REST with unsigned tokens, the way rules-unit-testing does.
 */
import { readFileSync } from "node:fs"

import { beforeAll, describe, expect, it } from "vitest"

import { emulatorHosts } from "./emulator-hosts"
import { loadRules, productionRules } from "./rules-source"
import { OWNER_UID } from "../../owner-uid"

const PROJECT = "demo-alter-ego-owner-only"
const STRANGER = "some-other-user-uid"
const { firestore: HOST } = emulatorHosts()
const BASE = `http://${HOST}/v1/projects/${PROJECT}/databases/(default)/documents`

const token = (uid: string) => {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url")
  return `${b64({ alg: "none", typ: "JWT" })}.${b64({ user_id: uid, sub: uid, firebase: { sign_in_provider: "custom" } })}.`
}

/** The HTTP status of one REST call as `uid` (undefined: signed out). */
async function call(method: string, path: string, uid?: string, fields?: object): Promise<number> {
  const res = await fetch(`${BASE}/${path}`, {
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

beforeAll(() => loadRules(HOST, PROJECT, productionRules()))

describe("owner-only rules", () => {
  it("lets the owner write and read its own area", async () => {
    expect(await call("PATCH", `users/${OWNER_UID}/company_accounts/a1`, OWNER_UID, account(OWNER_UID))).toBe(200)
    expect(await call("GET", `users/${OWNER_UID}/company_accounts/a1`, OWNER_UID)).toBe(200)
  })

  it.each([
    ["writes its own area", () => call("PATCH", `users/${STRANGER}/company_accounts/a1`, STRANGER, account(STRANGER))],
    ["reads its own area", () => call("GET", `users/${STRANGER}/company_accounts/a1`, STRANGER)],
    ["reads the owner's area", () => call("GET", `users/${OWNER_UID}/company_accounts/a1`, STRANGER)],
    ["writes the owner's area", () => call("PATCH", `users/${OWNER_UID}/company_accounts/a2`, STRANGER, account(OWNER_UID))],
  ])("refuses another signed-in uid that %s", async (_, run) => {
    expect(await run()).toBe(403)
  })

  it.each([
    ["reads the owner's area", () => call("GET", `users/${OWNER_UID}/company_accounts/a1`)],
    ["writes the owner's area", () => call("PATCH", `users/${OWNER_UID}/company_accounts/a2`, undefined, account(OWNER_UID))],
  ])("refuses a signed-out caller that %s", async (_, run) => {
    expect(await run()).toBe(403)
  })
})

describe("the uid literal", () => {
  it.each(["../../firestore.rules", "../../storage.rules"])("%s holds owner-uid.ts's uid", (file) => {
    expect(readFileSync(file, "utf8")).toContain(`'${OWNER_UID}'`)
  })
})
