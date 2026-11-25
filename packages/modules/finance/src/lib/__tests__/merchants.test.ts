import { describe, it, expect } from "vitest"

import { matchCategorizationRule, normalizeMerchant, normalizeDescription } from "../merchants"

import type { CategorizationRule } from "../../types"

describe("normalizeMerchant", () => {
  it("normalizes AMZN to Amazon", () => {
    expect(normalizeMerchant("AMZN MKTP US*1A2B3C4")).toBe("Amazon")
    expect(normalizeMerchant("AMZN Digital")).toBe("Amazon")
  })

  it("strips SQ * prefix and keeps merchant name", () => {
    expect(normalizeMerchant("SQ *BLUE BOTTLE COFFEE")).toBe("Blue Bottle Coffee")
  })

  it("strips trailing transaction IDs", () => {
    expect(normalizeMerchant("SOME STORE #12345")).toBe("Some Store")
  })

  it("strips trailing zip codes", () => {
    expect(normalizeMerchant("TARGET STORE CA 90210")).toBe("Target")
  })

  it("title-cases ALL-CAPS strings", () => {
    expect(normalizeMerchant("CORNER BAKERY CAFE")).toBe("Corner Bakery Cafe")
  })

  it("preserves short acronyms (3 chars or fewer)", () => {
    expect(normalizeMerchant("CVS")).toBe("CVS")
  })

  it("handles known merchants", () => {
    expect(normalizeMerchant("NETFLIX.COM")).toBe("Netflix")
    expect(normalizeMerchant("UBER EATS ORDER")).toBe("Uber Eats")
    expect(normalizeMerchant("PAYPAL *GITHUB")).toBe("PayPal")
    expect(normalizeMerchant("WALMART SUPERCENTER")).toBe("Walmart")
    expect(normalizeMerchant("STARBUCKS STORE 123")).toBe("Starbucks")
  })

  it("returns original for empty input", () => {
    expect(normalizeMerchant("")).toBe("")
    expect(normalizeMerchant("  ")).toBe("  ")
  })

  it("passes through unknown merchants with cleanup", () => {
    expect(normalizeMerchant("JOES PIZZA")).toBe("Joes Pizza")
  })

  it("strips trailing phone numbers", () => {
    expect(normalizeMerchant("SOME STORE 212-555-1234")).toBe("Some Store")
  })

  it("strips trailing REF numbers", () => {
    expect(normalizeMerchant("SOME STORE REF #ABC123")).toBe("Some Store")
  })

  it("strips trailing TXN numbers", () => {
    expect(normalizeMerchant("SOME STORE TXN#99887766")).toBe("Some Store")
  })

  it("strips trailing PURCHASE / POS / DEBIT / CREDIT", () => {
    expect(normalizeMerchant("CORNER STORE PURCHASE")).toBe("Corner Store")
    expect(normalizeMerchant("CORNER STORE POS")).toBe("Corner Store")
    expect(normalizeMerchant("CORNER STORE DEBIT")).toBe("Corner Store")
    expect(normalizeMerchant("CORNER STORE CREDIT")).toBe("Corner Store")
  })

  it("strips TST * prefix (Toast POS)", () => {
    expect(normalizeMerchant("TST*LOCAL TAQUERIA")).toBe("Local Taqueria")
  })

  it("normalizes newly added merchants", () => {
    expect(normalizeMerchant("PLANET FITNESS")).toBe("Planet Fitness")
    expect(normalizeMerchant("GEICO AUTO")).toBe("GEICO")
    expect(normalizeMerchant("JETBLUE AIRWAYS")).toBe("JetBlue")
    expect(normalizeMerchant("MARRIOTT HOTEL")).toBe("Marriott")
    expect(normalizeMerchant("PELOTON SUBSCRIPTION")).toBe("Peloton")
    expect(normalizeMerchant("OPENAI CHATGPT")).toBe("OpenAI")
  })
})

describe("normalizeDescription", () => {
  it("applies user displayAs rules over built-in rules", () => {
    const rules: CategorizationRule[] = [
      {
        id: "r1",
        userId: "u1",
        pattern: "AMZN",
        categoryId: "cat-1",
        displayAs: "Amazon Shopping",
        isActive: true,
        createdAt: new Date(),
      },
    ]
    expect(normalizeDescription("AMZN MKTP US*ABC", rules)).toBe("Amazon Shopping")
  })

  it("skips inactive user rules", () => {
    const rules: CategorizationRule[] = [
      {
        id: "r1",
        userId: "u1",
        pattern: "AMZN",
        categoryId: "cat-1",
        displayAs: "Amazon Shopping",
        isActive: false,
        createdAt: new Date(),
      },
    ]
    // Falls through to built-in normalization
    expect(normalizeDescription("AMZN MKTP US*ABC", rules)).toBe("Amazon")
  })

  it("falls back to built-in normalization without user rules", () => {
    expect(normalizeDescription("NETFLIX.COM 12345")).toBe("Netflix")
  })

  it("uses substring match when user pattern is invalid regex", () => {
    const rules: CategorizationRule[] = [
      {
        id: "r1",
        userId: "u1",
        pattern: "JOE'S [PIZZA",  // invalid regex
        categoryId: "cat-1",
        displayAs: "Joe's Pizza",
        isActive: true,
        createdAt: new Date(),
      },
    ]
    expect(normalizeDescription("JOE'S [PIZZA DOWNTOWN", rules)).toBe("Joe's Pizza")
  })
})

describe("matchCategorizationRule", () => {
  const makeRule = (overrides: Partial<CategorizationRule>): CategorizationRule => ({
    id: "r1",
    userId: "u1",
    pattern: "COFFEE",
    categoryId: "cat-coffee",
    displayAs: null,
    isActive: true,
    createdAt: new Date(),
    ...overrides,
  })

  it.each([
    ["a match", [makeRule({})], "COFFEE BAR 42", "cat-coffee"],
    ["no match", [makeRule({})], "BOOKSTORE", null],
    ["an inactive rule", [makeRule({ isActive: false })], "COFFEE BAR 42", null],
    ["a lower-case pattern", [makeRule({ pattern: "coffee" })], "COFFEE BAR 42", "cat-coffee"],
    ["a lower-case description", [makeRule({})], "Coffee Bar 42", "cat-coffee"],
    ["no rules", [], "COFFEE BAR 42", null],
  ])("%s", (_name, rules, description, expected) => {
    expect(matchCategorizationRule(rules, description)).toBe(expected)
  })

  it("the first matching rule wins", () => {
    const rules = [
      makeRule({ id: "r1", pattern: "COFFEE", categoryId: "cat-coffee" }),
      makeRule({ id: "r2", pattern: "BAR", categoryId: "cat-bar" }),
    ]
    expect(matchCategorizationRule(rules, "COFFEE BAR 42")).toBe("cat-coffee")
  })
})
