export interface LoanPaymentMeta {
  loanId: string           // recurring rule id
  paymentNumber: number    // 1-based (payment 1 of 360)
  principal: number
  interest: number
  remainingBalance: number
}

export function encodeLoanNote(meta: LoanPaymentMeta): string {
  return JSON.stringify(meta)
}

export function decodeLoanNote(notes: string | null): LoanPaymentMeta | null {
  if (!notes) return null
  try {
    const parsed = JSON.parse(notes) as unknown
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "loanId" in parsed &&
      "paymentNumber" in parsed &&
      "principal" in parsed &&
      "interest" in parsed &&
      "remainingBalance" in parsed
    ) {
      return parsed as LoanPaymentMeta
    }
    return null
  } catch {
    return null
  }
}
