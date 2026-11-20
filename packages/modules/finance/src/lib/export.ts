/** UTF-8 BOM — makes Italian Excel auto-detect UTF-8 instead of mangling accented chars. */
export const CSV_BOM = "﻿"

/** A text cell starting with = + - @ (or tab/CR) would run as a formula in Excel: prefix it with '. */
function neutralizeFormula(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
}

/**
 * A text cell for either writer. Quotes on both `,` and `;`, so the cell stays one cell
 * whichever list separator the reader's Excel uses. Numbers must not come through here: "-22.00" would turn to text.
 */
export function escapeCsvValue(value: string): string {
  const safe = neutralizeFormula(value)
  if (/[,;"\r\n]/.test(safe)) return `"${safe.replace(/"/g, '""')}"`
  return safe
}

/** Saves text as a file; a CSV unless `type` says otherwise (a .txt report). */
export function downloadCsv(csvContent: string, fileName: string, type = "text/csv;charset=utf-8;"): void {
  const blob = new Blob([csvContent], { type })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  URL.revokeObjectURL(url)
}
