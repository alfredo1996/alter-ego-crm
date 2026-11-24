import { createHash } from "node:crypto"

import { getServerDb, getServerFiles } from "@/lib/backend/server-db"
import { INVOICE_FILE_MAX_BYTES } from "@/lib/invoice-files"
import { TOKEN_PATTERN, uploadIdOf } from "@/lib/uploads"
import { enabledToolNames } from "@/modules"

export const runtime = "nodejs"

const reply = (status: number, error: string) => Response.json({ error }, { status })

/**
 * PUT /api/uploads/<token>: the bytes of a file create_upload_url made a link for. The token is
 * the capability, so there is no session and no key; it takes one object, once, before it expires.
 * The row is not touched here: complete_upload links the file.
 */
export async function PUT(request: Request, { params }: { params: Promise<{ token: string }> }): Promise<Response> {
  // The link belongs to the plugin that owns invoice files: with it off there is no such route.
  if (!enabledToolNames().has("create_upload_url")) return reply(404, "Not found.")
  const { token } = await params
  if (!TOKEN_PATTERN.test(token)) return reply(404, "Unknown upload link.")

  const db = getServerDb()
  const upload = await db.getUpload(uploadIdOf(token))
  if (!upload) return reply(404, "Unknown upload link.")
  if (upload.expiresAt <= new Date()) return reply(410, "This upload link has expired. Call create_upload_url for a new link.")
  if (upload.status !== "pending") return reply(409, "This upload link has already been used. Call create_upload_url for a new link.")

  const cap = Math.min(upload.declaredSize ?? INVOICE_FILE_MAX_BYTES, INVOICE_FILE_MAX_BYTES)
  const tooBig = () => reply(413, `The file is over the ${cap} bytes this link takes.`)
  if (Number(request.headers.get("content-length")) > cap) return tooBig()
  if (!request.body) return reply(400, "The request has no body: send the file with --data-binary @file.")

  // Claim the link before writing, so two concurrent PUTs cannot both store.
  if (!(await db.moveUpload(upload.id, "pending", "receiving"))) return reply(409, "This upload link has already been used. Call create_upload_url for a new link.")
  let stored: { path: string } | null = null
  try {
    const hash = createHash("sha256")
    const chunks: Uint8Array[] = []
    let size = 0
    const reader = request.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > cap) {
        await reader.cancel()
        await db.moveUpload(upload.id, "receiving", "failed")
        return tooBig()
      }
      hash.update(value)
      chunks.push(value)
    }
    if (size === 0) {
      await db.moveUpload(upload.id, "receiving", "failed")
      return reply(400, "The file is empty.")
    }
    const sha256 = hash.digest("hex")
    const file = await getServerFiles().upload(upload.userId, new Blob(chunks as BlobPart[]), upload.name)
    stored = file
    if (!(await db.moveUpload(upload.id, "receiving", "received", { file, sha256 }))) {
      // The record went while the body was arriving (the link expired and a sweep took it): nothing may name this object.
      await getServerFiles().remove(file.path).catch(() => undefined)
      return reply(410, "This upload link expired while the file was arriving. Call create_upload_url for a new link.")
    }
    return Response.json({ uploadId: upload.id, size: file.size, sha256 }, { status: 201 })
  } catch (e) {
    console.error("[uploads] PUT failed", e)
    if (stored) await getServerFiles().remove(stored.path).catch(() => undefined)
    await db.moveUpload(upload.id, "receiving", "failed").catch(() => undefined)
    return reply(500, "The upload failed. Call create_upload_url for a new link.")
  }
}
