/**
 * Vitest globalSetup for Firebase emulator tests.
 * Runs once in the main process before any test workers start.
 *
 * Verifies emulators are reachable and clears all data.
 */

const { firestore: FIRESTORE_HOST, auth: AUTH_HOST, storage: STORAGE_HOST } = emulatorHosts()

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

// globalSetup runs in the main Node process (no Vite). @/ aliases won't work,
// but relative TypeScript imports are transformed by vitest's esbuild runner.
import {
  assertThrowawayEmulator,
  emulatorHosts,
  listStorageObjects,
  storageObjectsBase,
  TEST_PROJECT_ID as PROJECT_ID,
} from "./src/lib/backend/__tests__/emulator-hosts"
import { loadRules, testRules } from "./src/lib/backend/__tests__/rules-source"

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

  console.log("   ✓ Ready\n")
}

export async function teardown(): Promise<void> {
  // Vitest runs teardown even when setup threw: clear only what setup approved.
  if (!owned) return
  await Promise.all([clearFirestoreData(), clearAuthData(), clearStorageData()]).catch(() => {})
}
