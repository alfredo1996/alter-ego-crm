/**
 * `pnpm setup:owner <uid>` (#32): writes the owner uid into the three places that hold it and
 * rebuilds firestore.rules. Every case runs on a temporary copy of the files, never on the repo.
 */
import { readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { buildRulesAt } from "../../../../../scripts/build-firestore-rules.mjs"
import { PLACEHOLDER, readOwners, setOwner } from "../../../../../scripts/setup-owner.mjs"
import { copyOwnerFiles, OWNER_FILES } from "../backend/__tests__/owner-copy"

const REPO = "../.."
const BASE = "firestore/base.rules"
const STORAGE = "storage.rules"
const TS = "apps/web/src/lib/owner-uid.ts"
const RULES = "firestore.rules"
// Unique per run, so the cases also hold in a copy that already ran `setup:owner` (the placeholder is only the committed state).
const UID = `owner-test-${Date.now()}`

let root: string
const read = (file: string, at = root) => readFileSync(join(at, file), "utf8")
const write = (file: string, text: string) => writeFileSync(join(root, file), text)
const snapshot = () => Object.fromEntries(OWNER_FILES.map((f) => [f, read(f)]))

beforeEach(() => {
  root = copyOwnerFiles()
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe("the committed sources", () => {
  it("hold one value in all three places, and firestore.rules is built from the fragments", () => {
    const { ts, firestore, storage } = readOwners(REPO)
    expect([firestore, storage]).toEqual([ts, ts])
    expect(readFileSync(join(REPO, RULES), "utf8")).toBe(buildRulesAt(REPO).rules)
  })
})

describe("setOwner", () => {
  it("writes the uid into the three sources and rebuilds firestore.rules", () => {
    const { changed } = setOwner(root, UID)
    expect(changed).toEqual([BASE, STORAGE, TS, RULES])
    expect(readOwners(root)).toEqual({ ts: UID, firestore: UID, storage: UID })
    expect(read(RULES)).toBe(buildRulesAt(root).rules)
    expect(read(RULES)).toContain(`request.auth.uid in ['${UID}']`)
  })

  it("keeps the explicit refusal of the placeholder in every place it checks", () => {
    setOwner(root, UID)
    expect(read(BASE)).toContain(`request.auth.uid != '${PLACEHOLDER}'`)
    expect(read(STORAGE)).toContain(`request.auth.uid != '${PLACEHOLDER}'`)
    expect(read(TS)).toContain(`uid !== OWNER_UID_PLACEHOLDER`)
  })

  it("changes nothing the second time with the same uid, and takes a new uid later", () => {
    setOwner(root, UID)
    const first = snapshot()
    expect(setOwner(root, UID).changed).toEqual([])
    expect(snapshot()).toEqual(first)
    setOwner(root, "second-owner")
    expect(readOwners(root)).toEqual({ ts: "second-owner", firestore: "second-owner", storage: "second-owner" })
  })

  it.each([
    ["empty", ""],
    ["a space", "a b"],
    ["a single quote", "a'b"],
    ["a double quote", 'a"b'],
    ["a newline", "a\nb"],
    ["a semicolon", "a;b"],
    ["129 characters", "x".repeat(129)],
    ["the placeholder", PLACEHOLDER],
  ])("refuses a uid with %s and writes nothing", (_, uid) => {
    const before = snapshot()
    expect(() => setOwner(root, uid)).toThrow(/uid/i)
    expect(snapshot()).toEqual(before)
  })

  it.each([BASE, STORAGE, TS])("refuses %s with no owner definition, names it, and writes nothing", (file) => {
    write(file, read(file).replace(/OWNER_UID = "[^"]*"|uid in \['[^']*'\]|uid == '[^']*'/, "removed"))
    const before = snapshot()
    expect(() => setOwner(root, UID)).toThrow(new RegExp(`${file.replace(/\./g, "\\.")}.*found 0`))
    expect(snapshot()).toEqual(before)
  })

  it.each([
    [BASE, /^.*uid in \[.*$/m],
    [STORAGE, /^.*uid == '.*$/m],
    [TS, /^export const OWNER_UID = .*$/m],
  ])("refuses %s with two owner definitions, names it, and writes nothing", (file, line) => {
    write(file, read(file).replace(line, (m) => `${m}\n${m}`))
    const before = snapshot()
    expect(() => setOwner(root, UID)).toThrow(new RegExp(`${file.replace(/\./g, "\\.")}.*found 2`))
    expect(snapshot()).toEqual(before)
  })
})
