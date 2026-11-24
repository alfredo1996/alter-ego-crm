import { createHash } from "node:crypto"

import { getServerDb, getServerFiles } from "@/lib/backend/server-db"
import { fileIdOf, formatFileSize, INVOICE_FILE_CONTENT_TYPE, INVOICE_FILE_KIND_LABEL } from "@/lib/invoice-files"
import { toolError, userIdOf } from "@/lib/mcp/tools/context"
import { ToolInputError } from "@/lib/mcp/tools/helpers"
import { fileSummary } from "@/lib/mcp/tools/helpers"
import { z } from "@/lib/zod"
import { INVOICE_FILES_MAX } from "@/types/schemas"

import type { InvoiceFile } from "@/types"
import type { McpServer } from "@modelcontextprotocol/server"

/**
 * The invoice files of a company cost or an issued invoice over MCP: what the three tools
 * (attach_file and remove_file in crm-write.ts, get_file here) share.
 */

export const fileTargetInput = z.enum(["cost", "invoice"])

/** Names one file of a row; optional while the row holds one. */
export const fileIdInput = z.string().min(1).max(64).optional()

export const fileText = (f: InvoiceFile) => `${f.name} (${INVOICE_FILE_KIND_LABEL[f.kind]}, ${formatFileSize(f.size)})`

/** Each file with the id that names it to get_file and remove_file. */
export const fileList = (files: InvoiceFile[]) => files.map((f) => `${f.name} (fileId ${fileIdOf(f.path)})`).join(", ")

export const ownFolder = (userId: string, path: string) => path.startsWith(`users/${userId}/company-files/`)

export interface FileHolder {
  noun: "cost" | "invoice"
  /** `the cost "Rent"` or `invoice 14/2026`. */
  label: string
  files: InvoiceFile[]
}

const capitalised = (label: string) => `${label[0].toUpperCase()}${label.slice(1)}`
const aNoun = (noun: FileHolder["noun"]) => (noun === "cost" ? "a cost" : "an invoice")

/** The one cost or invoice a file call names, with the words that name it and the files it keeps. */
export async function fileHolder(userId: string, target: "cost" | "invoice", id: string): Promise<FileHolder> {
  const db = getServerDb()
  if (target === "cost") {
    const e = (await db.getCompanyExpenses(userId)).find((x) => x.id === id)
    if (!e) throw new ToolInputError(`No cost with id "${id}". get_cash_book lists each cost's id; an invoice's file goes with target: "invoice".`)
    if (e.isRecurring) {
      throw new ToolInputError(`"${e.description}" is a recurring estimate, not a document: attach the file to the cost that pays it.`)
    }
    return { noun: "cost", label: `the cost "${e.description}"`, files: e.files }
  }
  const i = (await db.getInvoices(userId)).find((x) => x.id === id)
  if (!i) throw new ToolInputError(`No invoice with id "${id}". list_invoices lists each invoice's id; a cost's file goes with target: "cost".`)
  return { noun: "invoice", label: `invoice ${i.number}`, files: i.files }
}

/** The file a get_file or remove_file call names: its fileId, or the only one the row holds. */
export function pickFile(holder: FileHolder, fileId?: string): InvoiceFile {
  const Label = capitalised(holder.label)
  if (holder.files.length === 0) throw new ToolInputError(`${Label} has no file.`)
  if (fileId !== undefined) {
    const f = holder.files.find((x) => fileIdOf(x.path) === fileId)
    if (!f) throw new ToolInputError(`${Label} has no file with fileId "${fileId}". It holds: ${fileList(holder.files)}.`)
    return f
  }
  if (holder.files.length > 1) throw new ToolInputError(`${Label} holds ${holder.files.length} files: ${fileList(holder.files)}. Pass fileId to pick one.`)
  return holder.files[0]
}

const replaceRefusal = (holder: FileHolder) =>
  `replace: true swaps the only file of a row, and ${holder.label} holds ${holder.files.length}: ${fileList(holder.files)}. ` +
  "To change one of them, remove it with remove_file and its fileId, then attach the new one."

/** What a link or a call that adds a file to this row is refused for before anything is stored, or null. */
export function refuseBeforeAdding(holder: FileHolder, replace: boolean, tail: string): string | null {
  if (replace && holder.files.length >= 2) return replaceRefusal(holder)
  if (!replace && holder.files.length >= INVOICE_FILES_MAX) {
    return `${capitalised(holder.label)} already holds ${INVOICE_FILES_MAX} files, the most ${aNoun(holder.noun)} can hold. ${tail}`
  }
  return null
}

