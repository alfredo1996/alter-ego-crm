/**
 * Loads the production Firestore rules into the local emulator with the owner
 * allowlist opened (#389): local users have throwaway uids, not the owner's.
 * Run by `pnpm local:start`; run it again after `pnpm rules:build`.
 */
import { loadRules, testRules } from "../src/lib/backend/__tests__/rules-source"

const host = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080"
const project = process.env.GCLOUD_PROJECT ?? "demo-alter-ego"
loadRules(host, project, testRules()).then(
  () => console.log(`Loaded the rules into ${project} at ${host}, allowlist open.`),
  (e) => {
    console.error(e)
    process.exit(1)
  },
)
