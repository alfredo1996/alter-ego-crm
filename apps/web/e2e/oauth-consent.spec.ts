import { test, expect } from "@playwright/test"

// The query's redirect_uri is attacker-supplied. In the mock build no client is
// registered, so every pair is unregistered: the page must say so and go nowhere.
test("the consent page refuses a javascript: redirect_uri and stays on the app", async ({ page }) => {
  const consent =
    "/oauth/authorize?client_id=c1&response_type=code&code_challenge=abc&code_challenge_method=S256&state=s" +
    `&redirect_uri=${encodeURIComponent("javascript:alert(document.domain)//")}`

  await page.goto(`/login?next=${encodeURIComponent(consent)}`)
  await page.getByLabel("Email").fill("test@example.com")
  await page.getByLabel("Password", { exact: true }).fill("password123")
  await page.getByRole("button", { name: "Sign In" }).click()

  await expect(page.getByText("This connector's return address isn't registered.")).toBeVisible()
  await expect(page.getByRole("button", { name: "Deny" })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Approve" })).toHaveCount(0)
  expect(new URL(page.url()).pathname).toBe("/oauth/authorize")
})

test("the consent page offers no Approve when the requested scope grants nothing", async ({ page }) => {
  for (const scope of ["%20", "read"]) {
    const consent =
      `/oauth/authorize?client_id=c1&response_type=code&code_challenge=abc&code_challenge_method=S256&state=s&scope=${scope}` +
      `&redirect_uri=${encodeURIComponent("https://claude.ai/cb")}`

    await page.goto(`/login?next=${encodeURIComponent(consent)}`)
    await page.getByLabel("Email").fill("test@example.com")
    await page.getByLabel("Password", { exact: true }).fill("password123")
    await page.getByRole("button", { name: "Sign In" }).click()

    await expect(page.getByRole("alert").filter({ hasText: "no access" })).toHaveText("This request asks for no access that can be granted.")
    await expect(page.getByRole("button", { name: "Approve" })).toHaveCount(0)
  }
})
