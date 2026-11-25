/**
 * Setting up a copy (#54): the self-hosting steps seed the default categories into the local emulator.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

// Vitest runs with cwd = apps/web, so the repository root is two levels up.
const ROOT = join(process.cwd(), "../..")
const read = (file: string) => readFileSync(join(ROOT, file), "utf8")

describe("the local emulator starts with the default categories (#54)", () => {
  it("seeds the emulator under the demo project", () => {
    expect(JSON.parse(read("package.json")).scripts["local:seed"]).toBe(
      "FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_PROJECT_ID=demo-alter-ego pnpm --filter @alter-ego/web seed:firebase",
    )
  })

  it.each(["README.md", "docs/SELF-HOSTING.md"])("%s runs local:seed right after local:start", (file) => {
    expect(read(file)).toMatch(/^pnpm local:start .*\npnpm local:seed /m)
  })

  it("lists local:seed and says what seed:firebase needs in the README's command table", () => {
    const rows = read("README.md").split("\n").filter((l) => l.startsWith("| `pnpm "))
    expect(rows.some((r) => r.startsWith("| `pnpm local:seed`"))).toBe(true)
    expect(rows.find((r) => r.startsWith("| `pnpm seed:firebase`"))).toContain("FIREBASE_PROJECT_ID")
  })
})
