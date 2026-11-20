import { beforeAll } from "vitest"

// Finance reaches the app only through its host (provideFinanceHost). Set it when a test file starts,
// not when this setup file loads: a test's vi.mock("@/lib/backend") or vi.mock("@/hooks/use-auth") is
// registered after the setup files and would miss anything they imported.
// Its own file, so the packages' tsconfigs (which include vitest.setup.ts) never follow the app's "@/" imports.
beforeAll(async () => {
  await import("./src/lib/finance-host")
})
