import type { AccountType, CategoryGroup, Currency } from "../types"

export const currencyOptions: { value: Currency; label: string }[] = [
  { value: "USD", label: "US Dollar (USD)" },
  { value: "EUR", label: "Euro (EUR)" },
  { value: "GBP", label: "British Pound (GBP)" },
  { value: "JPY", label: "Japanese Yen (JPY)" },
  { value: "CAD", label: "Canadian Dollar (CAD)" },
  { value: "AUD", label: "Australian Dollar (AUD)" },
  { value: "CHF", label: "Swiss Franc (CHF)" },
  { value: "MXN", label: "Mexican Peso (MXN)" },
  { value: "BRL", label: "Brazilian Real (BRL)" },
  { value: "ARS", label: "Argentine Peso (ARS)" },
]

/** Short currency labels for compact selectors (e.g. account forms) */
export const currencyOptionsShort: { value: Currency; label: string }[] = [
  { value: "USD", label: "USD ($)" },
  { value: "EUR", label: "EUR" },
  { value: "GBP", label: "GBP" },
  { value: "JPY", label: "JPY" },
  { value: "CAD", label: "CAD" },
  { value: "AUD", label: "AUD" },
  { value: "CHF", label: "CHF" },
  { value: "MXN", label: "MXN" },
  { value: "BRL", label: "BRL" },
  { value: "ARS", label: "ARS" },
]

export const accountTypeOptions: { value: AccountType; label: string }[] = [
  { value: "checking", label: "Checking" },
  { value: "savings", label: "Savings" },
  { value: "credit_card", label: "Credit Card" },
  { value: "cash", label: "Cash" },
  { value: "investment", label: "Investment" },
  { value: "loan", label: "Loan" },
  { value: "other", label: "Other" },
]

/** A type's label; a custom type is shown as the user wrote it. */
export function accountTypeLabel(type: string): string {
  return accountTypeOptions.find((o) => o.value === type)?.label ?? type
}

/** The Accounts page's tabs. Every type is in one: a custom type falls under Other. */
export const ACCOUNT_GROUPS = [
  { value: "bank", label: "Bank", types: ["checking", "savings"] },
  { value: "cards", label: "Cards", types: ["credit_card"] },
  { value: "cash", label: "Cash", types: ["cash"] },
  { value: "loans", label: "Loans", types: ["loan"] },
  { value: "investments", label: "Investments", types: ["investment"] },
  { value: "other", label: "Other", types: [] as string[] },
]

export function accountGroup(type: string): string {
  return ACCOUNT_GROUPS.find((g) => g.types.includes(type))?.value ?? "other"
}

/** The category groups, in the order the Categories page and the form list them. */
export const CATEGORY_GROUPS: { value: CategoryGroup; label: string }[] = [
  { value: "income", label: "Income" },
  { value: "housing", label: "Housing" },
  { value: "transportation", label: "Transportation" },
  { value: "food", label: "Food" },
  { value: "utilities", label: "Utilities" },
  { value: "healthcare", label: "Healthcare" },
  { value: "personal", label: "Personal" },
  { value: "entertainment", label: "Entertainment" },
  { value: "education", label: "Education" },
  { value: "savings", label: "Savings" },
  { value: "debt", label: "Debt" },
  { value: "other", label: "Other" },
]

export const localeOptions = [
  { value: "en-US", label: "English (US)" },
  { value: "en-GB", label: "English (UK)" },
  { value: "de-DE", label: "German" },
  { value: "fr-FR", label: "French" },
  { value: "es-ES", label: "Spanish" },
  { value: "it-IT", label: "Italian" },
  { value: "pt-BR", label: "Portuguese (Brazil)" },
  { value: "ja-JP", label: "Japanese" },
]
