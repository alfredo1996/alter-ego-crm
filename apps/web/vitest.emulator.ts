/**
 * Vitest configuration for Firebase emulator integration tests.
 *
 * Run with:
 *   pnpm test:firebase
 *
 * Requires the Firebase emulators to be running:
 *   firebase emulators:start --only auth,firestore,storage
 */
import { fileURLToPath } from "node:url"

import tsconfigPaths from "vite-tsconfig-paths"
import { defineConfig } from "vitest/config"

// Same pin as vitest.config.ts: "today" and every local-midnight date mean Rome time,
// as they do on the server (pinServerTimeZone). Override with TZ=... to check other zones.
process.env.TZ ||= "Europe/Rome"

// Fake Firebase config injected before any module loads — emulator accepts any non-empty values
const firebaseEnv = {
  NEXT_PUBLIC_BACKEND: "firebase",
  NEXT_PUBLIC_FIREBASE_API_KEY: "demo-api-key",
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: "demo-alter-ego.firebaseapp.com",
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: "demo-alter-ego",
  NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: "demo-alter-ego.appspot.com",
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: "000000000000",
  NEXT_PUBLIC_FIREBASE_APP_ID: "1:000000000000:web:0000000000000000",
}

export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    alias: [{ find: /^@\/lib\/owner-uid$/, replacement: fileURLToPath(new URL("./src/lib/backend/__tests__/owner-uid-open.ts", import.meta.url)) }],
  },
  test: {
    name: "firebase-emulator",
    // Firebase SDK requires a real Node environment (network, crypto, etc.)
    environment: "node",
    // Inject env vars before any module is imported (avoids env.ts singleton issue)
    env: firebaseEnv,
    // Firebase emulator integration tests: adapter contract, rules, OAuth flow
    include: [
      "src/lib/backend/__tests__/firebase.adapter.test.ts",
      "src/lib/backend/__tests__/firebase.freshness.test.ts",
      "src/lib/backend/__tests__/firebase.files.test.ts",
      "src/lib/backend/__tests__/firebaseadmin.adapter.test.ts",
      "src/lib/backend/__tests__/firebase.api-keys.test.ts",
      "src/lib/backend/__tests__/firestore-rules.test.ts",
      "src/lib/backend/__tests__/firestore-rules-owner.test.ts",
      "src/lib/backend/__tests__/storage-rules.test.ts",
      "src/lib/oauth/__tests__/flow.emulator.test.ts",
      "src/lib/backend/__tests__/firebaseadmin.crm.test.ts",
      "src/lib/mcp/__tests__/tools-read.emulator.test.ts",
      "src/lib/mcp/__tests__/tools-write.emulator.test.ts",
      "src/lib/mcp/__tests__/cash-book.emulator.test.ts",
      "src/lib/mcp/__tests__/solutions.emulator.test.ts",
      "src/lib/mcp/__tests__/collaborators.emulator.test.ts",
      "src/lib/mcp/__tests__/rent.emulator.test.ts",
      "src/lib/mcp/__tests__/invoice-files.emulator.test.ts",
    ],
    // Connects the SDK to emulators after env vars are set
    setupFiles: ["./vitest.emulator.setup.ts"],
    // Verifies emulators are live and clears data before the whole run
    globalSetup: ["./vitest.emulator.global-setup.ts"],
    // Give emulator calls more time than the default 5s
    testTimeout: 30000,
    hookTimeout: 30000,
  },
})
