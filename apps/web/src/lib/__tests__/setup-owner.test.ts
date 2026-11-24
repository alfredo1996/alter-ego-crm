/**
 * `pnpm setup:owner <uid>` (#32): writes the owner uid into the three places that hold it and
 * rebuilds firestore.rules. Every case runs on a temporary copy of the files, never on the repo.
 */
import { spawnSync } from "node:child_process"
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
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
    write(file, read(file).replace(/OWNER_UID: string = "[^"]*"|uid in \['[^']*'\]|uid == '[^']*'/, "removed"))
    const before = snapshot()
    expect(() => setOwner(root, UID)).toThrow(new RegExp(`${file.replace(/\./g, "\\.")}.*found 0`))
    expect(snapshot()).toEqual(before)
  })

  it.each([
    [BASE, /^.*uid in \[.*$/m],
    [STORAGE, /^.*uid == '.*$/m],
    [TS, /^export const OWNER_UID: string = .*$/m],
  ])("refuses %s with two owner definitions, names it, and writes nothing", (file, line) => {
    write(file, read(file).replace(line, (m) => `${m}\n${m}`))
    const before = snapshot()
    expect(() => setOwner(root, UID)).toThrow(new RegExp(`${file.replace(/\./g, "\\.")}.*found 2`))
    expect(snapshot()).toEqual(before)
  })

  it("writes nothing and names the file when the rules cannot be built", () => {
    const gone = "packages/modules/finance/src/finance-root.rules"
    rmSync(join(root, gone))
    const kept = OWNER_FILES.filter((f) => f !== gone)
    const before = kept.map((f) => read(f))
    expect(() => setOwner(root, UID)).toThrow(/finance-root\.rules/)
    expect(kept.map((f) => read(f))).toEqual(before)
  })
})

// The command people run, from a clone whose path has a space (import.meta.url percent-encodes it).
describe("pnpm setup:owner, the command line", () => {
  let spaced: string
  beforeEach(() => {
    spaced = mkdtempSync(join(tmpdir(), "owner cli-"))
    for (const f of [...OWNER_FILES, "scripts/setup-owner.mjs", "scripts/build-firestore-rules.mjs"]) {
      mkdirSync(join(spaced, f, ".."), { recursive: true })
      cpSync(join(REPO, f), join(spaced, f))
    }
  })
  afterEach(() => rmSync(spaced, { recursive: true, force: true }))
  const run = (...args: string[]) => spawnSync(process.execPath, ["scripts/setup-owner.mjs", ...args], { cwd: spaced, encoding: "utf8" })

  it("sets the owner and exits 0 for a good uid", () => {
    const r = run(UID)
    expect([r.status, r.stdout]).toEqual([0, expect.stringContaining(`Owner set to ${UID}`)])
    expect(readOwners(spaced)).toEqual({ ts: UID, firestore: UID, storage: UID })
  })

  it.each([[[]], [[""]], [["a", "b"]], [["a'b"]], [[PLACEHOLDER]]])("exits 1 with a message and writes nothing for %j", (args) => {
    const before = OWNER_FILES.map((f) => read(f, spaced))
    const r = run(...args)
    expect([r.status, r.stderr.length > 0]).toEqual([1, true])
    expect(OWNER_FILES.map((f) => read(f, spaced))).toEqual(before)
  })
})
