/**
 * The emulator suite runs its files in parallel against one Storage emulator, and
 * loadStorageRules() replaces the rules of that whole emulator. A file that loads
 * anything but the open test rules must therefore run alone, after the others (#38).
 */
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { aloneFiles, parallelFiles } from "../../../../vitest.emulator.files"

const SRC = join(__dirname, "../../..")
const SELF = __filename

const testFiles = (readdirSync(SRC, { recursive: true }) as string[])
  .filter((f) => /\.test\.tsx?$/.test(f))
  .map((f) => join(SRC, f))
  .filter((f) => f !== SELF)

// Files whose Storage-rules load is anything but the open rules every other file needs.
const swappers = testFiles
  .filter((f) =>
    [...readFileSync(f, "utf8").matchAll(/loadStorageRules\(\s*\w+\s*,\s*([^\n]*)/g)].some((m) => !m[1].startsWith("testStorageRules()"))
  )
  .map((f) => f.slice(SRC.length - "src".length))

describe("emulator suite file groups", () => {
  it("finds the files that swap the Storage rules", () => {
    expect(swappers).not.toEqual([])
  })

  it.each(swappers)("%s runs alone, not in parallel", (file) => {
    expect(parallelFiles).not.toContain(file)
    expect(aloneFiles).toContain(file)
  })

  it("lists each file once, and only files that exist", () => {
    const all = [...parallelFiles, ...aloneFiles]
    expect(new Set(all).size).toBe(all.length)
    for (const f of all) expect(() => readFileSync(join(SRC, "..", f))).not.toThrow()
  })
})
