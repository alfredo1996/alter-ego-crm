/**
 * The UI kit knows nothing of the app: no "@/" alias, no feature code. A file in it
 * imports its own files, node built-ins, the kernel, and the third-party libraries
 * in its package.json (plus react/next peers and the test tooling in devDependencies).
 */
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

const SRC = join(__dirname, "..")
const pkg = JSON.parse(readFileSync(join(SRC, "..", "package.json"), "utf8"))
const declared = [
  ...Object.keys(pkg.dependencies ?? {}),
  ...Object.keys(pkg.peerDependencies ?? {}),
  ...Object.keys(pkg.devDependencies ?? {}),
]

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name)
    if (e.isDirectory()) return sources(p)
    return /\.tsx?$/.test(e.name) && p !== __filename ? [p] : []
  })
}

const allowed = (spec: string) =>
  spec.startsWith("./") ||
  spec.startsWith("../") ||
  spec.startsWith("node:") ||
  spec.startsWith("@alter-ego/kernel/") ||
  declared.some((d) => spec === d || spec.startsWith(d + "/"))

const rel = (f: string) => f.slice(SRC.length + 1)
// from "x", side-effect import "x", dynamic import("x"), vi.mock("x"), either quote.
const specifiers = (f: string) => [...readFileSync(f, "utf8").matchAll(/(?:from|import|mock)\s*\(?\s*["']([@.\w][^"'\s]*)["']/g)].map((m) => m[1])

describe("the UI kit imports only the kernel and its own dependencies", () => {
  const files = sources(SRC)

  it("has files to check", () => {
    expect(files.length).toBeGreaterThan(40)
  })

  it.each(files.map((f) => [rel(f), f]))("%s imports nothing from the app", (_name, f) => {
    expect(specifiers(f).filter((spec) => !allowed(spec))).toEqual([])
  })

  it.each(files.map((f) => [rel(f), f]))("%s never climbs out of the package", (name, f) => {
    const depth = name.split("/").length - 1
    expect(specifiers(f).filter((spec) => (spec.match(/^(?:\.\.\/)+/)?.[0].length ?? 0) / 3 > depth)).toEqual([])
  })
})
