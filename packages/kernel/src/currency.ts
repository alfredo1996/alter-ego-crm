export type Currency = "USD" | "EUR" | "GBP" | "JPY" | "CAD" | "AUD" | "CHF" | "MXN" | "BRL" | "ARS"

const currencyConfig: Record<Currency, { locale: string; minimumFractionDigits: number }> = {
  USD: { locale: "en-US", minimumFractionDigits: 2 },
  EUR: { locale: "de-DE", minimumFractionDigits: 2 },
  GBP: { locale: "en-GB", minimumFractionDigits: 2 },
  JPY: { locale: "ja-JP", minimumFractionDigits: 0 },
  CAD: { locale: "en-CA", minimumFractionDigits: 2 },
  AUD: { locale: "en-AU", minimumFractionDigits: 2 },
  CHF: { locale: "de-CH", minimumFractionDigits: 2 },
  MXN: { locale: "es-MX", minimumFractionDigits: 2 },
  BRL: { locale: "pt-BR", minimumFractionDigits: 2 },
  ARS: { locale: "es-AR", minimumFractionDigits: 2 },
}

export function formatCurrency(
  amount: number,
  currency: Currency,
  locale?: string,
  /** 0 for a chart label: "€2,850". Default: the currency's own. */
  fractionDigits?: number
): string {
  const config = currencyConfig[currency]
  const digits = fractionDigits ?? config.minimumFractionDigits
  return new Intl.NumberFormat(locale ?? config.locale, {
    style: "currency",
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(amount)
}

/** "€4K", "€14.5K": the one short form for chart axes. English digits whatever the locale, so an axis never reads "4 Tsd. €". */
export function formatCompactCurrency(amount: number, currency: Currency): string {
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency,
    notation: "compact",
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  }).format(amount)
}

export function parseCurrencyInput(value: string): number | null {
  const cleaned = value.replace(/[^0-9.\-]/g, "")
  const parsed = parseFloat(cleaned)
  return isNaN(parsed) ? null : Math.round(parsed * 100) / 100
}

// ─── The company's euro (CRM and rent) ───────────────────────────────────────

/**
 * Whole euros, "€5,000". The company bills in one currency, so these are fixed
 * rather than driven by the user's currency setting.
 */
export const eur = new Intl.NumberFormat("en-IE", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
}).format

/** €8,000 when whole, €787.50 when not: a rate or an amendment's € in a sentence, never rounded away. */
export const eurShort = new Intl.NumberFormat("en-IE", {
  style: "currency",
  currency: "EUR",
  trailingZeroDisplay: "stripIfInteger",
}).format
