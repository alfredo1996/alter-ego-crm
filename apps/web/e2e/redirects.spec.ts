import { test, expect } from "@playwright/test"

// The company pages moved to English slugs. Old bookmarks must land on the new
// page, keeping the rest of the path and the query. page.request, not page.goto:
// a full load would wipe the mock backend, and the 308 itself is what matters.
const MOVED = [
  ["clienti", "clients"],
  ["attivita", "tasks"],
  ["piano", "plan"],
  ["scadenze", "deadlines"],
  ["costi", "costs"],
]

for (const [from, to] of MOVED) {
  test(`/${from} redirects permanently to /${to}`, async ({ page }) => {
    const bare = await page.request.get(`/${from}`, { maxRedirects: 0 })
    expect(bare.status()).toBe(308)
    expect(bare.headers().location).toBe(`/${to}`)

    const nested = await page.request.get(`/${from}/x?y=1`, { maxRedirects: 0 })
    expect(nested.status()).toBe(308)
    expect(nested.headers().location).toBe(`/${to}/x?y=1`)
  })
}

// Hours moved onto /plan. Temporary (307), so browsers never cache it, and the
// week a link points at comes along.
test("/hours redirects temporarily to /plan, keeping the week", async ({ page }) => {
  const bare = await page.request.get("/hours", { maxRedirects: 0 })
  expect(bare.status()).toBe(307)
  expect(bare.headers().location).toBe("/plan")

  const week = await page.request.get("/hours?week=2026-09-28", { maxRedirects: 0 })
  expect(week.status()).toBe(307)
  expect(week.headers().location).toBe("/plan?week=2026-09-28")
})
