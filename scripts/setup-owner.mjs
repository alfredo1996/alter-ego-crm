/**
 * `pnpm setup:owner <uid>` (#32): writes the owner's Firebase uid into the three places that hold
 * it, then rebuilds firestore.rules. The public code carries the placeholder, which admits nobody.
 *
 *  - apps/web/src/lib/owner-uid.ts   `export const OWNER_UID = "<uid>"`  (the Admin SDK routes)
 *  - firestore/base.rules            `request.auth.uid in ['<uid>']`
 *  - storage.rules                   `request.auth.uid == '<uid>'`
 *
 * All or nothing: every file must hold exactly one definition, or nothing is written. Each pattern
 * is anchored on the definition, not on the value, because the placeholder is also named by the
 * explicit refusal next to it. Re-runnable: it matches whatever is there now.
 */
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { buildRulesAt } from "./build-firestore-rules.mjs"

export const PLACEHOLDER = "OWNER_UID_NOT_SET"
/** A Firebase uid is up to 128 characters; these are safe inside a rules string and a TS string. */
const UID = /^[A-Za-z0-9_-]{1,128}$/

const SOURCES = [
  { file: "firestore/base.rules", key: "firestore", pattern: /(request\.auth\.uid in \[')([^']*)('\])/g },
  { file: "storage.rules", key: "storage", pattern: /(request\.auth\.uid == ')([^']*)(')/g },
  { file: "apps/web/src/lib/owner-uid.ts", key: "ts", pattern: /(export const OWNER_UID = ")([^"]*)(")/g },
]

/** @param {string} root @param {(typeof SOURCES)[number]} src */
function load(root, src) {
  const text = readFileSync(join(root, src.file), "utf8")
  const found = [...text.matchAll(src.pattern)]
  if (found.length !== 1) throw new Error(`${src.file}: expected exactly one owner definition, found ${found.length}`)
  return { text, value: found[0][2] }
}

/**
 * The value each source holds now.
 * @param {string} root
 * @returns {{ firestore: string, storage: string, ts: string }}
 */
export function readOwners(root = ".") {
  return /** @type {any} */ (Object.fromEntries(SOURCES.map((s) => [s.key, load(root, s).value])))
}

/**
 * Sets the owner under `root`; throws, writing nothing, on a bad uid or a file without exactly one definition.
 * @param {string} root
 * @param {string} uid
 * @returns {{ changed: string[] }} the files whose content changed
 */
export function setOwner(root, uid) {
  if (uid === PLACEHOLDER) throw new Error(`The uid is the placeholder ${PLACEHOLDER}: pass your Firebase uid`)
  if (!UID.test(uid)) throw new Error("The uid must be 1 to 128 letters, digits, '-' or '_' (your Firebase uid)")
  const next = SOURCES.map((s) => {
    const { text } = load(root, s)
    return { file: s.file, text, out: text.replace(s.pattern, (_, a, __, c) => `${a}${uid}${c}`) }
  })
  const changed = next.filter((n) => n.out !== n.text)
  for (const n of changed) writeFileSync(join(root, n.file), n.out)
  // The rules are built from the base just written, and only rewritten when they differ.
  const rulesFile = join(root, "firestore.rules")
  const rules = buildRulesAt(root).rules
  if (rules !== readFileSync(rulesFile, "utf8")) {
    writeFileSync(rulesFile, rules)
    return { changed: [...changed.map((n) => n.file), "firestore.rules"] }
  }
  return { changed: changed.map((n) => n.file) }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const uid = process.argv[2]
    if (!uid || process.argv.length > 3) throw new Error("Usage: pnpm setup:owner <uid>")
    const { changed } = setOwner(".", uid)
    console.log(changed.length ? `Owner set to ${uid}. Changed:\n${changed.map((f) => `  ${f}`).join("\n")}` : `Owner already ${uid}: nothing changed`)
  } catch (e) {
    console.error(e instanceof Error ? e.message : e)
    process.exit(1)
  }
}
