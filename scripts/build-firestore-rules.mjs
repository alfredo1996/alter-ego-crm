/**
 * Splices firestore/base.rules + firestore/crm.rules (+ each module's rules) into the firestore.rules
 * that Firebase deploys.
 *
 * Rules have no import mechanism and the collections live *inside*
 * `match /users/{userId}`, so this is a text splice at a marker rather than a
 * concatenation of whole files. Two markers:
 *  - `// @@CRM_COLLECTIONS@@`, inside `match /users/{userId}`: the CRM's collections, then Rent's,
 *    then Personal Finance's collections and the validators they call;
 *  - `// @@ROOT_COLLECTIONS@@`, at the top level: Personal Finance's read-only system categories,
 *    which the host seeds.
 *
 * Dropping crm.rules yields valid rules for the shared collections and Finance's alone: a
 * collection with no matching rule is denied by default, so removal is safe
 * rather than permissive. Finance needs no company side, so its two fragments are required.
 */
import { readFileSync, writeFileSync, existsSync, realpathSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

const MARKER = "      // @@CRM_COLLECTIONS@@"
const ROOT_MARKER = "    // @@ROOT_COLLECTIONS@@"

/**
 * `rent` is a module's fragment (packages/modules/rent): it goes in right after the CRM's,
 * because a module needs the company side, and it leaves with it. `finance` and `financeRoot` are
 * packages/modules/finance's two fragments (src/finance.rules, src/finance-root.rules): the first goes
 * last at the users-level marker, the second at the top-level one. Neither may be missing or empty.
 * @param {{ base: string, crm: string | null, rent?: string | null, finance: string, financeRoot: string }} fragments
 * @returns {string}
 */
export function buildRules({ base, crm, rent = null, finance, financeRoot }) {
  for (const marker of [MARKER, ROOT_MARKER]) {
    if (!base.includes(marker)) throw new Error(`base.rules is missing the ${marker.trim()} marker`)
  }
  if (!finance?.trim()) throw new Error("finance.rules is empty")
  if (!financeRoot?.trim()) throw new Error("finance-root.rules is empty")
  const company = crm === null ? "" : crm.trimEnd() + (rent ? `\n${rent.trimEnd()}` : "")
  const users = company ? `${company}\n\n${finance.trimEnd()}` : finance.trimEnd()
  // functions: a string replacement would expand $-sequences
  return base.replace(MARKER, () => users).replace(ROOT_MARKER, () => financeRoot.trimEnd())
}

/**
 * Reads the fragments under `root` and builds the rules (the CRM and Rent fragments are optional).
 * @param {string} root
 * @param {string} [baseText] base.rules content to use instead of reading it (setup:owner builds before it writes)
 * @returns {{ rules: string, withCrm: boolean }}
 */
export function buildRulesAt(root = ".", baseText) {
  const at = (/** @type {string} */ p) => join(root, p)
  const base = baseText ?? readFileSync(at("firestore/base.rules"), "utf8")
  const crm = existsSync(at("firestore/crm.rules")) ? readFileSync(at("firestore/crm.rules"), "utf8") : null
  const rentPath = at("packages/modules/rent/src/rent.rules")
  const rent = crm && existsSync(rentPath) ? readFileSync(rentPath, "utf8") : null
  const finance = readFileSync(at("packages/modules/finance/src/finance.rules"), "utf8")
  const financeRoot = readFileSync(at("packages/modules/finance/src/finance-root.rules"), "utf8")
  return { rules: buildRules({ base, crm, rent, finance, financeRoot }), withCrm: crm !== null }
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const { rules, withCrm } = buildRulesAt()
  writeFileSync("firestore.rules", rules)
  console.log(`firestore.rules written (${withCrm ? "with" : "without"} CRM collections)`)
}
