/**
 * Vitest configuration for Firebase emulator integration tests.
 *
 * Run with:
 *   pnpm test:firebase
 *
 * Requires the Firebase emulators to be running:
 *   firebase emulators:start --only auth,firestore,storage
 *
 * Two projects share this config. The Storage emulator has one ruleset for every file, so the file that
 * swaps it (storage-rules.test.ts) runs alone, after the parallel ones (vitest.emulator.files.ts).
 */
import { fileURLToPath } from "node:url"

import tsconfigPaths from "vite-tsconfig-paths"
import { defineConfig } from "vitest/config"

import { aloneFiles, parallelFiles } from "./vitest.emulator.files"

// Same pin as vitest.config.ts: "today" and every local-midnight date mean Rome time,
// as they do on the server (pinServerTimeZone). Override with TZ=... to check other zones.
process.env.TZ ||= "Europe/Rome"

// Fake Firebase config injected before any module loads — emulator accepts any non-empty values
const firebaseEnv = {
  NEXT_PUBLIC_BACKEND: "firebase",
  // Every plugin on: Personal Finance is opt-in, and its MCP tools exist only when it is listed.
  NEXT_PUBLIC_PLUGINS: "finance,consulting,accounting,rent",
  NEXT_PUBLIC_FIREBASE_API_KEY: "demo-api-key",
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: "demo-alter-ego.firebaseapp.com",
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: "demo-alter-ego",
  NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: "demo-alter-ego.appspot.com",
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: "000000000000",
  NEXT_PUBLIC_FIREBASE_APP_ID: "1:000000000000:web:0000000000000000",
}

// Everything the two projects share. globalSetup is NOT here: it wipes the emulators and refuses a
// non-empty one, so it must run once per command, from the root config below.
const shared = {
  plugins: [tsconfigPaths()],
  resolve: {
    alias: [{ find: /^@\/lib\/owner-uid$/, replacement: fileURLToPath(new URL("./src/lib/backend/__tests__/owner-uid-open.ts", import.meta.url)) }],
  },
  test: {
    // Firebase SDK requires a real Node environment (network, crypto, etc.)
    environment: "node" as const,
    // Inject env vars before any module is imported (avoids env.ts singleton issue)
    env: firebaseEnv,
    // Connects the SDK to emulators after env vars are set
    setupFiles: ["./vitest.emulator.setup.ts"],
    // Give emulator calls more time than the default 5s
    testTimeout: 30000,
    hookTimeout: 30000,
  },
}

export default defineConfig({
  test: {
    // Verifies emulators are live and clears data before the whole run
    globalSetup: ["./vitest.emulator.global-setup.ts"],
    projects: [
      // Firebase emulator integration tests: adapter contract, rules, OAuth flow
      { ...shared, test: { ...shared.test, name: "firebase-emulator", include: parallelFiles } },
      // ponytail: the alone group adds its own wall time after the parallel one; one Storage emulator per file
      // would let it run in parallel if the suite outgrows this.
      { ...shared, test: { ...shared.test, name: "firebase-emulator-alone", include: aloneFiles, sequence: { groupOrder: 1 }, fileParallelism: false } },
    ],
  },
})
