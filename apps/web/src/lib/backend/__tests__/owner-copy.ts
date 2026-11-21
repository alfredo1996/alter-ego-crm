/**
 * Test-only: a throwaway copy of the files `pnpm setup:owner` edits (#32), so a test can set an
 * owner on it and never touch the repo. Paths are from apps/web, where Vitest runs.
 */
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { setOwner } from "../../../../../../scripts/setup-owner.mjs"

const REPO = "../.."
export const OWNER_FILES = [
  "firestore/base.rules", "storage.rules", "apps/web/src/lib/owner-uid.ts", "firestore.rules",
  "firestore/crm.rules",
  "packages/modules/rent/src/rent.rules",
  "packages/modules/finance/src/finance.rules",
  "packages/modules/finance/src/finance-root.rules",
]

/** Copies the owner files to a new temp directory; the caller removes it. */
export function copyOwnerFiles(): string {
  const root = mkdtempSync(join(tmpdir(), "owner-copy-"))
  for (const f of OWNER_FILES) {
    mkdirSync(dirname(join(root, f)), { recursive: true })
    cpSync(join(REPO, f), join(root, f))
  }
  return root
}

/** The Firestore and Storage rules a deployment gets after `setup:owner <uid>`. */
export function rulesFor(uid: string): { firestore: string; storage: string } {
  const root = copyOwnerFiles()
  try {
    setOwner(root, uid)
    return { firestore: readFileSync(join(root, "firestore.rules"), "utf8"), storage: readFileSync(join(root, "storage.rules"), "utf8") }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}
