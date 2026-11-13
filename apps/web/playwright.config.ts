import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  workers: 2,
  reporter: "html",
  timeout: 60_000,
  use: {
    baseURL: "http://localhost:3001",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "auth",
      testMatch: "auth.spec.ts",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "chromium",
      testIgnore: ["auth.spec.ts", "mobile.spec.ts", "modules.spec.ts"],
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-chrome",
      testMatch: [
        "navigation.spec.ts",
        "sign-out.spec.ts",
        "settings.spec.ts",
        "mobile.spec.ts",
        "solutions.spec.ts",
        "contracts.spec.ts",
        "plan-stable.spec.ts",
        "plan-time-off.spec.ts",
        "invoice-files.spec.ts",
        "month-end-files.spec.ts",
      ],
      use: { ...devices["Pixel 5"] },
    },
  ],
  webServer: {
    // Tests run against a production build: `next dev` compiled each route on
    // its first hit, which is most of what a cold run waited on.
    command: "pnpm build && pnpm start --port 3001",
    // The backend must be chosen here, not in a setup file: NEXT_PUBLIC_* is
    // inlined into the bundle at build time, so it has to reach `pnpm build`,
    // and anything set after this command runs is too late. Without it the
    // build picks up .env.local and every test dies signing in against real
    // Firebase. Variables set here reach both the build and the server.
    env: { NEXT_PUBLIC_BACKEND: "mock" },
    url: "http://localhost:3001",
    // A cold production build on CI's 2-vCPU runner.
    timeout: 300_000,
    // Locally, a server already on the port (e.g. `NEXT_PUBLIC_BACKEND=mock
    // pnpm dev --port 3001`) is reused, for quick iteration without a build.
    reuseExistingServer: !process.env.CI,
  },
});
