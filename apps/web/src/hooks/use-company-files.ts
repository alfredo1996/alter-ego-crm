"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"

import { getBackend } from "@/lib/backend"

import type { InvoiceFile } from "@/types"

/**
 * What the slot holds until Save: the files picked (uploaded on Save), and the stored ones, by their
 * path, marked for removal. It is a change to apply to the row as it is at save time, not a list.
 */
export interface FileDraft {
  picked: File[]
  removed: string[]
}

export const NO_FILE_CHANGE: FileDraft = { picked: [], removed: [] }

export const draftChanges = (draft: FileDraft) => draft.picked.length > 0 || draft.removed.length > 0

/** The upload failed: nothing was stored and the record was not written. */
export class FileUploadError extends Error {
  constructor(fileName: string, cause: unknown) {
    super(`${fileName} could not be uploaded: ${cause instanceof Error ? cause.message : "unknown error"}.`)
    this.name = "FileUploadError"
  }
}

type FilesChange = (files: InvoiceFile[]) => InvoiceFile[]
export type ChangeFiles = (args: { target: "cost" | "invoice"; id: string; change: FilesChange }) => Promise<{ before: InvoiceFile[]; after: InvoiceFile[] }>

/** One row's files changed atomically, as the row is now; the lists refresh afterwards. */
export function useChangeFiles(userId: string | undefined): ChangeFiles {
  const queryClient = useQueryClient()
  const { mutateAsync } = useMutation({
    mutationFn: ({ target, id, change }: Parameters<ChangeFiles>[0]) => getBackend().db.changeFiles(userId!, target, id, change),
    onSuccess: (_done, { target }) => queryClient.invalidateQueries({ queryKey: [target === "cost" ? "companyExpenses" : "invoices", userId] }),
  })
  return mutateAsync
}

/**
 * Saves a record together with its invoice files, in the one order that never leaves a record
 * pointing at a missing object: upload every new file, write the record, point the row at the new
 * files and away from the removed ones, and only then delete the removed objects. A failed upload,
 * or a failed write, deletes the uploads this save already made and writes nothing more.
 *
 * A new row (no `rowId`) is written with the uploaded files. An existing row's fields are written
 * by `write` (given no files), and its files change through `changeFiles`, as the row is at save
 * time: a file another client added meanwhile is kept, and one it removed is not brought back.
 *
 * ponytail: a failed delete of a removed object is swallowed and leaves one unreferenced object;
 * a sweep of company-files no record names would clean up. A save whose `changeFiles` fails after
 * `write` succeeded has saved the fields and not the files; the error says the save failed.
 */
export async function writeWithInvoiceFiles<T>({
  userId,
  target,
  rowId,
  draft,
  changeFiles,
  write,
}: {
  userId: string
  target: "cost" | "invoice"
  rowId?: string
  draft: FileDraft
  changeFiles: ChangeFiles
  write: (files: InvoiceFile[] | undefined) => Promise<T>
}): Promise<T> {
  const files = getBackend().files
  const uploaded: InvoiceFile[] = []
  const undo = async () => void (await Promise.all(uploaded.map((f) => files.remove(f.path).catch(() => {}))))
  for (const file of draft.picked) {
    try {
      uploaded.push(await files.upload(userId, file, file.name))
    } catch (err) {
      await undo()
      throw new FileUploadError(file.name, err)
    }
  }
  let result: T
  try {
    result = await write(rowId === undefined && uploaded.length > 0 ? uploaded : undefined)
  } catch (err) {
    await undo()
    throw err
  }
  if (rowId === undefined || !draftChanges(draft)) return result
  let changed: { before: InvoiceFile[]; after: InvoiceFile[] }
  try {
    changed = await changeFiles({
      target,
      id: rowId,
      change: (list) => [...list.filter((f) => !draft.removed.includes(f.path)), ...uploaded],
    })
  } catch (err) {
    await undo()
    throw err
  }
  const kept = new Set(changed.after.map((f) => f.path))
  await Promise.all(draft.removed.filter((p) => changed.before.some((f) => f.path === p) && !kept.has(p)).map((p) => files.remove(p).catch(() => {})))
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
