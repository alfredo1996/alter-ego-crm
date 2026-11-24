import { zipSync } from "fflate"

import { INVOICE_FILE_EXTENSION, zipName } from "@/lib/invoice-files"

import type { PeriodDocument } from "@/lib/invoice-files"
import type { InvoiceFile } from "@/types"

/**
 * The zip of a period's files: `costs/` and `invoices/`, each entry named by
 * zipName with the stored file's extension, a number added when two names meet.
 * Records without a file are left out and counted; a record's several files are each an entry. `load` fetches one file's
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
    if (doc.files.length === 0) {
      missing++
      continue
    }
    const dir = doc.kind === "cost" ? "costs" : "invoices"
    // A record's files read " (file i of n)" in list order; a number for a clash between records
    // goes on the record's name, before that, so the two can never be read for each other.
    const paths = (n: number) =>
      doc.files.map((f, i) => `${dir}/${zipName(doc)}${n > 1 ? ` (${n})` : ""}${doc.files.length > 1 ? ` (file ${i + 1} of ${doc.files.length})` : ""}${INVOICE_FILE_EXTENSION[f.kind]}`)
    let n = 1
    while (paths(n).some((p) => taken.has(p.toLowerCase()))) n++
    const named = paths(n)
    for (const [i, file] of doc.files.entries()) {
      taken.add(named[i].toLowerCase())
      try {
        entries[named[i]] = await load(file)
        files++
      } catch {
        // The whole zip fails, but says which file; the raw error may carry a storage path.
        throw new Error(`${named[i].slice(dir.length + 1)} could not be downloaded`)
      }
    }
  }
  return { bytes: zipSync({ ...extra, ...entries }, { level: 0 }), files, missing }
}
