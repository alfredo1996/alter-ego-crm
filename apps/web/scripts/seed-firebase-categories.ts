/**
 * Seed default categories into the Firebase root /categories collection.
 * Run once per Firebase project with the Admin SDK:
 *
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
 *   FIREBASE_PROJECT_ID=your-project-id \
 *   pnpm tsx scripts/seed-firebase-categories.ts
 *
 * The client SDK cannot write to /categories (Security Rules deny it).
 * This script uses the Admin SDK, which bypasses Security Rules.
 */

import { defaultCategories } from "@alter-ego/finance/lib/categories"
import { initializeApp } from "firebase-admin/app"
import { getFirestore } from "firebase-admin/firestore"

// We import defaultCategories from source — tsx handles the path alias via tsconfig
// @ts-expect-error — path alias resolved by tsx / tsconfig paths

const projectId = process.env.FIREBASE_PROJECT_ID
if (!projectId) {
  console.error("FIREBASE_PROJECT_ID env var is required")
  process.exit(1)
}

// Application Default Credentials: GOOGLE_APPLICATION_CREDENTIALS (a key file or a
// workload identity file) or the runtime identity.
initializeApp({ projectId })

const db = getFirestore()

async function seed() {
  const now = new Date()
  const batch = db.batch()

  const existing = await db.collection("categories").get()
  if (!existing.empty) {
    console.log(`ℹ️  /categories already has ${existing.size} docs — skipping seed.`)
    console.log("   Delete the collection first if you want to re-seed.")
    process.exit(0)
  }

  for (const cat of defaultCategories) {
    const ref = db.collection("categories").doc()
    batch.set(ref, {
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
  }

  await batch.commit()
  console.log(`✅ Seeded ${defaultCategories.length} default categories into /categories`)
}

seed().catch((err) => {
  console.error("Seed failed:", err)
  process.exit(1)
})
