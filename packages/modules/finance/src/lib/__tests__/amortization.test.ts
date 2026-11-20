import { describe, it, expect } from "vitest"

import { calculateMortgage } from "../amortization"

describe("calculateMortgage", () => {
  it("$400k home / $80k down / 6.5% / 30yr monthly payment ≈ $2024 (±$5)", () => {
    const result = calculateMortgage({
      homePrice: 400000,
      downPayment: 80000,
      annualRate: 6.5,
      termYears: 30,
    })
    expect(result.monthlyPayment).toBeGreaterThan(2019)
    expect(result.monthlyPayment).toBeLessThan(2029)
    expect(result.loanAmount).toBe(320000)
  })

  it("first payment on a high-rate loan is mostly interest", () => {
    const result = calculateMortgage({
      homePrice: 300000,
      downPayment: 0,
      annualRate: 12,
      termYears: 30,
    })
    const first = result.amortization[0]
    expect(first.interest).toBeGreaterThan(first.principal)
  })

  it("last payment is mostly principal", () => {
    const result = calculateMortgage({
      homePrice: 200000,
      downPayment: 0,
      annualRate: 6,
      termYears: 15,
    })
    const last = result.amortization[result.amortization.length - 1]
    expect(last.principal).toBeGreaterThan(last.interest)
  })

  it("0% rate divides principal evenly across all payments", () => {
    const result = calculateMortgage({
      homePrice: 120000,
      downPayment: 0,
      annualRate: 0,
      termYears: 10,
    })
    const expectedPayment = 120000 / 120
    expect(result.monthlyPayment).toBeCloseTo(expectedPayment, 1)
    expect(result.amortization[0].interest).toBe(0)
  })

  it("full amortization array length equals termYears * 12", () => {
    const result = calculateMortgage({
      homePrice: 250000,
      downPayment: 50000,
      annualRate: 5,
      termYears: 20,
    })
    expect(result.amortization.length).toBe(20 * 12)
  })
})
