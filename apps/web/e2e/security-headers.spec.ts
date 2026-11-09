import { test, expect } from "@playwright/test"

import { signIn } from "./helpers/test-utils"

// #386: zod's JIT (Function probe + compile) tripped script-src 'unsafe-eval' on every page.
test("/login and /settings raise no eval CSP violation", async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __cspEval: string[] }
    w.__cspEval = []
    document.addEventListener("securitypolicyviolation", (e) => {
      if (e.blockedURI === "eval") w.__cspEval.push(e.sourceFile)
    })
  })
  const seen = () => page.evaluate(() => (window as unknown as { __cspEval: string[] }).__cspEval)
  await page.goto("/login")
  await page.getByLabel("Email").waitFor()
  expect(await seen()).toEqual([])
  await signIn(page)
  await page.getByRole("heading", { name: "Settings", level: 1 }).waitFor()
  expect(await seen()).toEqual([])
})

// #347: every page carries the report-only policy and no X-Powered-By.
// page.request, not page.goto: a full load would wipe the mock backend.
for (const path of ["/login", "/register"]) {
  test(`${path} sends a report-only CSP and no x-powered-by`, async ({ page }) => {
    const res = await page.request.get(path)
    const h = res.headers()
    expect(h["content-security-policy-report-only"]).toContain("frame-ancestors 'none'")
    expect(h["content-security-policy-report-only"]).toContain("report-uri /api/csp-report")
    expect(h["content-security-policy"]).toBeUndefined()
    expect(h["x-powered-by"]).toBeUndefined()
  })
}
