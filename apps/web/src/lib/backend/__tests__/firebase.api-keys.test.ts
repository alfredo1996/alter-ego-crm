/**
 * The production client path for API keys (#342): the Firebase adapter's
 * authHeader, fetch and error mapping, against the real route handlers and the
 * Auth emulator. Global fetch is stubbed to call the handlers in-process.
 */
import { createUserWithEmailAndPassword } from "firebase/auth"
import { afterEach, describe, expect, it, vi } from "vitest"

import { DELETE } from "@/app/api/keys/[id]/route"
import { POST } from "@/app/api/keys/route"
import { hashApiKey } from "@/lib/api-auth"
import { createFirebaseAdapter } from "@/lib/backend/firebase"
import * as admin from "@/lib/backend/firebase-admin"
import { getFirebaseAuth } from "@/lib/firebase-client"

afterEach(() => vi.unstubAllGlobals())

describe("firebase adapter API keys", () => {
  it("creates through POST /api/keys and revokes through DELETE /api/keys/{id}", async () => {
    const { user } = await createUserWithEmailAndPassword(
      getFirebaseAuth(),
      `keys-${Date.now()}@example.com`,
      "Test1234!",
    )
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      const req = new Request(`http://x${url}`, init)
      if (init.method === "POST") return POST(req)
      return DELETE(req, { params: Promise.resolve({ id: decodeURIComponent(url.split("/").pop()!) }) })
    })
    const { db } = createFirebaseAdapter()

    const { key, id } = await db.createApiKey(user.uid)
    expect(await admin.validateApiKey(await hashApiKey(key))).toBe(user.uid)

    await db.deleteApiKey(user.uid, id)
    expect(await admin.validateApiKey(await hashApiKey(key))).toBeNull()
  })
})
