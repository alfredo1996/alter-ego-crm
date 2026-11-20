import { describe, expect, it } from "vitest"

import { ACCOUNT_GROUPS, accountGroup, accountTypeLabel } from "../options"

describe("account types in words and groups", () => {
  it("names a built-in type from the one list and a custom type as written", () => {
    expect(accountTypeLabel("credit_card")).toBe("Credit Card")
    expect(accountTypeLabel("Crypto Wallet")).toBe("Crypto Wallet")
  })

  it.each([
    ["checking", "bank"],
    ["savings", "bank"],
    ["credit_card", "cards"],
    ["cash", "cash"],
    ["loan", "loans"],
    ["investment", "investments"],
    ["other", "other"],
    ["Crypto Wallet", "other"], // a custom type is never left out of every tab
  ])("puts %s under %s", (type, group) => {
    expect(accountGroup(type)).toBe(group)
    expect(ACCOUNT_GROUPS.map((g) => g.value)).toContain(group)
  })
})
