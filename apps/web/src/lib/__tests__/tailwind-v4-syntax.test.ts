/**
 * Tailwind v4 reads a CSS variable in a utility as `w-(--x)`. The v3 form
 * `w-[--x]` compiles to invalid CSS that the browser drops without a word:
 * Select lists lost their height cap and calendar days shrank to 16 px that way.
 */
import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"

import { describe, expect, it } from "vitest"

const SRC = join(__dirname, "../..")
const UI = join(__dirname, "../../../../../packages/ui/src")
const MODULES = join(__dirname, "../../../../../packages/modules")
const V3_VARIABLE = /-\[--[\w-]+\]/g

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sources(path)
    return /\.(tsx?|css)$/.test(entry.name) && path !== __filename ? [path] : []
  })
}

describe("Tailwind v4 variable syntax", () => {
  it("no class uses the v3 -[--var] form", () => {
    const hits = [...sources(SRC), ...sources(UI), ...sources(MODULES)].flatMap((file) =>
      (readFileSync(file, "utf8").match(V3_VARIABLE) ?? []).map((m) => `${relative(join(SRC, "../../.."), file)}: ${m}`),
    )
    expect(hits).toEqual([])
  })
})
