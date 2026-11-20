/**
 * The finance package knows nothing of the app: no "@/" alias, no apps/web, no other module. A
 * file in it imports its own files, node built-ins, the kernel, the UI kit and the libraries in its
 * package.json (peers, react included). Tests may also use its devDependencies. The app hands it the
 * database and the user through provideFinanceHost, so it needs no global.
 */
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

const SRC = join(__dirname, "..")
const pkg = JSON.parse(readFileSync(join(SRC, "..", "package.json"), "utf8"))
const keys = (o: Record<string, string> | undefined) => Object.keys(o ?? {})
const declared = [...keys(pkg.dependencies), ...keys(pkg.peerDependencies)]
const declaredForTests = [...declared, ...keys(pkg.devDependencies)]

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name)
    if (e.isDirectory()) return sources(p)
    return /\.tsx?$/.test(e.name) && p !== __filename ? [p] : []
  })
}

const allowed = (spec: string, from: string[]) =>
  spec.startsWith("./") || spec.startsWith("../") || spec.startsWith("node:") || from.some((d) => spec === d || spec.startsWith(d + "/"))

const rel = (f: string) => f.slice(SRC.length + 1)
// import/export ... from "x", side-effect import "x", import("x"), vi.mock("x"), either quote. Anchored to
// the start of a line, so a string in a test fixture that happens to say "import" is not an import.
const IMPORT = /(?:^(?:import|export)\b[^;"'`]*?\bfrom\s*|^import\s*|\bimport\s*\(\s*|\b(?:doMock|mock|importActual)\s*\(\s*)["']([^"'\n]+)["']/gm
const specifiers = (f: string) => [...readFileSync(f, "utf8").matchAll(IMPORT)].map((m) => m[1])
const isTest = (f: string) => f.includes("__tests__")

describe("the finance package imports only the kernel, the UI kit and its declared dependencies", () => {
  const files = sources(SRC)

  it("has files to check", () => {
    expect(files.length).toBeGreaterThan(150)
  })

  it.each(files.map((f) => [rel(f), f]))("%s imports nothing from the app", (_name, f) => {
    const bad = specifiers(f).filter((spec) => !allowed(spec, isTest(f) ? declaredForTests : declared))
    expect(bad).toEqual([])
  })

  it.each(files.map((f) => [rel(f), f]))("%s never climbs out of the package", (name, f) => {
    const depth = name.split("/").length - 1
    expect(specifiers(f).filter((spec) => (spec.match(/^(?:\.\.\/)+/)?.[0].length ?? 0) / 3 > depth)).toEqual([])
  })

  // firebase and firebase-admin are declared peers (the adapters take their instances), but only the two
  // adapter files may import them: feature code and the MCP tools go through the adapter.
  const inSdk = (spec: string, sdk: string) => spec === sdk || spec.startsWith(sdk + "/")
  it.each(files.filter((f) => !isTest(f)).map((f) => [rel(f), f]))("%s imports the Firebase SDKs only if it is an adapter", (name, f) => {
    const bad = specifiers(f).filter(
      (spec) => (inSdk(spec, "firebase") && name !== "adapter-firebase.ts") || (inSdk(spec, "firebase-admin") && name !== "adapter-admin.ts"),
    )
    expect(bad).toEqual([])
  })

  it.each(files.filter((f) => rel(f).startsWith("mcp/") && !isTest(f)).map((f) => [rel(f), f]))(
    "%s does not reach the Firebase adapters",
    (_name, f) => {
      expect(specifiers(f).filter((spec) => /(^|\/)adapter-(firebase|admin)$/.test(spec))).toEqual([])
    },
  )

  it("declares the workspace packages it imports as workspace dependencies", () => {
    expect([pkg.dependencies["@alter-ego/kernel"], pkg.dependencies["@alter-ego/ui"]]).toEqual(["workspace:*", "workspace:*"])
  })
})
