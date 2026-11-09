/**
 * A demo user that already has the sample data, in the local Firebase emulator,
 * so it survives reloads: the mock backend forgets everything on a page load.
 *
 *   pnpm dev:emulator                                # or any dev server with NEXT_PUBLIC_USE_EMULATOR=true
 *   pnpm seed:demo [--base http://localhost:3010]
 *
 * Creates DEMO_EMAIL in the Auth emulator (sign-up is closed in the app), signs in
 * and runs the e2e seed (e2e/helpers/demo.ts; Node strips its types) through
 * window.__mockBackend, which an emulator build exposes. A demo user that
 * already has clients is left alone. Then sign in with the values below. The
 * data lasts as long as the emulator's.
 */
import { parseArgs } from "node:util"

import { chromium } from "@playwright/test"

import { seedDemo } from "../e2e/helpers/demo.ts"

// Emulator-only test values: the emulator is project demo-alter-ego, which never reaches a real one.
const DEMO_EMAIL = "demo@alter-ego.test"
const DEMO_PASSWORD = "NdPDKl44GcKaJSabflad"
const DEMO_NAME = "Demo User"

const { values: opts } = parseArgs({ options: { base: { type: "string", default: "http://localhost:3010" } } })

// The installed Chrome when there is one: the bundled Chromium may not match this Playwright.
const browser = await chromium.launch({ channel: "chrome" }).catch(() => chromium.launch())
const page = await browser.newPage({ baseURL: opts.base, viewport: { width: 1440, height: 900 } })

async function run() {
  // Sign-up is closed in the app (#389): create the user in the Auth emulator, then sign in as usual.
  const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9099"
  const signUp = await fetch(`http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-api-key`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: DEMO_EMAIL, password: DEMO_PASSWORD, displayName: DEMO_NAME }),
  })
  if (signUp.ok) console.log(`Created ${DEMO_EMAIL} in the Auth emulator.`)
  else if ((await signUp.json()).error?.message !== "EMAIL_EXISTS") throw new Error(`Cannot create the demo user: ${signUp.status}`)
  await page.goto("/login")
  await page.getByLabel("Email").fill(DEMO_EMAIL)
  await page.getByLabel("Password").fill(DEMO_PASSWORD)
  await page.getByRole("button", { name: "Sign In" }).click()
  await page.waitForURL("**/pipeline")

  const clients = await page.evaluate(async () => {
    const backend = window.__mockBackend
    if (!backend) throw new Error("window.__mockBackend is missing: the server must run on the emulator (NEXT_PUBLIC_USE_EMULATOR=true)")
    const user = await backend.auth.getCurrentUser()
    return (await backend.db.getClients(user.id)).length
  })
  if (clients) {
    console.log(`${DEMO_EMAIL} already has ${clients} clients: not seeding twice.`)
    return
  }

  await seedDemo(page)
  console.log(`Seeded ${DEMO_EMAIL}: sign in at ${opts.base}/login with the password in scripts/seed-demo.mjs.`)
}

// ponytail: a local Playwright teardown can hang, so exit rather than wait on browser.close().
await run().then(
  () => process.exit(0),
  (e) => {
    console.error(e)
    process.exit(1)
  },
)
