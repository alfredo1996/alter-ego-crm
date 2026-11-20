export interface MortgageInput {
  homePrice: number      // e.g. 400000
  downPayment: number    // absolute dollars, e.g. 80000
  annualRate: number     // percent, e.g. 6.5
  termYears: number      // 10 | 15 | 20 | 30
}

export interface MortgageAmortizationRow {
  month: number
  payment: number
  principal: number
  interest: number
  balance: number
}

export interface MortgageResult {
  loanAmount: number
  monthlyPayment: number
  totalInterest: number
  totalPaid: number
  amortization: MortgageAmortizationRow[]  // full schedule (termYears * 12 entries)
}

// Formula: M = P * [r(1+r)^n] / [(1+r)^n - 1]
// 0% rate edge case: M = P / n
export function calculateMortgage(input: MortgageInput): MortgageResult {
  const loanAmount = input.homePrice - input.downPayment
  const n = input.termYears * 12
  const monthlyRate = input.annualRate / 100 / 12

  const monthlyPayment =
    monthlyRate === 0
      ? loanAmount / n
      : (loanAmount * (monthlyRate * Math.pow(1 + monthlyRate, n))) /
        (Math.pow(1 + monthlyRate, n) - 1)

  const amortization: MortgageAmortizationRow[] = []
  let balance = loanAmount

  for (let month = 1; month <= n; month++) {
    const interest = balance * monthlyRate
    const principal = monthlyPayment - interest
    balance = Math.max(0, balance - principal)
    amortization.push({
      month,
      payment: Math.round(monthlyPayment * 100) / 100,
      principal: Math.round(principal * 100) / 100,
      interest: Math.round(interest * 100) / 100,
      balance: Math.round(balance * 100) / 100,
    })
  }

  const totalPaid = monthlyPayment * n
  return {
    loanAmount: Math.round(loanAmount * 100) / 100,
    monthlyPayment: Math.round(monthlyPayment * 100) / 100,
    totalInterest: Math.round((totalPaid - loanAmount) * 100) / 100,
    totalPaid: Math.round(totalPaid * 100) / 100,
    amortization,
  }
}
