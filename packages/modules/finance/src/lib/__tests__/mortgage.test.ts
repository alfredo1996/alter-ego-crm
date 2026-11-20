import { describe, it, expect } from "vitest"

import { encodeLoanNote, decodeLoanNote } from "../mortgage"

import type { LoanPaymentMeta } from "../mortgage"

describe("encodeLoanNote / decodeLoanNote", () => {
  it("round-trips: encode then decode returns the original object", () => {
    const meta: LoanPaymentMeta = {
      loanId: "rule-123",
      paymentNumber: 5,
      principal: 450.12,
      interest: 1573.88,
      remainingBalance: 318549.88,
    }
    const encoded = encodeLoanNote(meta)
    const decoded = decodeLoanNote(encoded)
    expect(decoded).toEqual(meta)
  })

  it("returns null for a plain-text note (not JSON loan meta)", () => {
    expect(decodeLoanNote("Just a regular note")).toBeNull()
  })

  it("returns null for null input", () => {
    expect(decodeLoanNote(null)).toBeNull()
  })
})
