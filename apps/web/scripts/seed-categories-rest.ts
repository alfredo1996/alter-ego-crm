/**
 * Seed default categories to production Firestore using REST API.
 * Uses the Firebase CLI access token (no Admin SDK / gcloud needed).
 *
 * Usage: FIREBASE_PROJECT_ID=your-project-id pnpm tsx scripts/seed-categories-rest.ts
 */

import { execSync } from "child_process"

import { defaultCategories } from "@alter-ego/finance/lib/categories"

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID
if (!PROJECT_ID) {
  console.error("Set FIREBASE_PROJECT_ID env var")
  process.exit(1)
}

// Get access token from Firebase CLI. Its output was never read: getAccessToken
// below uses the CLI's stored credentials. The call is kept as it was.
execSync("pnpm exec firebase login:ci --no-localhost 2>/dev/null || true", { encoding: "utf-8" })

// Try to get token from the CLI's stored credentials
function getAccessToken(): string {
  try {
    const result = execSync(
      `node -e "const c = require(require('os').homedir() + '/.config/configstore/firebase-tools.json'); process.stdout.write(c.tokens.access_token)"`,
      { encoding: "utf-8" },
    )
    return result.trim()
  } catch {
    throw new Error(
      "Could not get Firebase access token. Run: firebase login",
    )
  }
}

const accessToken = getAccessToken()
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`

function encode(val: unknown): Record<string, unknown> {
  if (val === null) return { nullValue: null }
  if (typeof val === "boolean") return { booleanValue: val }
  if (typeof val === "string") return { stringValue: val }
  if (val instanceof Date) return { timestampValue: val.toISOString() }
  return { stringValue: String(val) }
}

async function createDoc(collection: string, fields: Record<string, unknown>): Promise<void> {
  const body = {
    fields: Object.fromEntries(
      Object.entries(fields).map(([k, v]) => [k, encode(v)]),
    ),
  }

  const res = await fetch(`${BASE}/${collection}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`POST /${collection} failed: ${res.status} ${text}`)
  }
}

async function checkExisting(): Promise<number> {
  const res = await fetch(`${BASE}/categories?pageSize=1`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) return 0
  const data = await res.json()
  return data.documents?.length ?? 0
}

async function main() {
  console.log(`\n🌱 Seeding default categories to ${PROJECT_ID}...\n`)

  const existing = await checkExisting()
  if (existing > 0) {
    console.log("   Categories already exist. Skipping seed (idempotent).")
    console.log("   ✓ Done\n")
    return
  }

  const now = new Date()
  let count = 0

  for (const cat of defaultCategories) {
    await createDoc("categories", {
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
    count++

    for (const child of cat.children ?? []) {
      await createDoc("categories", {
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
      count++
    }
  }

  console.log(`   ✓ Seeded ${count} default categories`)
  console.log("   ✓ Done\n")
}

main().catch((err) => {
  console.error("❌ Seed failed:", err.message)
  process.exit(1)
})
