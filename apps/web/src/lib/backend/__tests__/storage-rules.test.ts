/**
 * storage.rules — the invoice files bucket (emulator).
 *
 * The adapter contract only ever sends a valid file to its owner's folder, so
 * the rules' ownership, size and kind checks were untested. Here the client SDK
 * runs with the rules ENFORCED, as two real users.
 *
 * Runs under the Firebase emulator (vitest.emulator.ts).
 */
import { createUserWithEmailAndPassword, signInWithEmailAndPassword } from "firebase/auth"
import { deleteObject, getBytes, ref, uploadBytes } from "firebase/storage"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { getFirebaseAuth, getFirebaseStorage } from "@/lib/firebase-client"

import { emulatorHosts } from "./emulator-hosts"
import { rulesFor } from "./owner-copy"
import { loadStorageRules, productionStorageRules, testStorageRules } from "./rules-source"

const { auth: AUTH_HOST, storage: STORAGE_HOST } = emulatorHosts()

const PLACEHOLDER = "OWNER_UID_NOT_SET"
const OWNER_UID = "owner-test-uid"
const PASSWORD = "Test1234!"
const stamp = Date.now()
const emails = { a: `storage-a-${stamp}@example.com`, b: `storage-b-${stamp}@example.com` }
const uids = { a: "", b: "" }

const signInAs = async (who: "a" | "b") => {
  await signInWithEmailAndPassword(getFirebaseAuth(), emails[who], PASSWORD)
}
const at = (path: string) => ref(getFirebaseStorage(), path)
const mine = (name: string) => `users/${uids.a}/company-files/${name}`
const put = (path: string, body: BlobPart | Uint8Array, contentType: string) =>
  uploadBytes(at(path), new Blob([body as BlobPart]), { contentType })

let n = 0
const fresh = (ext: string) => `r${Date.now()}-${++n}.${ext}`

// The global setup opens the Storage rules for random users; the last two describes swap them and restore the open ones.
beforeAll(async () => {
  uids.a = (await createUserWithEmailAndPassword(getFirebaseAuth(), emails.a, PASSWORD)).user.uid
  uids.b = (await createUserWithEmailAndPassword(getFirebaseAuth(), emails.b, PASSWORD)).user.uid
  await signInAs("a")
})

describe("the owner", () => {
  it.each([
    ["xml", "application/xml"],
    ["xml", "text/xml"],
    ["xml.p7m", "application/pkcs7-mime"],
    ["pdf", "application/pdf"],
  ])("stores, reads back and deletes a .%s sent as %s", async (ext, contentType) => {
    await signInAs("a")
    const path = mine(fresh(ext))
    await put(path, "<a/>", contentType)
    expect(new TextDecoder().decode(await getBytes(at(path)))).toBe("<a/>")
    await deleteObject(at(path))
  })

  it("stores exactly 10 MB", async () => {
    await signInAs("a")
    const path = mine(fresh("pdf"))
    await put(path, new Uint8Array(10 * 1024 * 1024), "application/pdf")
    await deleteObject(at(path))
  })
})

describe("refused uploads", () => {
  const cases: [string, string, string, number][] = [
    ["more than 10 MB", fresh("pdf"), "application/pdf", 10 * 1024 * 1024 + 1],
    ["another type", fresh("docx"), "application/vnd.openxmlformats-officedocument.wordprocessingml.document", 10],
    ["a .p7m without .xml", fresh("p7m"), "application/pkcs7-mime", 10],
    ["an XML typed as a PDF", fresh("xml"), "application/pdf", 10],
    ["a PDF typed as XML", fresh("pdf"), "application/xml", 10],
    ["a p7m typed as a PDF", fresh("xml.p7m"), "application/pdf", 10],
    ["a file two levels deep", `sub/${fresh("xml")}`, "application/xml", 10],
  ]
  it.each(cases)("refuses %s", async (_why, name, contentType, size) => {
    await signInAs("a")
    await expect(put(mine(name), new Uint8Array(size), contentType)).rejects.toThrow()
  })

  it("refuses a path outside company-files", async () => {
    await signInAs("a")
    await expect(put(`users/${uids.a}/other/${fresh("xml")}`, "<a/>", "application/xml")).rejects.toThrow()
  })
})

