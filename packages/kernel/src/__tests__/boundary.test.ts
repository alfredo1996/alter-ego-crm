/**
 * The kernel is what every product and module may lean on, so it leans on nothing of
 * theirs: no app alias, no other workspace package. Its only imports are its own files,
 * node built-ins and the third-party libraries in its package.json.
 */
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

const SRC = join(__dirname, "..")
const ROOT = join(SRC, "..")

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name)
    if (e.isDirectory()) return e.name === "__tests__" ? [] : sources(p)
    return /\.tsx?$/.test(e.name) ? [p] : []
  })
}

const declared = Object.keys(JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).dependencies ?? {})
const allowed = (spec: string) =>
  spec.startsWith("./") || spec.startsWith("node:") || declared.some((d) => spec === d || spec.startsWith(d + "/"))

describe("the kernel imports nothing app-side", () => {
  const files = sources(SRC)

  it("has files to check", () => {
    expect(files.length).toBeGreaterThanOrEqual(3)
  })

  it.each(files.map((f) => [f.slice(SRC.length + 1), f]))("%s imports only its own files and its declared dependencies", (_name, f) => {
    const specs = [...readFileSync(f, "utf8").matchAll(/(?:from|import)\s*\(?\s*["']([@.\w][^"'\s]*)["']/g)].map((m) => m[1])
    expect(specs.filter((spec) => !allowed(spec))).toEqual([])
  })
})
