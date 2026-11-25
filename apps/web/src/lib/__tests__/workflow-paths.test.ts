/**
 * Path filters of the slow workflows (#69): a change to the files that decide which dependency
 * versions are installed must run the emulator suite and the docs build, on the PR and on main.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

// Vitest runs with cwd = apps/web, so the repository root is two levels up.
const ROOT = join(process.cwd(), "../..")

// No YAML parser is a dependency, so read the `paths:` list under one trigger of `on:` as text.
// It relies on the files' layout: triggers at two spaces, `paths:` at four, items at six.
function paths(workflow: string, trigger: "push" | "pull_request"): string[] {
  const lines = readFileSync(join(ROOT, ".github/workflows", workflow), "utf8").split("\n")
  const start = lines.indexOf(`  ${trigger}:`)
  if (start < 0) throw new Error(`${workflow} has no ${trigger} trigger`)
  const out: string[] = []
  let inPaths = false
  for (const line of lines.slice(start + 1)) {
    if (/^ {0,2}\S/.test(line)) break // the next trigger or top-level key ends this one
    if (/^ {4}paths:/.test(line)) inPaths = true
    else if (/^ {4}\S/.test(line)) inPaths = false // a sibling key such as branches:
    else if (inPaths) {
      const item = /^ {6}- "(.+)"/.exec(line)
      if (item) out.push(item[1])
    }
  }
  return out
}

const DEPENDENCY_FILES = ["pnpm-lock.yaml", "package.json", "apps/web/package.json", "pnpm-workspace.yaml"]
const cases = (["firebase-emulator.yml", "docs.yml"] as const).flatMap((workflow) =>
  (["pull_request", "push"] as const).map((trigger) => [workflow, trigger] as const),
)

describe("the slow workflows run on dependency-only changes (#69)", () => {
  it.each(cases)("%s lists the dependency files under %s", (workflow, trigger) => {
    expect(paths(workflow, trigger).filter((p) => DEPENDENCY_FILES.includes(p)).sort()).toEqual(
      [...DEPENDENCY_FILES].sort(),
    )
  })

  it.each(["pull_request", "push"] as const)("firebase-emulator.yml lists itself under %s", (trigger) => {
    expect(paths("firebase-emulator.yml", trigger)).toContain(".github/workflows/firebase-emulator.yml")
  })
})
