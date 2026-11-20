import { describe, expect, it } from "vitest"

import { resolveAccount, resolveCategory, ToolInputError } from "../helpers"

import type { Account, Category } from "../../types"

const accounts = [
  { id: "a1", name: "Bank A" },
  { id: "a2", name: "Bank B" },
  { id: "a3", name: "Bank" },
  { id: "a4", name: "Old Savings", isArchived: true },
] as Account[]
const categories = [
  { id: "c1", name: "Food" },
  { id: "c2", name: "Food Out" },
  { id: "c3", name: "Fuel" },
] as Category[]

describe("resolveAccount", () => {
  it("looks up by id before names", () => expect(resolveAccount(accounts, "a2").name).toBe("Bank B"))
  it("lets an exact name beat the prefix matches, case-insensitively", () => {
    expect(resolveAccount(accounts, " BANK ").id).toBe("a3")
  })
  it("throws on two prefix matches rather than taking the first", () => {
    const two = accounts.filter((a) => a.id !== "a3")
    expect(() => resolveAccount(two, "Bank")).toThrow(new ToolInputError('Several accounts match "Bank": Bank A, Bank B. Be more specific.'))
  })
  it("throws on two substring matches", () => {
    const two = [{ id: "1", name: "My Bank A" }, { id: "2", name: "My Bank B" }] as Account[]
    expect(() => resolveAccount(two, "bank")).toThrow('Several accounts match "bank": My Bank A, My Bank B. Be more specific.')
  })
  it("resolves an archived account by name and by id", () => {
    expect(resolveAccount(accounts, "old sav").id).toBe("a4")
    expect(resolveAccount(accounts, "a4").id).toBe("a4")
  })
  it("lists the names on a miss", () => {
    expect(() => resolveAccount(accounts, "zzz")).toThrow('No account matches "zzz". Accounts: Bank A, Bank B, Bank, Old Savings.')
  })
})

describe("resolveCategory", () => {
  it("looks up by id before names", () => expect(resolveCategory(categories, "c3").name).toBe("Fuel"))
  it("lets an exact name beat a prefix", () => expect(resolveCategory(categories, "food").id).toBe("c1"))
  it("throws on two prefix matches rather than taking the first", () => {
    expect(() => resolveCategory(categories, "Fo")).toThrow('Several categories match "Fo": Food, Food Out. Be more specific.')
  })
  it("lists the names on a miss", () => {
    expect(() => resolveCategory(categories, "zzz")).toThrow('No category matches "zzz". Categories: Food, Food Out, Fuel.')
  })
})
