/**
 * Screenshots of every page and tab with lived-in synthetic data, plus the
 * sign-in pages and a new account's empty pipeline: desktop 1440x900 and phone
 * 390x844, light and dark, full page.
 *
 *   NEXT_PUBLIC_BACKEND=mock pnpm build && pnpm start --port 3001   # or: pnpm dev
 *   pnpm shots --base http://localhost:3001 [--out .shots] [--prefix before-] [/login /clients '/clients/[id]' '/cash-book?tab=summary' ...]
 *
 * Writes <out>/<prefix><page>-<desktop|phone>-<light|dark>.png. The server must
 * run the mock backend: the data is seeded through it (e2e/helpers/demo.ts, the
 * same seed the e2e sideways-scroll sweep uses). Node strips that file's types.
 */
import { mkdirSync } from "node:fs"
import { join, resolve } from "node:path"
import { parseArgs } from "node:util"

import { chromium } from "@playwright/test"

import { DEMO_PAGES, openDemoPage, seedDemo, waitForPage } from "../e2e/helpers/demo.ts"

const { values: opts, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    base: { type: "string", default: "http://localhost:3000" },
    out: { type: "string", default: ".shots" },
    prefix: { type: "string", default: "" },
  },
})
// Shot before the seed, so not in DEMO_PAGES (the sideways-scroll sweep seeds first).
const BEFORE_SEED = ["/register", "/login", "/pipeline-empty"]
const known = [...BEFORE_SEED, ...DEMO_PAGES.map((d) => d.path)]
const unknown = positionals.filter((p) => !known.includes(p))
if (unknown.length) throw new Error(`Unknown page ${unknown.join(", ")}. Pages: ${known.join(" ")}`)
const wanted = (path) => !positionals.length || positionals.includes(path)
const pages = DEMO_PAGES.filter((p) => wanted(p.path))
// pnpm runs this with apps/web as the working directory: a relative --out means "relative to where I typed it"
opts.out = resolve(process.env.INIT_CWD ?? process.cwd(), opts.out)
mkdirSync(opts.out, { recursive: true })

const VIEWPORTS = {
  desktop: { viewport: { width: 1440, height: 900 } },
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
}

// The installed Chrome when there is one: the bundled Chromium may not match this Playwright.
const browser = await chromium.launch({ channel: "chrome" }).catch(() => chromium.launch())

async function capture(device, scheme) {
  const context = await browser.newContext({ ...VIEWPORTS[device], colorScheme: scheme, baseURL: opts.base })
  const page = await context.newPage()
  const cdp = VIEWPORTS[device].hasTouch ? await context.newCDPSession(page) : null
  const shoot = async (path) => {
    await page.waitForTimeout(500) // charts and sheets animate in
    const name = `${opts.prefix}${path.slice(1).replace(/[^a-z0-9]+/gi, "-").replace(/-$/, "")}-${device}-${scheme}.png`
    await page.screenshot({ path: join(opts.out, name), fullPage: true })
    // A full-page screenshot turns Chromium's touch emulation off, and (pointer: coarse) with it:
    // every phone shot after the first lost its 44 px touch targets. Turn it back on.
    await cdp?.send("Emulation.setTouchEmulationEnabled", { enabled: true })
    console.log("wrote", join(opts.out, name))
  }
  for (const path of ["/register", "/login"].filter(wanted)) {
    await page.goto(path)
    // /register is a closed page now (#389): no form to wait for.
    await (path === "/register" ? page.getByRole("heading", { name: "Sign-Up Is Closed" }) : page.getByLabel("Email")).waitFor()
    await shoot(path)
  }
  if (!pages.length && !wanted("/pipeline-empty")) return
  await page.goto("/login")
  await page.getByLabel("Email").fill("test@example.com")
  await page.getByLabel("Password").fill("password123")
  await page.getByRole("button", { name: "Sign In" }).click()
  await page.waitForURL("/pipeline")
  if (wanted("/pipeline-empty")) {
    await waitForPage(page)
    await shoot("/pipeline-empty")
  }
  if (!pages.length) return
  await seedDemo(page)
  for (const demo of pages) {
    await openDemoPage(page, demo)
    await shoot(demo.path)
  }
}

// ponytail: a local Playwright teardown can hang, so exit rather than wait on browser.close().
await Promise.all(["desktop", "phone"].flatMap((d) => ["light", "dark"].map((s) => capture(d, s)))).then(
  () => process.exit(0),
  (e) => {
    console.error(e)
    process.exit(1)
  },
)
