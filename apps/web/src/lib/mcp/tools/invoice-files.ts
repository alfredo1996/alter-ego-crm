import { getServerDb, getServerFiles } from "@/lib/backend/server-db"
import { formatFileSize, INVOICE_FILE_CONTENT_TYPE, INVOICE_FILE_KIND_LABEL } from "@/lib/invoice-files"
import { toolError, userIdOf } from "@/lib/mcp/tools/context"
import { ToolInputError } from "@/lib/mcp/tools/helpers"
import { fileSummary } from "@/lib/mcp/tools/helpers"
import { z } from "@/lib/zod"

import type { InvoiceFile } from "@/types"
import type { McpServer } from "@modelcontextprotocol/server"

/**
 * The invoice files of a company cost or an issued invoice over MCP: what the three tools
 * (attach_file and remove_file in crm-write.ts, get_file here) share.
 */

export const fileTargetInput = z.enum(["cost", "invoice"])

export const fileText = (f: InvoiceFile) => `${f.name} (${INVOICE_FILE_KIND_LABEL[f.kind]}, ${formatFileSize(f.size)})`

export const ownFolder = (userId: string, path: string) => path.startsWith(`users/${userId}/company-files/`)

/** The one cost or invoice a file call names, with the words that name it and the file it keeps. */
export async function fileHolder(userId: string, target: "cost" | "invoice", id: string) {
  const db = getServerDb()
  if (target === "cost") {
    const e = (await db.getCompanyExpenses(userId)).find((x) => x.id === id)
    if (!e) throw new ToolInputError(`No cost with id "${id}". get_cash_book lists each cost's id; an invoice's file goes with target: "invoice".`)
    if (e.isRecurring) {
      throw new ToolInputError(`"${e.description}" is a recurring estimate, not a document: attach the file to the cost that pays it.`)
    }
    return { noun: "cost", label: `the cost "${e.description}"`, file: e.file ?? null }
  }
  const i = (await db.getInvoices(userId)).find((x) => x.id === id)
  if (!i) throw new ToolInputError(`No invoice with id "${id}". list_invoices lists each invoice's id; a cost's file goes with target: "cost".`)
  return { noun: "invoice", label: `invoice ${i.number}`, file: i.file ?? null }
}

export function registerGetFile(server: McpServer): void {
  server.registerTool(
    "get_file",
    {
      title: "Get Invoice File",
      description:
        "Fetches the invoice file of a company (SRL) cost or an issued invoice (target cost or invoice, id from " +
        "get_cash_book or list_invoices): the file itself as an embedded resource with its content type, to read or pass on. " +
        "A FatturaPA XML comes back as its text, exactly as attached; a PDF or a signed .p7m as base64: «fammi vedere la fattura XML».",
      inputSchema: z.object({ target: fileTargetInput, id: z.string().min(1) }),
    },
    async (input, ctx) => {
      try {
        const userId = userIdOf(ctx)
        const holder = await fileHolder(userId, input.target, input.id)
        const file = holder.file
        if (!file) throw new ToolInputError(`${holder.label[0].toUpperCase()}${holder.label.slice(1)} has no file.`)
        if (!ownFolder(userId, file.path)) throw new ToolInputError(`The file of this ${holder.noun} is not in your folder, so it is not served.`)
        const bytes = new Uint8Array(await (await getServerFiles().download(file)).arrayBuffer())
        const mimeType = INVOICE_FILE_CONTENT_TYPE[file.kind]
        const uri = `alter-ego://invoice-files/${input.target}/${input.id}`
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
            { type: "text" as const, text: JSON.stringify({ summary: `${fileText(file)} of ${holder.label}.`, file: fileSummary(file) }) },
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
