import { defineConfig, devices } from "@playwright/test";

/**
 * The module-registry E2E: a production build with Invoicing and Solutions left out.
 * NEXT_PUBLIC_* is inlined at build time, so it needs a build of its own and the default
 * `pnpm test:e2e` does not run it. `pnpm test:e2e:modules` does (set MODULES_E2E_PORT for another port).
 */
const port = process.env.MODULES_E2E_PORT ?? "3011";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "modules.spec.ts",
  timeout: 60_000,
  retries: 0,
  reporter: "list",
  use: { baseURL: `http://localhost:${port}`, actionTimeout: 15_000, navigationTimeout: 30_000 },
  projects: [{ name: "modules", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `pnpm build && pnpm start --port ${port}`,
    env: { NEXT_PUBLIC_BACKEND: "mock", NEXT_PUBLIC_DISABLED_MODULES: "invoicing,solutions" },
    url: `http://localhost:${port}`,
    timeout: 300_000,
    reuseExistingServer: false,
  },
});
