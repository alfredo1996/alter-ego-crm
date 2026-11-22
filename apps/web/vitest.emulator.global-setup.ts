/**
 * Vitest globalSetup for Firebase emulator tests.
 * Runs once in the main process before any test workers start.
 *
 * Verifies emulators are reachable, clears all data, then seeds the root /categories
 * collection with Personal Finance's default categories (its contract needs them).
 *
 * Seeding uses `Authorization: Bearer owner` to bypass Firestore Security Rules —
 * this is only valid for the local emulator, never production.
 */

const { firestore: FIRESTORE_HOST, auth: AUTH_HOST, storage: STORAGE_HOST } = emulatorHosts()
const FIRESTORE_BASE = firestoreRestBase(FIRESTORE_HOST)

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function waitForEmulator(url: string, label: string, retries = 20): Promise<void> {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url)
      // 501: the Storage emulator answers its root that way, and it is up.
      if (res.ok || res.status < 500 || res.status === 501) return
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(
    `${label} emulator not reachable at ${url} after ${retries} attempts.\n` +
      `Start it with: firebase emulators:start --only auth,firestore,storage`
  )
}

async function clearFirestoreData(): Promise<void> {
  const url = `http://${FIRESTORE_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`
  const res = await fetch(url, { method: "DELETE" })
  if (!res.ok && res.status !== 404) {
    throw new Error(`Failed to clear Firestore data: ${res.status} ${res.statusText}`)
  }
}

async function clearAuthData(): Promise<void> {
  const url = `http://${AUTH_HOST}/emulator/v1/projects/${PROJECT_ID}/accounts`
  const res = await fetch(url, { method: "DELETE" })
  if (!res.ok && res.status !== 404) {
    throw new Error(`Failed to clear Auth data: ${res.status} ${res.statusText}`)
  }
}

async function clearStorageData(): Promise<void> {
  for (const name of await listStorageObjects(STORAGE_HOST)) {
    const res = await fetch(`${storageObjectsBase(STORAGE_HOST)}/${encodeURIComponent(name)}`, {
      method: "DELETE",
      headers: { Authorization: "Bearer owner" },
    })
    if (!res.ok && res.status !== 404) throw new Error(`Failed to clear Storage object ${name}: ${res.status}`)
  }
}

// ─── Default category seeds ───────────────────────────────────────────────────
// Build a Firestore REST document body from plain JS values
function firestoreDoc(fields: Record<string, unknown>): { fields: Record<string, unknown> } {
  function encode(val: unknown): unknown {
    if (val === null) return { nullValue: null }
    if (typeof val === "boolean") return { booleanValue: val }
    if (typeof val === "number") return Number.isInteger(val) ? { integerValue: String(val) } : { doubleValue: val }
    if (typeof val === "string") return { stringValue: val }
    if (val instanceof Date) return { timestampValue: val.toISOString() }
    return { stringValue: String(val) }
  }
  return { fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, encode(v)])) }
}

async function adminPost(collection: string, data: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${FIRESTORE_BASE}/${collection}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // "Bearer owner" bypasses Security Rules on the local emulator
      Authorization: "Bearer owner",
    },
    body: JSON.stringify(firestoreDoc(data)),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Firestore admin POST to /${collection} failed: ${res.status} ${body}`)
  }
}

async function seedDefaultCategories(): Promise<void> {
  const now = new Date()
  for (const cat of defaultCategories) {
    await adminPost("categories", {
      name: cat.name,
      group: cat.group,
      icon: cat.icon,
      color: cat.color,
      parentId: null,
      userId: null,
      isDefault: true,
      createdAt: now,
      updatedAt: now,
    })
    for (const child of cat.children ?? []) {
      await adminPost("categories", {
        name: child.name,
        group: cat.group,
        icon: child.icon,
        color: child.color,
        parentId: null,
        userId: null,
        isDefault: true,
        createdAt: now,
        updatedAt: now,
      })
    }
  }
}

// globalSetup runs in the main Node process (no Vite). @/ aliases won't work,
// but relative TypeScript imports are transformed by vitest's esbuild runner.
import { defaultCategories } from "@alter-ego/finance/lib/categories"

import {
  assertThrowawayEmulator,
  emulatorHosts,
  firestoreRestBase,
  listStorageObjects,
  storageObjectsBase,
  TEST_PROJECT_ID as PROJECT_ID,
} from "./src/lib/backend/__tests__/emulator-hosts"
import { loadRules, loadStorageRules, testRules, testStorageRules } from "./src/lib/backend/__tests__/rules-source"

// ─── Lifecycle ────────────────────────────────────────────────────────────────

let owned = false

export async function setup(): Promise<void> {
  console.log("\n🔥 Verifying Firebase emulators…")
  await Promise.all([
    waitForEmulator(`http://${AUTH_HOST}/`, "Auth"),
    waitForEmulator(`http://${FIRESTORE_HOST}/`, "Firestore"),
    waitForEmulator(`http://${STORAGE_HOST}/`, "Storage"),
  ])
  console.log(`   ✓ Auth emulator  ${AUTH_HOST}`)
  console.log(`   ✓ Firestore emulator ${FIRESTORE_HOST}`)
  console.log(`   ✓ Storage emulator ${STORAGE_HOST}`)

  // Before any delete: never wipe an emulator that is not ours (the owner's holds other work).
  await assertThrowawayEmulator()
  owned = true
  console.log("   Clearing emulator data…")
  await Promise.all([clearFirestoreData(), clearAuthData(), clearStorageData()])

  // The suite signs up random uids; production admits one (rules-source.ts).
  await loadRules(FIRESTORE_HOST, PROJECT_ID, testRules())
  // Same for Storage: no file may depend on storage-rules.test.ts having run first to open it.
  await loadStorageRules(STORAGE_HOST, testStorageRules())

  console.log("   Seeding default categories…")
  await seedDefaultCategories()
  console.log(`   ✓ Seeded ${defaultCategories.length} default categories`)
  console.log("   ✓ Ready\n")
}

export async function teardown(): Promise<void> {
  // Vitest runs teardown even when setup threw: clear only what setup approved.
  if (!owned) return
  await Promise.all([clearFirestoreData(), clearAuthData(), clearStorageData()]).catch(() => {})
}
