"use client"

import { getBackend } from "@/lib/backend"

import type { InvoiceFile } from "@/types"

/** What the slot holds until Save: a file picked (uploaded on Save), or the stored one marked for removal. */
export interface FileDraft {
  picked: File | null
  removed: boolean
}

export const NO_FILE_CHANGE: FileDraft = { picked: null, removed: false }

/** The upload failed: nothing was stored and the record was not written. */
export class FileUploadError extends Error {
  constructor(fileName: string, cause: unknown) {
    super(`${fileName} could not be uploaded: ${cause instanceof Error ? cause.message : "unknown error"}.`)
    this.name = "FileUploadError"
  }
}

/**
 * Saves a record together with its invoice file, in the one order that never
 * leaves a record pointing at a missing object: upload the new file, write the
 * record with it, and only then delete the old object. A failed upload writes
 * nothing; a failed write deletes the object it just uploaded.
 *
 * `write` gets the pointer to store: the new file, null to clear it, or
 * undefined to leave it as it is.
 *
 * ponytail: a failed delete of the old object is swallowed and leaves one
 * unreferenced object; a sweep of company-files no record names would clean up.
 */
export async function writeWithInvoiceFile<T>({
  userId,
  stored,
  draft,
  write,
}: {
  userId: string
  stored: InvoiceFile | null | undefined
  draft: FileDraft
  write: (file: InvoiceFile | null | undefined) => Promise<T>
}): Promise<T> {
  const files = getBackend().files
  let uploaded: InvoiceFile | null = null
  if (draft.picked) {
    try {
      uploaded = await files.upload(userId, draft.picked, draft.picked.name)
    } catch (err) {
      throw new FileUploadError(draft.picked.name, err)
    }
  }
  const next = uploaded ?? (draft.removed ? null : undefined)
  let result: T
  try {
    result = await write(next)
  } catch (err) {
    if (uploaded) await files.remove(uploaded.path).catch(() => {})
    throw err
  }
  if (stored && next !== undefined) await files.remove(stored.path).catch(() => {})
  return result
}

export async function downloadInvoiceFile(file: InvoiceFile): Promise<Blob> {
  return getBackend().files.download(file)
}

/** Saves a blob through the browser's download, under `name`. */
export function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = name
  a.click()
  // The download needs a moment to take the URL.
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

/** Saves the stored original through the browser's download. */
export async function saveInvoiceFile(file: InvoiceFile): Promise<void> {
  saveBlob(await downloadInvoiceFile(file), file.name)
}
