/**
 * userIdOf decides whose ledger a tool call touches, and it now answers from two
 * very different places: an authenticated HTTP request, or the environment of a
 * process the client spawned. Getting the precedence wrong would read and write
 * the wrong person's money.
 */
import { afterEach, describe, expect, it, vi } from "vitest"

import { mixedNote, money, moneyIn, STDIO_USER_ID_ENV, toolError, userIdOf } from "../context"
import { ToolInputError } from "../helpers"

const ORIGINAL = process.env[STDIO_USER_ID_ENV]

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env[STDIO_USER_ID_ENV]
  else process.env[STDIO_USER_ID_ENV] = ORIGINAL
})

const withAuth = (userId: unknown) => ({ http: { authInfo: { extra: { userId } } } })

describe("userIdOf", () => {
  it("takes the authenticated subject when there is a request", () => {
    delete process.env[STDIO_USER_ID_ENV]
    expect(userIdOf(withAuth("from-oauth"))).toBe("from-oauth")
  })

  // The HTTP subject is authenticated; the env var is whatever spawned us. If
  // both are present the request must win, or a stray env var on the server would
  // redirect every authenticated call to one account.
  it("prefers the request over the environment when both are present", () => {
    process.env[STDIO_USER_ID_ENV] = "from-env"
    expect(userIdOf(withAuth("from-oauth"))).toBe("from-oauth")
  })

  it("falls back to the environment over stdio, where there is no request", () => {
    process.env[STDIO_USER_ID_ENV] = "from-env"
    expect(userIdOf({})).toBe("from-env")
  })

  it("throws rather than guessing when neither is available", () => {
    delete process.env[STDIO_USER_ID_ENV]
    expect(() => userIdOf({})).toThrow(ToolInputError)
    expect(() => userIdOf({})).toThrow(new RegExp(STDIO_USER_ID_ENV))
  })

  // An empty or non-string claim is not an identity — falling through to the env
  // is right, but silently treating "" as a user id would not be.
  it("ignores an empty or non-string claim", () => {
    process.env[STDIO_USER_ID_ENV] = "from-env"
    expect(userIdOf(withAuth(""))).toBe("from-env")
    expect(userIdOf(withAuth(42))).toBe("from-env")
  })
})

describe("toolError", () => {
  it("passes a ToolInputError message through, and hides anything else", () => {
    expect(JSON.parse(toolError(new ToolInputError("dillo così")).content[0].text).error).toBe(
      "dillo così"
    )
    vi.spyOn(console, "error").mockImplementation(() => {})
    expect(JSON.parse(toolError(new Error("connection string leaked")).content[0].text).error).toBe(
      "Internal error"
    )
  })
})

describe("money / moneyIn", () => {
  it.each([
    [12.5, "EUR", "€12.50"],
    [12.5, "USD", "$12.50"],
    [12.5, "GBP", "£12.50"],
    [0.1 + 0.2 - 0.3, "EUR", "€0.00"],
    [-(0.1 + 0.2 - 0.3), "EUR", "€0.00"],
    [-12.5, "EUR", "-€12.50"],
    [1234.567, "USD", "$1,234.57"],
  ] as const)("money(%s, %s) is %s", (amount, currency, expected) => {
    expect(money(amount, currency)).toBe(expected)
  })

  it("moneyIn uses the one currency the amount is in, and no symbol when they are mixed", () => {
    expect(moneyIn(12.5, ["USD", "USD"])).toBe("$12.50")
    expect(moneyIn(12.5, ["USD", "EUR"])).toBe("12.50")
    expect(moneyIn(6037.5, ["USD", "EUR"])).toBe("6,037.50")
    expect(moneyIn(-1234.5, ["USD", "EUR"])).toBe("-1,234.50")
    expect(moneyIn(5.551115123125783e-17, [])).toBe("0.00")
  })

  it("mixedNote names the distinct codes, sorted, only when there are several", () => {
    expect(mixedNote(["USD", "EUR", "USD"])).toBe(" Totals add EUR and USD without conversion.")
    expect(mixedNote(["EUR", "GBP", "USD"])).toBe(" Totals add EUR and GBP and USD without conversion.")
    expect(mixedNote(["EUR", "EUR"])).toBe("")
    expect(mixedNote([])).toBe("")
  })
})
