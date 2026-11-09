/**
 * firestore.rules is generated from firestore/base.rules + firestore/crm.rules + the
 * modules' rules (rent),
 * and it is the file Firebase actually deploys. These assertions are the drift
 * guard: edit a fragment without rebuilding and this fails here rather than at
 * deploy time, when the mismatch is a security change nobody reviewed.
 */
import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

import { buildRules } from "../../../../../scripts/build-firestore-rules.mjs"

const base = readFileSync("../../firestore/base.rules", "utf8")
const crm = readFileSync("../../firestore/crm.rules", "utf8")
const rent = readFileSync("../../packages/modules/rent/src/rent.rules", "utf8")

const CRM_COLLECTIONS = [
  "clients",
  "opportunities",
  "engagements",
  "tasks",
  "timecards",
  "meetings",
  "solutions",
  "invoices",
  "allocations",
  "company_expenses",
  "company_loans",
  "company_accounts",
  "company_movements",
  "company_deadlines",
  "timesheet_settings",
  "tax_regime_settings",
  "tenants",
  "leases",
]
// What every deployment keeps: the connector's credentials and its audit trail.
const SHARED_COLLECTIONS = ["api_keys", "mcp_audit"]

describe("firestore rules build", () => {
  it("matches the committed firestore.rules", () => {
    expect(buildRules({ base, crm, rent })).toBe(readFileSync("../../firestore.rules", "utf8"))
  })

  it("refuses a base with no marker instead of silently emitting rules without the CRM", () => {
    expect(() => buildRules({ base: "rules_version = '2';", crm, rent })).toThrow(/marker/)
  })

  // String.replace reads $', $&, $` and $$ in a string replacement as patterns.
  it("inserts a fragment containing $-sequences byte for byte", () => {
    const fragment = "allow read: if 'a'.matches('a$'); // $& $$ $` $'"
    const marker = "      // @@CRM_COLLECTIONS@@"
    const out = buildRules({ base: `head\n\n${marker}\ntail\n`, crm: `${fragment}\n` })
    expect(out).toBe(`head\n\n${fragment}\ntail\n`)
  })

  it("puts a module fragment after the CRM's and leaves it out of a build with no CRM fragment", () => {
    const marker = "      // @@CRM_COLLECTIONS@@"
    const base = `head\n\n${marker}\ntail\n`
    expect(buildRules({ base, crm: "crm\n", rent: "rent\n" })).toBe("head\n\ncrm\nrent\ntail\n")
    expect(buildRules({ base, crm: null, rent: "rent\n" })).toBe("head\ntail\n")
  })

  describe("the combined build", () => {
    const out = buildRules({ base, crm, rent })

    it("carries the shared collections and the company's", () => {
      for (const c of [...CRM_COLLECTIONS, ...SHARED_COLLECTIONS]) {
        expect(out, c).toContain(`match /${c}/`)
      }
    })
  })

  describe("the build with no fragments", () => {
    const out = buildRules({ base, crm: null })

    it("keeps every shared collection", () => {
      for (const c of SHARED_COLLECTIONS) expect(out, c).toContain(`match /${c}/`)
    })

    // A collection with no matching rule is denied by default, so dropping the
    // fragment removes access rather than opening it.
    it("leaks no CRM collection", () => {
      for (const c of CRM_COLLECTIONS) expect(out, c).not.toContain(`match /${c}/`)
    })

    it("is still structurally whole", () => {
      expect((out.match(/{/g) ?? []).length).toBe((out.match(/}/g) ?? []).length)
      expect(out).toMatch(/^rules_version = '2';/)
      expect(out.trimEnd().endsWith("}")).toBe(true)
    })

    it("leaves no marker behind", () => {
      expect(out).not.toContain("@@CRM_COLLECTIONS@@")
    })
  })
})