/** A file with the same name and size already on the row: taken as a retry, not a new document. */
export const duplicateOf = (files: InvoiceFile[], f: { name: string; size: number }) => files.find((x) => x.name === f.name && x.size === f.size)

/**
 * The atomic change that adds `stored` to a row, with the same refusals as before the upload, read again on the row
 * as it is now. `discarded` is the words of complete_upload, whose object goes with the refusal. It must stay pure:
 * a transaction may run it twice.
 */
export function addFile(holder: Omit<FileHolder, "files">, stored: InvoiceFile, replace: boolean, discarded: boolean) {
  return (files: InvoiceFile[]): InvoiceFile[] => {
    const now: FileHolder = { ...holder, files }
    const Label = capitalised(holder.label)
    const end = discarded ? "Nothing was attached and the upload was discarded" : "Nothing was attached"
    if (replace && files.length >= 2) {
      throw new ToolInputError(
        discarded
          ? `${Label} now holds ${files.length} files, so replace: true cannot pick one. ${end}; remove the wrong file with remove_file, then start again without replace.`
          : replaceRefusal(now),
      )
    }
    if (replace) return [stored]
    const same = duplicateOf(files, stored)
    if (same) throw new ToolInputError(`${Label} already holds ${fileText(same)}. ${end}.`)
    if (files.length >= INVOICE_FILES_MAX) {
      throw new ToolInputError(`${Label} already holds ${INVOICE_FILES_MAX} files, the most ${aNoun(holder.noun)} can hold. ${end}; remove one with remove_file first.`)
    }
    return [...files, stored]
  }
}

/** The reply's one line after a file was added or swapped, from the row's files before and after. */
export function addedSummary(holder: Pick<FileHolder, "label">, before: InvoiceFile[], after: InvoiceFile[], stored: InvoiceFile, replace: boolean): string {
  if (replace && before.length === 1) return `Replaced ${before[0].name} with ${fileText(stored)} on ${holder.label}.`
  return `Attached ${fileText(stored)} to ${holder.label}${after.length > 1 ? `; it now holds ${after.length} files` : ""}.`
}

export function registerGetFile(server: McpServer): void {
  server.registerTool(
    "get_file",
    {
      title: "Get Invoice File",
      description:
        "Fetches one invoice file of a company (SRL) cost or an issued invoice (target cost or invoice, id from " +
        "get_cash_book or list_invoices; fileId from the row's files there, needed when the row holds more than one): the file " +
        "itself as an embedded resource with its content type, to read or pass on. " +
        "A FatturaPA XML comes back as its text, exactly as attached; a PDF or a signed .p7m as base64: «fammi vedere la fattura XML».",
      inputSchema: z.object({ target: fileTargetInput, id: z.string().min(1), fileId: fileIdInput }),
    },
    async (input, ctx) => {
      try {
        const userId = userIdOf(ctx)
        const holder = await fileHolder(userId, input.target, input.id)
        const file = pickFile(holder, input.fileId)
        if (!ownFolder(userId, file.path)) throw new ToolInputError(`The file of this ${holder.noun} is not in your folder, so it is not served.`)
        const bytes = new Uint8Array(await (await getServerFiles().download(file)).arrayBuffer())
        const sha256 = createHash("sha256").update(bytes).digest("hex")
        const mimeType = INVOICE_FILE_CONTENT_TYPE[file.kind]
        const uri = `alter-ego://invoice-files/${input.target}/${input.id}/${fileIdOf(file.path)}`
        // An XML goes back as the text it is (the model reads a FatturaPA itself); a PDF or a .p7m, and an XML that is not valid UTF-8, as a blob.
        let text: string | null = null
        if (file.kind === "xml") {
          try {
            text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes)
          } catch {
            text = null
          }
        }
        return {
          content: [
            { type: "text" as const, text: JSON.stringify({ summary: `${fileText(file)} of ${holder.label}.`, file: fileSummary(file, sha256) }) },
            {
              type: "resource" as const,
              resource: text !== null ? { uri, mimeType, text } : { uri, mimeType, blob: Buffer.from(bytes).toString("base64") },
            },
          ],
        }
      } catch (e) {
        return toolError(e)
      }
    },
  )
}