describe("another user", () => {
  it("can neither read, overwrite, delete nor add to the owner's files", async () => {
    await signInAs("a")
    const path = mine(fresh("xml"))
    await put(path, "<a/>", "application/xml")

    await signInAs("b")
    await expect(getBytes(at(path))).rejects.toThrow()
    await expect(put(path, "<b/>", "application/xml")).rejects.toThrow()
    await expect(deleteObject(at(path))).rejects.toThrow()
    await expect(put(mine(fresh("xml")), "<b/>", "application/xml")).rejects.toThrow()

    await signInAs("a")
    expect(new TextDecoder().decode(await getBytes(at(path)))).toBe("<a/>")
    await deleteObject(at(path))
  })
})

/** Auth emulator sign-up with an explicit uid ("Bearer owner" is the emulator's admin: only it may set one). */
async function signUpWithUid(email: string, localId: string) {
  const res = await fetch(`http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer owner" },
    body: JSON.stringify({ email, password: PASSWORD, localId }),
  })
  if (!res.ok) throw new Error(`Cannot create ${localId} in the Auth emulator: ${res.status}`)
}

describe("the rules as committed (placeholder: nobody)", () => {
  const EMAIL = `storage-placeholder-${stamp}@example.com`
  const placeholderPath = `users/${PLACEHOLDER}/company-files/${fresh("xml")}`

  beforeAll(async () => {
    await signUpWithUid(EMAIL, PLACEHOLDER)
    await loadStorageRules(STORAGE_HOST, productionStorageRules())
  })
  afterAll(() => loadStorageRules(STORAGE_HOST, testStorageRules()))

  it("refuses a token whose uid is the placeholder, in its own folder", async () => {
    await signInWithEmailAndPassword(getFirebaseAuth(), EMAIL, PASSWORD)
    await expect(put(placeholderPath, "<a/>", "application/xml")).rejects.toMatchObject({ code: "storage/unauthorized" })
    await expect(getBytes(at(placeholderPath))).rejects.toMatchObject({ code: "storage/unauthorized" })
  })

  it("refuses a random signed-in uid in its own folder", async () => {
    await signInAs("a")
    await expect(put(mine(fresh("xml")), "<a/>", "application/xml")).rejects.toThrow()
  })

  it("refuses a signed-out visitor", async () => {
    await getFirebaseAuth().signOut()
    await expect(put(placeholderPath, "<a/>", "application/xml")).rejects.toMatchObject({ code: "storage/unauthorized" })
  })
})

describe("the rules after setup:owner (a made-up uid)", () => {
  const EMAIL = `storage-owner-${stamp}@example.com`
  const ownerPath = `users/${OWNER_UID}/company-files/${fresh("xml")}`

  beforeAll(async () => {
    await signUpWithUid(EMAIL, OWNER_UID)
    await loadStorageRules(STORAGE_HOST, rulesFor(OWNER_UID).storage)
  })
  afterAll(() => loadStorageRules(STORAGE_HOST, testStorageRules()))

  it("lets the owner's uid store, read back and delete", async () => {
    await signInWithEmailAndPassword(getFirebaseAuth(), EMAIL, PASSWORD)
    await put(ownerPath, "<a/>", "application/xml")
    expect(new TextDecoder().decode(await getBytes(at(ownerPath)))).toBe("<a/>")
    await deleteObject(at(ownerPath))
  })

  it("refuses another uid in its own folder", async () => {
    await signInAs("a")
    await expect(put(mine(fresh("xml")), "<a/>", "application/xml")).rejects.toThrow()
  })

  it("refuses a signed-out visitor", async () => {
    await getFirebaseAuth().signOut()
    await expect(put(ownerPath, "<a/>", "application/xml")).rejects.toMatchObject({ code: "storage/unauthorized" })
    await expect(getBytes(at(ownerPath))).rejects.toMatchObject({ code: "storage/unauthorized" })
  })
})
