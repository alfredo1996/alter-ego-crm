import { cert, getApps, initializeApp, type App } from "firebase-admin/app"
import { getAuth, type Auth } from "firebase-admin/auth"
import { getFirestore, type Firestore } from "firebase-admin/firestore"
import { getStorage } from "firebase-admin/storage"

import { env } from "@/lib/env"

let app: App | null = null

/**
 * Get the lazy-initialized Firebase Admin app.
 *
 * Emulator mode: when NEXT_PUBLIC_USE_EMULATOR=true, sets the standard
 * FIRESTORE_EMULATOR_HOST and FIREBASE_AUTH_EMULATOR_HOST env vars so the
 * Admin SDK auto-routes all calls to the local emulator. No service account
 * needed.
 *
 * Production: expects GOOGLE_APPLICATION_CREDENTIALS to point to a service
 * account JSON, OR runs on a Google infrastructure that auto-provides ADC
 * (Cloud Run, App Hosting, etc.).
 */
function getApp(): App {
  if (app) return app

  if (env.NEXT_PUBLIC_USE_EMULATOR) {
    process.env.FIRESTORE_EMULATOR_HOST ??= "localhost:8080"
    process.env.FIREBASE_AUTH_EMULATOR_HOST ??= "localhost:9099"
    process.env.FIREBASE_STORAGE_EMULATOR_HOST ??= "localhost:19199"
  }

  const existing = getApps().find((a) => a.name === "[DEFAULT]")
  if (existing) {
    app = existing
    return app
  }

  const projectId = env.NEXT_PUBLIC_FIREBASE_PROJECT_ID
  if (!projectId) {
    throw new Error(
      "firebase-admin: NEXT_PUBLIC_FIREBASE_PROJECT_ID must be set to initialize.",
    )
  }

  if (env.NEXT_PUBLIC_USE_EMULATOR) {
    // Emulator: no credentials needed; bare app is fine.
    app = initializeApp({ projectId })
  } else if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    // Production: explicit service account JSON in env var.
    const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON) as {
      project_id: string
      client_email: string
      private_key: string
    }
    app = initializeApp({
      credential: cert({
        projectId: sa.project_id,
        clientEmail: sa.client_email,
        privateKey: sa.private_key,
      }),
      projectId,
    })
  } else {
    // Production: trust Application Default Credentials (App Hosting, Cloud Run).
    app = initializeApp({ projectId })
  }

  return app
}

let firestoreInstance: Firestore | null = null
let authInstance: Auth | null = null

export function getAdminFirestore(): Firestore {
  if (firestoreInstance) return firestoreInstance
  firestoreInstance = getFirestore(getApp())
  return firestoreInstance
}

/** The default Storage bucket (invoice files), or null when the deployment has none: then no record can name a file. */
export function getAdminBucket() {
  const bucket = env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
  return bucket ? getStorage(getApp()).bucket(bucket) : null
}

export function getAdminAuth(): Auth {
  if (authInstance) return authInstance
  authInstance = getAuth(getApp())
  return authInstance
}
