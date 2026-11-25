/**
 * Setting up a copy (#54, #55): `pnpm install` leaves a tree that type-checks, and the
 * self-hosting steps seed the default categories into the local emulator.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

// Vitest runs with cwd = apps/web, so the repository root is two levels up.
const ROOT = join(process.cwd(), "../..")
const read = (file: string) => readFileSync(join(ROOT, file), "utf8")
const walk = (dir: string): string[] =>
  existsSync(dir)
    ? readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]))
    : []

describe("a fresh clone type-checks after pnpm install (#55)", () => {
  it("generates the docs source in the web app's postinstall", () => {
    expect(JSON.parse(read("apps/web/package.json")).scripts.postinstall).toBe("fumadocs-mdx")
  })

  it("keeps no by-hand fumadocs-mdx step in the workflows or the agent notes", () => {
    const files = [".github", ".claude"].flatMap((d) => walk(join(ROOT, d)))
    expect(files.filter((f) => readFileSync(f, "utf8").includes("fumadocs-mdx"))).toEqual([])
  })
})

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
