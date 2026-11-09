import { env } from "@/lib/env"
import { configureForEmulator } from "@/lib/firebase-client"

import { createFirebaseAdapter } from "./firebase"
import { createMockAdapter } from "./mock"

import type { BackendAdapter } from "./types"

export type { BackendAdapter, AuthAdapter, DatabaseAdapter } from "./types"

let adapterInstance: BackendAdapter | null = null

export function getBackend(): BackendAdapter {
  if (adapterInstance) return adapterInstance

  switch (env.NEXT_PUBLIC_BACKEND) {
    case "firebase":
      // Must wire emulators BEFORE the adapter issues any Auth/Firestore calls.
      if (env.NEXT_PUBLIC_USE_EMULATOR) {
        configureForEmulator()
      }
      adapterInstance = createFirebaseAdapter()
      break
    case "mock":
    default:
      adapterInstance = createMockAdapter()
      break
  }

  return adapterInstance
}
