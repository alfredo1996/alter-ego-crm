/**
 * firestore.rules is generated from firestore/base.rules + firestore/crm.rules + the
 * modules' rules (rent, and finance's two: its users-level collections and the root categories),
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
const finance = readFileSync("../../packages/modules/finance/src/finance.rules", "utf8")
const financeRoot = readFileSync("../../packages/modules/finance/src/finance-root.rules", "utf8")
const USERS_MARKER = "      // @@CRM_COLLECTIONS@@"
const ROOT_MARKER = "    // @@ROOT_COLLECTIONS@@"
const FINANCE_VALIDATORS = [
  "isValidAccountType",
  "isValidAccountKind",
  "isValidTransactionType",
  "transferHasDestination",
  "isValidCurrency",
  "isValidBudgetPeriod",
  "isValidRolloverMode",
  "isValidRecurringFrequency",
  "isValidCategoryGroup",
]
const all = { base, crm, rent, finance, financeRoot }

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
// Finance's, spliced under users: the last four are closed schemas of their own.
const FINANCE_COLLECTIONS = ["accounts", "transactions", "budgets", "savings_goals", "recurring", "tags", "categorization_rules", "monthly_totals"]
// What every deployment keeps: the connector's credentials and its audit trail.
const SHARED_COLLECTIONS = ["api_keys", "mcp_audit"]

describe("firestore rules build", () => {
  it("matches the committed firestore.rules", () => {
    expect(buildRules(all)).toBe(readFileSync("../../firestore.rules", "utf8"))
  })

  it("refuses a base with no marker instead of silently emitting rules without the CRM", () => {
    expect(() => buildRules({ ...all, base: "rules_version = '2';" })).toThrow(/marker/)
  })

  it("refuses a base with no users marker, naming it", () => {
    expect(() => buildRules({ ...all, base: ROOT_MARKER })).toThrow("base.rules is missing the // @@CRM_COLLECTIONS@@ marker")
  })

  it("refuses a base with no root marker, naming it", () => {
    expect(() => buildRules({ ...all, base: USERS_MARKER })).toThrow("base.rules is missing the // @@ROOT_COLLECTIONS@@ marker")
  })

  it("refuses a missing or empty finance fragment instead of emitting rules without Finance", () => {
    const b = `${ROOT_MARKER}\n${USERS_MARKER}`
    expect(() => buildRules({ ...all, base: b, finance: " \n" })).toThrow("finance.rules is empty")
    expect(() => buildRules({ ...all, base: b, financeRoot: "" })).toThrow("finance-root.rules is empty")
    expect(() => buildRules({ base: b, crm, rent } as Parameters<typeof buildRules>[0])).toThrow("finance.rules is empty")
  })

  it("puts finance's two fragments at their own markers, after the company's, and nothing else moves", () => {
    expect(
      buildRules({
        base: `head\n\n${ROOT_MARKER}\n\nmid\n\n${USERS_MARKER}\n\ntail\n`,
        crm: "crm\n",
        rent: "rent\n",
        finance: "      // frag $& $1\n\n",
        financeRoot: "    // root $&\n",
      }),
    ).toBe("head\n\n    // root $&\n\nmid\n\ncrm\nrent\n\n      // frag $& $1\n\ntail\n")
  })

  it("declares finance's validators in its fragment, not in base.rules", () => {
    for (const v of FINANCE_VALIDATORS) {
      expect(finance, v).toMatch(new RegExp(`^ {6}function ${v}\\(`, "m"))
      expect(base, v).not.toContain(v)
    }
  })

  it("keeps the root categories rule in finance's root fragment, not in base.rules", () => {
    expect(base).toContain(ROOT_MARKER)
    expect(base).not.toContain("match /categories/")
    expect(financeRoot).toContain("match /categories/{categoryId}")
  })

  // String.replace reads $', $&, $` and $$ in a string replacement as patterns.
  it("inserts a fragment containing $-sequences byte for byte", () => {
    const fragment = "allow read: if 'a'.matches('a$'); // $& $$ $` $'"
    const marker = "      // @@CRM_COLLECTIONS@@"
    const out = buildRules({ base: `head\n\n${ROOT_MARKER}\n${marker}\ntail\n`, crm: `${fragment}\n`, finance: "fin\n", financeRoot: "root\n" })
    expect(out).toBe(`head\n\nroot\n${fragment}\n\nfin\ntail\n`)
  })

  it("puts a module fragment after the CRM's and leaves it out of a build with no CRM fragment", () => {
    const base = `head\n\n${ROOT_MARKER}\n\n${USERS_MARKER}\ntail\n`
    const finance = "fin\n"
    const financeRoot = "root\n"
    expect(buildRules({ base, crm: "crm\n", rent: "rent\n", finance, financeRoot })).toBe("head\n\nroot\n\ncrm\nrent\n\nfin\ntail\n")
    // Finance needs no company side, so it stays when the CRM and its modules go.
    expect(buildRules({ base, crm: null, rent: "rent\n", finance, financeRoot })).toBe("head\n\nroot\n\nfin\ntail\n")
  })

  describe("the combined build", () => {
    const out = buildRules(all)

    it("carries the shared collections, the company's and Finance's", () => {
      for (const c of [...CRM_COLLECTIONS, ...SHARED_COLLECTIONS, ...FINANCE_COLLECTIONS]) {
        expect(out, c).toContain(`match /${c}/`)
      }
    })

    it("carries Finance's users-level fragment once, after Rent's, and the root categories rule once, outside users", () => {
      expect(out.split(finance.trimEnd()).length - 1).toBe(1)
      expect(out.indexOf(finance.trimEnd())).toBeGreaterThan(out.indexOf(rent.trimEnd()))
      expect(out.split(financeRoot.trimEnd()).length - 1).toBe(1)
      expect(out.indexOf(financeRoot.trimEnd())).toBeLessThan(out.indexOf("match /users/{userId}"))
    })

    it("leaves no marker behind", () => {
      expect(out).not.toContain("@@CRM_COLLECTIONS@@")
      expect(out).not.toContain("@@ROOT_COLLECTIONS@@")
    })
  })

  describe("the build with no fragments", () => {
    const out = buildRules({ base, crm: null, finance, financeRoot })

    it("keeps every shared collection, and Finance's", () => {
      for (const c of [...SHARED_COLLECTIONS, ...FINANCE_COLLECTIONS]) expect(out, c).toContain(`match /${c}/`)
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
      expect(out).not.toContain("@@ROOT_COLLECTIONS@@")
    })
  })
})
