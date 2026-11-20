import { describe, it, expect } from "vitest"

import {
  isAsset,
  isLiability,
  accountKind,
  defaultKindForType,
  balanceOwing,
  netWorthTotals,
  ASSET_ACCOUNT_TYPES,
  LIABILITY_ACCOUNT_TYPES,
} from "../net-worth"

import type { AccountType } from "../../types"

// Helper: classification only depends on type + kind.
const acct = (type: AccountType, kind: "asset" | "liability" | null = null) => ({ type, kind })

describe("isAsset", () => {
  it.each(ASSET_ACCOUNT_TYPES)("returns true for built-in asset type %s", (type) => {
    expect(isAsset(acct(type))).toBe(true)
  })

  it.each(LIABILITY_ACCOUNT_TYPES)("returns false for built-in liability type %s", (type) => {
    expect(isLiability(acct(type))).toBe(true)
    expect(isAsset(acct(type))).toBe(false)
  })
})

describe("isLiability", () => {
  it.each(LIABILITY_ACCOUNT_TYPES)("returns true for %s", (type) => {
    expect(isLiability(acct(type))).toBe(true)
  })

  it.each(ASSET_ACCOUNT_TYPES)("returns false for %s", (type) => {
    expect(isLiability(acct(type))).toBe(false)
  })
})

describe("custom account types", () => {
  it("defaults an unknown custom type to asset", () => {
    expect(defaultKindForType("Crypto Wallet")).toBe("asset")
    expect(isAsset(acct("Crypto Wallet"))).toBe(true)
    expect(isLiability(acct("Crypto Wallet"))).toBe(false)
  })

  it("respects an explicit liability kind on a custom type", () => {
    expect(accountKind(acct("Personal IOU", "liability"))).toBe("liability")
    expect(isLiability(acct("Personal IOU", "liability"))).toBe(true)
    expect(isAsset(acct("Personal IOU", "liability"))).toBe(false)
  })

  it("lets an explicit kind override the built-in classification", () => {
    // A 'loan' is a liability by default, but the user can mark it an asset (e.g. money lent out).
    expect(isAsset(acct("loan", "asset"))).toBe(true)
    expect(isLiability(acct("loan", "asset"))).toBe(false)
  })

  it("falls back to type classification when kind is null", () => {
    expect(accountKind(acct("credit_card", null))).toBe("liability")
    expect(accountKind(acct("savings", null))).toBe("asset")
  })
})

describe("account type coverage", () => {
  it("every account is classified as either asset or liability", () => {
    const allTypes: AccountType[] = ["checking", "savings", "credit_card", "cash", "investment", "loan", "other", "Custom"]
    for (const type of allTypes) {
      expect(isAsset(acct(type)) !== isLiability(acct(type))).toBe(true)
    }
  })
})

describe("balanceOwing: the words come from the sign, not the kind", () => {
  const owing = (type: AccountType, balance: number, kind: "asset" | "liability" | null = null) => balanceOwing({ type, kind, balance })

  it.each([
    ["credit_card", -511.96, null, "owe"],
    ["credit_card", 40, null, "owed"], // an overpaid card: the issuer owes you
    ["loan", 350, "asset", "owed"], // money lent out
    ["loan", -350, "asset", "owe"], // a lent-out account that went negative: you owe
    ["loan", -200000, null, "owe"], // a mortgage
    ["checking", -20, null, "owe"], // an overdraft
    ["checking", 3683.84, null, null],
    ["credit_card", 0, null, null],
    ["checking", -2.78e-17, null, null], // float residue: at zero to the cent
    ["credit_card", 5.55e-17, null, null],
    ["checking", -0.01, null, "owe"],
    ["Personal IOU", 15, "liability", "owed"],
  ] as const)("%s at %d (kind %s) is %s", (type, balance, kind, want) => {
    expect(owing(type, balance, kind)).toBe(want)
  })
})

describe("netWorthTotals", () => {
  it("counts an overpaid card as an asset, not as debt", () => {
    expect(netWorthTotals([{ balance: 1000 }, { balance: 40 }])).toEqual({ totalAssets: 1040, totalLiabilities: 0, netWorth: 1040 })
  })

  it("counts an overdrawn account as a liability", () => {
    expect(netWorthTotals([{ balance: -200 }, { balance: 500 }])).toEqual({ totalAssets: 500, totalLiabilities: 200, netWorth: 300 })
  })

  it("ignores a zero balance and an empty list", () => {
    expect(netWorthTotals([{ balance: 0 }])).toEqual({ totalAssets: 0, totalLiabilities: 0, netWorth: 0 })
    expect(netWorthTotals([])).toEqual({ totalAssets: 0, totalLiabilities: 0, netWorth: 0 })
  })
})
