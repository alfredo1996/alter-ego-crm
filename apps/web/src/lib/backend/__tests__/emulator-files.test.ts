// @vitest-environment node
/**
 * The emulator suite runs its files in parallel against one Storage emulator, and
 * loadStorageRules() replaces the rules of that whole emulator. Any file that calls it must
 * therefore run alone, after the others (#38). The scan is deliberately argument-blind: the
 * global setup opens the rules, so no parallel file has a reason to call it.
 */
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import emulatorConfig from "../../../../vitest.emulator"
import { aloneFiles, parallelFiles } from "../../../../vitest.emulator.files"

const SRC = join(__dirname, "../../..")
const SKIP = new Set([__filename, join(SRC, "lib/backend/__tests__/rules-source.ts")])

const swappers = (readdirSync(SRC, { recursive: true }) as string[])
  .filter((f) => /\.tsx?$/.test(f))
  .map((f) => join(SRC, f))
  .filter((f) => !SKIP.has(f) && readFileSync(f, "utf8").includes("loadStorageRules("))
  .map((f) => f.slice(SRC.length - "src".length))

type Project = { test: { include: string[]; fileParallelism?: boolean; globalSetup?: unknown; sequence?: { groupOrder?: number } } }
const projects = (emulatorConfig as unknown as { test: { projects: Project[] } }).test.projects
const order = (p: Project) => p.test.sequence?.groupOrder ?? 0

describe("emulator suite file groups", () => {
  it("finds the files that call loadStorageRules", () => {
    expect(swappers).not.toEqual([])
  })

  it.each(swappers)("%s is listed to run alone, not in parallel", (file) => {
    expect(parallelFiles).not.toContain(file)
    expect(aloneFiles).toContain(file)
  })

  it("lists each file once, and only files that exist", () => {
    const all = [...parallelFiles, ...aloneFiles]
    expect(new Set(all).size).toBe(all.length)
    for (const f of all) expect(() => readFileSync(join(SRC, "..", f))).not.toThrow()
  })

  it("the config runs the alone files after every other project, one at a time", () => {
    const alone = projects.filter((p) => aloneFiles.every((f) => p.test.include.includes(f)))
    expect(alone).toHaveLength(1)
    const others = projects.filter((p) => p !== alone[0])
    expect(others.length).toBeGreaterThan(0)
    for (const p of others) {
      expect(order(alone[0])).toBeGreaterThan(order(p))
      for (const f of swappers) expect(p.test.include).not.toContain(f)
    }
    expect(alone[0].test.fileParallelism).toBe(false)
  })

  it("keeps the global setup on the root config only, so the wipe runs once", () => {
    for (const p of projects) expect(p.test.globalSetup).toBeUndefined()
  })
})
