/**
 * CLAUDE.md: "NEVER import Firebase directly in feature code." The MCP tools did,
 * in four places, which quietly made the whole MCP server Firebase-only — running
 * it on any other backend reached for the Admin SDK regardless.
 *
 * This is the guard, not a re-test of the routing: it fails the moment a tool file
 * reaches past the adapter again.
 */
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

const TOOLS_DIR = "src/lib/mcp/tools"
const ROUTE = "src/app/api/mcp/route.ts"

const sourceFiles = [
  ...readdirSync(TOOLS_DIR)
    .filter((f) => f.endsWith(".ts"))
    .map((f) => join(TOOLS_DIR, f)),
  ROUTE,
]

describe("MCP tools reach the database through the adapter", () => {
  it.each(sourceFiles)("%s does not import firebase-admin", (file) => {
    expect(readFileSync(file, "utf8")).not.toContain("@/lib/backend/firebase-admin")
  })

  // The Firebase client SDK would be worse than the Admin one: capacity and
  // mcp_audit are `allow read, write: if false`, so it cannot work at all.
  it.each(sourceFiles)("%s does not import the Firebase client either", (file) => {
    const src = readFileSync(file, "utf8")
    expect(src).not.toContain("@/lib/backend/firebase\"")
    expect(src).not.toContain("firebase/firestore")
  })
})
