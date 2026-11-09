import { initializeApp, getApps, type FirebaseApp } from "firebase/app"
import { getAuth, connectAuthEmulator, type Auth } from "firebase/auth"
import { getFirestore, connectFirestoreEmulator, type Firestore } from "firebase/firestore"
import { getStorage, connectStorageEmulator, type FirebaseStorage } from "firebase/storage"

import { env } from "@/lib/env"

let app: FirebaseApp | null = null
let authInstance: Auth | null = null
let dbInstance: Firestore | null = null
let storageInstance: FirebaseStorage | null = null
// Set by configureForEmulator; Storage connects on first use, since a build without a bucket never asks for it.
let storageEmulator: { host: string; port: number } | null = null

function getFirebaseApp(): FirebaseApp {
  if (app) return app

  if (
    !env.NEXT_PUBLIC_FIREBASE_API_KEY ||
    !env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ||
    !env.NEXT_PUBLIC_FIREBASE_PROJECT_ID
  ) {
    throw new Error(
      "Firebase env vars not set. Set NEXT_PUBLIC_FIREBASE_API_KEY, NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN, and NEXT_PUBLIC_FIREBASE_PROJECT_ID."
    )
  }

  const existing = getApps().find((a) => a.name === "[DEFAULT]")
  if (existing) {
    app = existing
    return app
  }

  app = initializeApp({
    apiKey: env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: env.NEXT_PUBLIC_FIREBASE_APP_ID,
  })

  return app
}

export function getFirebaseAuth(): Auth {
  if (authInstance) return authInstance
  authInstance = getAuth(getFirebaseApp())
  return authInstance
}

export function getFirebaseDb(): Firestore {
  if (dbInstance) return dbInstance
  dbInstance = getFirestore(getFirebaseApp())
  return dbInstance
}

export function getFirebaseStorage(): FirebaseStorage {
  if (storageInstance) return storageInstance
  if (!env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET) {
    throw new Error("Firebase env vars not set. Set NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET to keep invoice files.")
  }
  storageInstance = getStorage(getFirebaseApp())
  if (storageEmulator) connectStorageEmulator(storageInstance, storageEmulator.host, storageEmulator.port)
  return storageInstance
}

let emulatorsConfigured = false

/**
 * Connect the Firebase SDK to the local emulators.
 * Must be called once before any Auth/Firestore operations.
 * Safe to call multiple times — subsequent calls are no-ops.
 */
export function configureForEmulator({
  authPort = 9099,
  firestorePort = 8080,
  storagePort = 19199,
  authHost = "localhost",
  firestoreHost = "localhost",
  storageHost = "localhost",
}: {
  authPort?: number
  firestorePort?: number
  storagePort?: number
  authHost?: string
  firestoreHost?: string
  storageHost?: string
} = {}): void {
  if (emulatorsConfigured) return
  emulatorsConfigured = true
  connectAuthEmulator(getFirebaseAuth(), `http://${authHost}:${authPort}`, { disableWarnings: true })
  connectFirestoreEmulator(getFirebaseDb(), firestoreHost, firestorePort)
  storageEmulator = { host: storageHost, port: storagePort }
}
