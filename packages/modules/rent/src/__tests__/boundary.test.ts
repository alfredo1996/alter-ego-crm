/**
 * A module package imports only the kernel, the UI kit and the libraries in its own
 * package.json (its peers, react included): never the app's `@/` alias, never
 * another module. The app hands it `db` and `userId`, so it needs no global.
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

const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"))
const declared = [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.peerDependencies ?? {})]
const allowed = (spec: string) =>
  spec.startsWith("./") || spec.startsWith("../") || spec.startsWith("node:") || declared.some((d) => spec === d || spec.startsWith(d + "/"))

describe("the rent module imports only the kernel, the UI kit and its declared dependencies", () => {
  const files = sources(SRC)

  it("has files to check", () => {
    expect(files.length).toBeGreaterThanOrEqual(10)
  })

  it.each(files.map((f) => [f.slice(SRC.length + 1), f]))("%s imports only its own files and its declared dependencies", (_name, f) => {
    const specs = [...readFileSync(f, "utf8").matchAll(/(?:from|import)\s*\(?\s*["']([@.\w][^"'\s]*)["']/g)].map((m) => m[1])
    expect(specs.filter((spec) => !allowed(spec))).toEqual([])
  })
})
