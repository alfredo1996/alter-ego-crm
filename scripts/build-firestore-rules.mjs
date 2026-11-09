/**
 * Splices firestore/base.rules + firestore/crm.rules (+ each module's rules) into the firestore.rules
 * that Firebase deploys.
 *
 * Rules have no import mechanism and the CRM collections live *inside*
 * `match /users/{userId}`, so this is a text splice at a marker rather than a
 * concatenation of two whole files.
 *
 * Dropping crm.rules yields valid rules for the shared collections alone: a
 * collection with no matching rule is denied by default, so removal is safe
 * rather than permissive.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs"

const MARKER = "      // @@CRM_COLLECTIONS@@"

/**
 * `rent` is a module's fragment (packages/modules/rent): it goes in right after the CRM's,
 * because a module needs the company side, and it leaves with it.
 * @param {{ base: string, crm: string | null, rent?: string | null }} fragments
 * @returns {string}
 */
export function buildRules({ base, crm, rent = null }) {
  if (!base.includes(MARKER)) {
    throw new Error(`base.rules is missing the ${MARKER.trim()} marker`)
  }
  // No CRM fragment: drop the marker line and the blank line before it.
  return crm === null
    ? base.replace(`\n\n${MARKER}`, "")
    : base.replace(MARKER, () => crm.trimEnd() + (rent ? `\n${rent.trimEnd()}` : "")) // function: a string would expand $-sequences
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const base = readFileSync("firestore/base.rules", "utf8")
  const crm = existsSync("firestore/crm.rules")
    ? readFileSync("firestore/crm.rules", "utf8")
    : null
  const rentPath = "packages/modules/rent/src/rent.rules"
  const rent = crm && existsSync(rentPath) ? readFileSync(rentPath, "utf8") : null
  writeFileSync("firestore.rules", buildRules({ base, crm, rent }))
  console.log(`firestore.rules written (${crm ? "with" : "without"} CRM collections)`)
}
