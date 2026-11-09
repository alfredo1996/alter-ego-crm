import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

// Pin the timezone so date tests are deterministic: this app stores dates as
// local midnight, so a UTC runner would silently pass tests that assert
// local-vs-UTC calendar-day behaviour. Override with TZ=... to check other zones.
process.env.TZ ||= "Europe/Rome";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    // A page-sized render takes ~0.5 s alone but 10x that when three modes and other worktrees share
    // the machine, and the default 5 s then fails green tests. 30 s still fails a real hang.
    testTimeout: 30_000,
    environment: "happy-dom",
    include: ["src/**/*.test.{ts,tsx}", "../../packages/*/src/**/*.test.{ts,tsx}", "../../packages/modules/*/src/**/*.test.{ts,tsx}"],
    // Emulator-only integration tests (run via vitest.emulator.ts, not here).
    exclude: [
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
    setupFiles: ["./vitest.setup.ts"],
    coverage: {
      provider: "v8",
      // the kernel and UI helpers live outside apps/web
      allowExternal: true,
      reporter: ["text", "json", "html"],
      include: [
        "src/**/*.{ts,tsx}",
        // The shared helpers that moved out of src/ (the UI kit's components stay Playwright-covered)
        "../../packages/kernel/src/**/*.ts",
        "../../packages/ui/src/utils.ts",
        "../../packages/ui/src/use-toast.ts",
        // A module's logic, schemas and adapters (its pages and dialogs stay Playwright-covered)
        "../../packages/modules/*/src/**/*.ts",
      ],
      exclude: [
        "src/**/*.test.{ts,tsx}",
        "src/**/*.d.ts",
        "../../packages/*/src/**/__tests__/**",
        "**/packages/modules/*/src/**/__tests__/**",
        // Pure Firestore I/O — exercised by the module's emulator contract
        "**/packages/modules/*/src/adapter-firebase.ts",
        "src/types/**",
        // React UI — covered by Playwright E2E tests
        "src/components/**",
        // Pages and layouts; src/app/api/** (the route handlers) counts
        "src/app/*.{ts,tsx}",
        "src/app/[(]app[)]/**",
        "src/app/[(]auth[)]/**",
        "src/app/[(]viewer[)]/**",
        "src/app/[[]lang]/**",
        "src/app/.well-known/**",
        "src/app/oauth/**",
        // State / React hooks — require provider setup; business logic tested via adapters
        "src/stores/**",
        // Pure Firestore I/O — exercised by the OAuth flow emulator tests
        "src/lib/oauth/store.ts",
        // Firestore I/O tool handlers — exercised by the MCP emulator tests
        "src/lib/mcp/tools/crm-read.ts",
        "src/lib/mcp/tools/crm-write.ts",
        "src/lib/mcp/tools/invoice-files.ts",
        "src/hooks/**",
        // External service adapters — require live connections
        "src/lib/backend/firebase.ts",
        "src/lib/backend/firebase-admin.ts",
        "src/lib/firebase-admin-client.ts",
        // Runtime-only: env validation and adapter selector singleton
        "src/lib/env.ts",
        "src/lib/backend/index.ts",
        "src/lib/backend/server-db.ts",
        // Pure TypeScript interface declarations (no executable statements)
        "src/lib/backend/types.ts",
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
});
