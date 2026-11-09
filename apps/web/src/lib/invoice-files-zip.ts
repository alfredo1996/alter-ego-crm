import { zipSync } from "fflate"

import { INVOICE_FILE_EXTENSION, zipName } from "@/lib/invoice-files"

import type { PeriodDocument } from "@/lib/invoice-files"
import type { InvoiceFile } from "@/types"

/**
 * The zip of a period's files: `costs/` and `invoices/`, each entry named by
 * zipName with the stored file's extension, a number added when two names meet.
 * Records without a file are left out and counted. `load` fetches one file's
 * bytes (Storage in the app), so the builder itself does no I/O of its own.
 * `extra` adds top-level entries (the accountant's package CSVs).
 * Stored, not deflated: PDFs and p7m barely compress. ponytail: all in memory;
 * the 10 MB per file cap bounds it for a month, stream if a period ever holds hundreds.
 */
export async function zipInvoiceFiles(
  docs: PeriodDocument[],
  load: (file: InvoiceFile) => Promise<Uint8Array>,
  extra: Record<string, Uint8Array> = {},
): Promise<{ bytes: Uint8Array; files: number; missing: number }> {
  const entries: Record<string, Uint8Array> = {}
  let files = 0
  const taken = new Set<string>()
  let missing = 0
  for (const doc of docs) {
    if (!doc.file) {
      missing++
      continue
    }
    const dir = doc.kind === "cost" ? "costs" : "invoices"
    const ext = INVOICE_FILE_EXTENSION[doc.file.kind]
    let path = `${dir}/${zipName(doc)}${ext}`
    for (let n = 2; taken.has(path.toLowerCase()); n++) path = `${dir}/${zipName(doc)} (${n})${ext}`
    taken.add(path.toLowerCase())
    try {
      entries[path] = await load(doc.file)
      files++
    } catch {
      // The whole zip fails, but says which record; the raw error may carry a storage path.
      throw new Error(`${path.slice(dir.length + 1)} could not be downloaded`)
    }
  }
  return { bytes: zipSync({ ...extra, ...entries }, { level: 0 }), files, missing }
}
