import { createHash, randomBytes } from "node:crypto"

import { getServerDb, getServerFiles } from "@/lib/backend/server-db"

/**
 * The upload links (create_upload_url / PUT /api/uploads/<token> / complete_upload).
 * The token in the link is a random secret: the record is stored under its hash, so the
 * database never holds a working link.
 */

export const UPLOAD_TTL_MS = 15 * 60 * 1000

/** 32 random bytes as base64url: 43 characters. */
export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/

export const newUploadToken = () => randomBytes(32).toString("base64url")

/** The record id (and the uploadId the tools return) for a link's secret. */
export const uploadIdOf = (token: string) => createHash("sha256").update(token).digest("base64url")

/**
 * Deletes this user's uploads whose link has expired, and the objects they stored unless a row
 * took them (completed). Lazy: it runs when the user next creates or completes an upload
 * (ponytail: no scheduled sweep, so an abandoned user's last objects stay until they return).
 */
export async function sweepUploads(userId: string, at: Date = new Date()): Promise<void> {
  const db = getServerDb()
  for (const u of await db.listUploads(userId)) {
    if (u.expiresAt > at) continue
    // A completing upload may already be the row's file (a crash or a failed final write leaves it there): its object is never swept.
    // ponytail: a completing record that died before the row moved leaks its object; checking the row would reclaim it.
    if (u.status !== "completed" && u.status !== "completing" && u.file?.path.startsWith(`users/${userId}/company-files/`)) {
      await getServerFiles().remove(u.file.path).catch((e) => console.error(`Could not delete ${u.file!.path}; it stays unreferenced`, e))
    }
    await db.deleteUpload(u.id)
  }
}
