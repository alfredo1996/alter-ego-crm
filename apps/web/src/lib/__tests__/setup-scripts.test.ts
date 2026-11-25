/**
 * Setting up a copy (#54, #55): `pnpm install` leaves a tree that type-checks, and the
 * self-hosting steps seed the default categories into the local emulator.
 */
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

// Vitest runs with cwd = apps/web, so the repository root is two levels up.
const ROOT = join(process.cwd(), "../..")
const read = (file: string) => readFileSync(join(ROOT, file), "utf8")

describe("a fresh clone type-checks after pnpm install (#55)", () => {
  it("generates the docs source in the web app's postinstall", () => {
    expect(JSON.parse(read("apps/web/package.json")).scripts.postinstall).toBe("fumadocs-mdx")
  })

  it("keeps no by-hand fumadocs-mdx step in the workflows or the agent notes", () => {
    // Tracked files only: a worktree or settings.local.json under .claude/ is not the repository.
    const files = execFileSync("git", ["ls-files", "--", ".github", ".claude"], { cwd: ROOT, encoding: "utf8" })
      .split("\n")
      .filter(Boolean)
    expect(files.filter((f) => read(f).includes("fumadocs-mdx"))).toEqual([])
  })
})

describe("the local emulator starts with the default categories (#54)", () => {
  it.each(["README.md", "docs/SELF-HOSTING.md"])("%s runs local:seed right after local:start", (file) => {
    expect(read(file)).toMatch(/^pnpm local:start .*\npnpm local:seed /m)
  })

  it("lists local:seed and says what seed:firebase needs in the README's command table", () => {
    const rows = read("README.md").split("\n").filter((l) => l.startsWith("| `pnpm "))
    expect(rows.some((r) => r.startsWith("| `pnpm local:seed`"))).toBe(true)
    expect(rows.find((r) => r.startsWith("| `pnpm seed:firebase`"))).toContain("FIREBASE_PROJECT_ID")
  })
})
