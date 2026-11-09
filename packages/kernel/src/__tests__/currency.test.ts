import { describe, it, expect } from "vitest"

import { formatCurrency, parseCurrencyInput } from "../currency"

describe("formatCurrency", () => {
  it("formats USD correctly", () => {
    const result = formatCurrency(1234.56, "USD")
    expect(result).toContain("1,234.56")
  })

  it("formats zero amount", () => {
    const result = formatCurrency(0, "USD")
    expect(result).toContain("0.00")
  })

  it("formats negative amount", () => {
    const result = formatCurrency(-500, "USD")
    expect(result).toContain("500.00")
  })

  it("formats JPY without decimals", () => {
    const result = formatCurrency(1000, "JPY")
    expect(result).not.toContain(".")
  })

  it("formats EUR correctly", () => {
    const result = formatCurrency(99.99, "EUR")
    expect(result).toContain("99")
  })

  it("respects custom locale", () => {
    const result = formatCurrency(1234.56, "USD", "en-US")
    expect(result).toBe("$1,234.56")
  })
})

describe("parseCurrencyInput", () => {
  it("parses simple number", () => {
    expect(parseCurrencyInput("123.45")).toBe(123.45)
  })

  it("parses number with currency symbol", () => {
    expect(parseCurrencyInput("$123.45")).toBe(123.45)
  })

  it("parses number with commas", () => {
    expect(parseCurrencyInput("1,234.56")).toBe(1234.56)
  })

  it("returns null for empty string", () => {
    expect(parseCurrencyInput("")).toBeNull()
  })

  it("returns null for non-numeric string", () => {
    expect(parseCurrencyInput("abc")).toBeNull()
  })

  it("rounds to 2 decimal places", () => {
    expect(parseCurrencyInput("123.456")).toBe(123.46)
  })

  it("parses negative numbers", () => {
    expect(parseCurrencyInput("-50.00")).toBe(-50)
  })
})
