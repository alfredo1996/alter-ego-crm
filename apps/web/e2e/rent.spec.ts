import { test, expect, type Page } from "@playwright/test"

import { signIn, navigateTo, uniqueName } from "./helpers/test-utils"

import type { BackendAdapter } from "@/lib/backend"

/**
 * Rent on the mock backend: a tenant and a yearly lease are created, the lease is renewed
 * into the next year, and the renewal is ended early. The leases run Jan 1 to Dec 31 of
 * this year, so the year picker has a stable answer whatever day the spec runs.
 */
test.describe("Rent", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
  })

  test("creates a tenant and a lease, renews it, ends the renewal", async ({ page }) => {
    const year = new Date().getFullYear()
    const house = uniqueName("Via Test")
    const surname = uniqueName("Rossi")
    const tenant = `Marta ${surname}`

    await navigateTo(page, "Rent", "/rent")
    await expect(page.getByRole("heading", { name: "Rent", level: 1 })).toBeVisible()

    // New Tenant
    await page.getByRole("button", { name: "New Tenant" }).click()
    const tenantDialog = page.getByRole("dialog", { name: "New Tenant" })
    await tenantDialog.getByLabel("First Name").fill("Marta")
    await tenantDialog.getByLabel("Surname").fill(surname)
    await tenantDialog.getByLabel("Tax ID").fill("FOREIGN-123")
    await tenantDialog.getByLabel("Street and Number").fill("Gedimino pr. 12")
    await tenantDialog.getByLabel("Postcode").fill("01103")
    await tenantDialog.getByLabel("City").fill("Vilnius")
    await tenantDialog.getByLabel("Country").fill("Lithuania")
    await tenantDialog.getByRole("button", { name: "Save" }).click()
    await expect(tenantDialog).toBeHidden()

    // New Lease, in a house that does not exist yet
    await page.getByRole("button", { name: "New Lease" }).click()
    const leaseDialog = page.getByRole("dialog", { name: "New Lease" })
    await leaseDialog.getByRole("combobox", { name: "Tenant" }).click()
    await page.getByRole("option", { name: tenant }).click()
    await expect(leaseDialog.getByRole("combobox", { name: "Tenant" })).toHaveText(tenant)
    await leaseDialog.getByRole("combobox", { name: "Property" }).click()
    await leaseDialog.getByRole("combobox", { name: "Property" }).fill(house)
    await expect(page.getByRole("option", { name: `Add “${house}” as a new house` })).toBeVisible()
    await leaseDialog.getByLabel("Room").fill("Room 1")
    await leaseDialog.getByLabel("Rent a Month").fill("1050")
    await leaseDialog.getByLabel("Contribution a Month (optional)").fill("150")
    await leaseDialog.getByLabel("Paid By (optional)").fill("Petra Rossi")
    await leaseDialog.getByLabel("Start").fill(`${year}-01-01`)
    await leaseDialog.getByLabel("End").fill(`${year}-12-31`)
    await leaseDialog.getByRole("button", { name: "Save" }).click()
    await expect(leaseDialog).toBeHidden()

    const block = page.getByRole("region", { name: house })
    await expect(block).toContainText(tenant)
    await expect(block).toContainText("Room 1")
    await expect(block).toContainText("€1,050 + €150 contribution · paid by Petra Rossi")
    await expect(block).toContainText(`Jan ${year} – Dec ${year}`)

    // Renew: starts the day after the end, in the next year
    await block.getByRole("button", { name: `Edit lease of ${tenant}, Room 1` }).click()
    await page.getByRole("dialog", { name: "Edit Lease" }).getByRole("button", { name: "Renew" }).click()
    const renew = page.getByRole("dialog", { name: "Renew Lease" })
    await expect(renew.getByLabel("Start")).toHaveValue(`${year + 1}-01-01`)
    await expect(renew.getByLabel("End")).toHaveValue(`${year + 1}-12-31`)
    await expect(renew.getByLabel("Rent a Month")).toHaveValue("1050")
    await renew.getByLabel("Rent a Month").fill("1100")
    await renew.getByRole("button", { name: "Renew" }).click()
    await expect(renew).toBeHidden()

    await page.getByRole("button", { name: "Next year" }).click()
    const next = page.getByRole("region", { name: house })
    await expect(next).toContainText("€1,100 + €150 contribution")
    await expect(next).toContainText(`Jan ${year + 1} – Dec ${year + 1}`)

    // End Tenancy: the renewal ends in March
    await next.getByRole("button", { name: `Edit lease of ${tenant}, Room 1` }).click()
    await page.getByRole("dialog", { name: "Edit Lease" }).getByRole("button", { name: "End Tenancy" }).click()
    const end = page.getByRole("dialog", { name: "End Tenancy" })
    await end.getByLabel("Last Day").fill(`${year + 1}-03-31`)
    await end.getByRole("button", { name: "End Tenancy" }).click()
    await expect(end).toBeHidden()
    await expect(next).toContainText(`Jan ${year + 1} – Mar ${year + 1}`)

    // The first lease still shows in its own year, and the house is in no year after.
    await page.getByRole("button", { name: "Previous year" }).click()
    await expect(page.getByRole("region", { name: house })).toContainText(`Jan ${year} – Dec ${year}`)
    await page.getByRole("button", { name: "Next year" }).click()
    await page.getByRole("button", { name: "Next year" }).click()
    await expect(page.getByText(`No leases in ${year + 2}`)).toBeVisible()
  })

  test("a tenant and a lease save before the tax ID, address and room are known, and the row says what is not set", async ({ page }) => {
    const year = new Date().getFullYear()
    const house = uniqueName("Via Test")
    const surname = uniqueName("Neri")
    const tenant = `Bea ${surname}`

    await navigateTo(page, "Rent", "/rent")
    await page.getByRole("button", { name: "New Tenant" }).click()
    const tenantDialog = page.getByRole("dialog", { name: "New Tenant" })
    await tenantDialog.getByLabel("First Name").fill("Bea")
    await tenantDialog.getByLabel("Surname").fill(surname)
    await tenantDialog.getByRole("button", { name: "Save" }).click()
    await expect(tenantDialog).toBeHidden()

    await page.getByRole("button", { name: "New Lease" }).click()
    const leaseDialog = page.getByRole("dialog", { name: "New Lease" })
    await leaseDialog.getByRole("combobox", { name: "Tenant" }).click()
    await page.getByRole("option", { name: tenant }).click()
    await leaseDialog.getByRole("combobox", { name: "Property" }).click()
    await leaseDialog.getByRole("combobox", { name: "Property" }).fill(house)
    await leaseDialog.getByLabel("Rent a Month").fill("900")
    await leaseDialog.getByLabel("Start").fill(`${year}-01-01`)
    await leaseDialog.getByLabel("End").fill(`${year}-12-31`)
    await leaseDialog.getByRole("button", { name: "Save" }).click()
    await expect(leaseDialog).toBeHidden()

    const block = page.getByRole("region", { name: house })
    await expect(block).toContainText("1 lease · room not set")
    await expect(block.getByRole("button", { name: `Edit lease of ${tenant}`, exact: true })).toBeVisible()
    await block.getByRole("button", { name: `${tenant}: Not set: room, tax ID, residence` }).click()
    await expect(page.getByRole("dialog", { name: "Edit Lease" })).toBeVisible()
  })

  test("a tenant added from New Lease is picked, and Escape closes only the property list", async ({ page }) => {
    const surname = uniqueName("Bianchi")
    await navigateTo(page, "Rent", "/rent")

    await page.getByRole("button", { name: "New Lease" }).click()
    const leaseDialog = page.getByRole("dialog", { name: "New Lease" })
    await leaseDialog.getByLabel("Room").fill("Room 9")
    await leaseDialog.getByRole("button", { name: "New Tenant" }).click()
    const tenantDialog = page.getByRole("dialog", { name: "New Tenant" })
    await tenantDialog.getByLabel("First Name").fill("Greta")
    await tenantDialog.getByLabel("Surname").fill(surname)
    await tenantDialog.getByLabel("Tax ID").fill("FOREIGN-456")
    await tenantDialog.getByLabel("Street and Number").fill("Gedimino pr. 12")
    await tenantDialog.getByLabel("Postcode").fill("01103")
    await tenantDialog.getByLabel("City").fill("Vilnius")
    await tenantDialog.getByLabel("Country").fill("Lithuania")
    await tenantDialog.getByRole("button", { name: "Save" }).click()
    await expect(tenantDialog).toBeHidden()
    await expect(leaseDialog.getByRole("combobox", { name: "Tenant" })).toHaveText(`Greta ${surname}`)
    await expect(leaseDialog.getByLabel("Room")).toHaveValue("Room 9")

    // Escape with the list open closes the list; the dialog and what was typed stay.
    const property = leaseDialog.getByRole("combobox", { name: "Property" })
    await property.fill("Via Nuova")
    await expect(page.getByRole("listbox")).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(page.getByRole("listbox")).toBeHidden()
    await expect(leaseDialog).toBeVisible()
    await expect(property).toHaveValue("Via Nuova")
    await page.keyboard.press("Escape")
    await expect(leaseDialog).toBeHidden()
  })
})

/**
 * Who paid, on the mock backend. The lease runs from 1 Jan last year to 31 Dec this year, so last
 * year's months have all ended and are Missing whatever day the spec runs. The account and the
 * lease are seeded through the mock backend (a full page load would wipe it).
 */
async function seedLease(page: Page, house: string, surname: string) {
  await page.evaluate(
    async ({ house, surname }) => {
      const backend = (window as Window & { __mockBackend?: BackendAdapter }).__mockBackend
      if (!backend) throw new Error("window.__mockBackend is missing: the e2e server must run the mock backend")
      const user = await backend.auth.getCurrentUser()
      if (!user) throw new Error("not signed in")
      const year = new Date().getFullYear()
      await backend.db.createCompanyAccount(user.id, { name: "Bank One", openingBalance: 0, openingDate: new Date(year - 1, 0, 1) })
      const t = await backend.db.createTenant(user.id, {
        firstName: "Marco", surname, taxId: "TX-1", street: "Gedimino pr. 12", postcode: "01103", city: "Vilnius", country: "Lithuania",
      })
      await backend.db.createLease(user.id, {
        tenantId: t.id, property: house, room: "Room 4", rent: 950, contribution: 150, startDate: `${year - 1}-01-01`, endDate: `${year}-12-31`,
      })
    },
    { house, surname },
  )
}

test.describe("Rent: who paid", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
  })

  test("Owed counts a lease that ended last year, though the year shown has no lease", async ({ page }) => {
    const house = uniqueName("Via Aurora")
    const surname = uniqueName("Kowalczyk")
    await page.evaluate(async ({ house, surname }) => {
      const backend = (window as Window & { __mockBackend?: BackendAdapter }).__mockBackend
      const user = await backend?.auth.getCurrentUser()
      if (!backend || !user) throw new Error("the e2e server must run the mock backend, signed in")
      const year = new Date().getFullYear()
      const t = await backend.db.createTenant(user.id, { firstName: "Dana", surname, taxId: "TX-2", street: "Gedimino pr. 12", postcode: "01103", city: "Vilnius", country: "Lithuania" })
      await backend.db.createLease(user.id, { tenantId: t.id, property: house, room: "Room 1", rent: 500, contribution: null, startDate: `${year - 1}-01-01`, endDate: `${year - 1}-12-31` })
    }, { house, surname })
    await navigateTo(page, "Rent", "/rent") // no reload: the mock keeps its data
    await expect(page.getByText("No leases in")).toBeVisible()
    await expect(page.getByText("Owed €6,000")).toBeVisible()
  })

  test("Record Payment from a Missing cell makes the month Paid and adds two Cash Book rows", async ({ page }) => {
    const year = new Date().getFullYear() - 1
    const surname = uniqueName("Gallo")
    const tenant = `Marco ${surname}`
    await seedLease(page, uniqueName("Via Aurora 7"), surname)
    await navigateTo(page, "Rent", "/rent")

    await page.getByRole("button", { name: "Previous year" }).click()
    await expect(page.getByText(String(year), { exact: true })).toBeVisible()
    await page.getByRole("button", { name: `${tenant}, December: missing` }).click()
    await page.getByRole("dialog", { name: `December ${year}` }).getByRole("button", { name: "Record Payment" }).click()
    const payment = page.getByRole("dialog", { name: "Record Payment" })
    await expect(payment.getByLabel("Rent", { exact: true })).toHaveValue("950")
    await expect(payment.getByLabel("Contribution")).toHaveValue("150")
    await payment.getByLabel("Invoice Number (optional)").fill("21/26")
    await payment.getByRole("button", { name: "Record Payment" }).click()
    await expect(payment).toBeHidden()

    await expect(page.getByRole("button", { name: `${tenant}, December: paid` })).toBeVisible()

    // Two rows in the Cash Book, dated today, one per part.
    await navigateTo(page, "Cash Book", "/cash-book")
    await expect(page.getByText(`Rent December ${year}, Room 4`)).toBeVisible()
    await expect(page.getByText(`Contribution December ${year}, Room 4`)).toBeVisible()
  })

  test("a rent row entered in the Cash Book counts on the grid for the month it covers", async ({ page }) => {
    const house = uniqueName("Via Aurora 7")
    const surname = uniqueName("Gallo")
    const tenant = `Marco ${surname}`
    const month = new Date().toLocaleString("en", { month: "long" })
    await seedLease(page, house, surname)
    await navigateTo(page, "Cash Book", "/cash-book")

    await page.getByRole("button", { name: "Add Movement" }).click()
    const dialog = page.getByRole("dialog", { name: "Add Movement" })
    await dialog.getByRole("button", { name: "In", exact: true }).click()
    await dialog.getByRole("combobox", { name: "Type" }).click()
    await page.getByRole("option", { name: "Rent & Other Income" }).click()
    await dialog.getByLabel("Amount").fill("950")
    await dialog.getByLabel("Cost Centre (optional)").fill(house)
    await dialog.getByRole("combobox", { name: "Lease (optional)" }).click()
    await page.getByRole("option", { name: `${tenant} · Room 4` }).click()
    await expect(dialog.getByRole("combobox", { name: "For Month" })).toContainText(month)
    await dialog.getByRole("button", { name: "Save", exact: true }).click()
    await expect(dialog).toBeHidden()

    // 950 of 1,100: the month is short of the contribution until the rest is paid.
    await navigateTo(page, "Rent", "/rent")
    await expect(page.getByRole("button", { name: `${tenant}, ${month}: €150 short` })).toBeVisible()
  })

  /** Receives a deposit in the Cash Book under `who`, linked to the seeded lease. */
  async function receiveDeposit(page: Page, o: { house: string; tenant: string; who: string }) {
    await navigateTo(page, "Cash Book", "/cash-book")
    await page.getByRole("button", { name: "Add Movement" }).click()
    const received = page.getByRole("dialog", { name: "Add Movement" })
    await received.getByRole("button", { name: "In", exact: true }).click()
    await received.getByRole("combobox", { name: "Type" }).click()
    await page.getByRole("option", { name: "Deposit Received" }).click()
    await received.getByLabel("Amount").fill("1500")
    await received.getByLabel("Whose Deposit").fill(o.who)
    await received.getByLabel("Cost Centre (optional)").fill(o.house)
    await received.getByRole("combobox", { name: "Lease" }).click()
    await page.getByRole("option", { name: `${o.tenant} · Room 4` }).click()
    await expect(received.getByText("For Month")).toHaveCount(0) // a deposit is for a lease, not a month
    await received.getByRole("button", { name: "Save", exact: true }).click()
    await expect(received).toBeHidden()
  }

  test("End Tenancy opens Add Movement filled in to give the deposit back: the lease then holds nothing", async ({ page }) => {
    const year = new Date().getFullYear()
    const house = uniqueName("Via Aurora 7")
    const surname = uniqueName("Gallo")
    const tenant = `Marco ${surname}`
    const who = `Room 4 ${surname}` // the name the deposit came in under, not the tenant's
    await seedLease(page, house, surname)
    await receiveDeposit(page, { house, tenant, who })

    await page.getByRole("tab", { name: "Owed & Held" }).click()
    await expect(page.getByText(who).first()).toBeVisible()

    await navigateTo(page, "Rent", "/rent")
    await expect(page.getByRole("region", { name: house })).toContainText("deposit €1,500")
    await expect(page.getByText("Deposits held €1,500")).toBeVisible()

    await page.getByRole("button", { name: `Edit lease of ${tenant}, Room 4` }).click()
    await expect(page.getByRole("dialog", { name: "Edit Lease" })).toContainText("Deposit held €1,500")
    await page.getByRole("dialog", { name: "Edit Lease" }).getByRole("button", { name: "End Tenancy" }).click()
    const end = page.getByRole("dialog", { name: "End Tenancy" })
    await expect(end).toContainText("Deposit held €1,500")
    // 1 January of this year: inside the lease and never a day still to come.
    await end.getByLabel("Last Day").fill(`${year}-01-01`)
    await end.getByRole("button", { name: "End and Return Deposit" }).click()

    // The Cash Book's own Add Movement, filled in from the lease.
    const back = page.getByRole("dialog", { name: "Add Movement" })
    await expect(back.getByRole("combobox", { name: "Type" })).toHaveText("Deposit Returned")
    await expect(back.getByLabel("Amount")).toHaveValue("1500")
    await expect(back.getByLabel("Date")).toHaveValue(`${year}-01-01`)
    await expect(back.getByLabel("Whose Deposit")).toHaveValue(who)
    await expect(back.getByLabel("Cost Centre (optional)")).toHaveValue(house)
    await expect(back.getByRole("combobox", { name: "Lease" })).toContainText(tenant)
    await expect(back.getByText("For Month")).toHaveCount(0)
    await expect(back).toContainText("Held €1,500 for this lease. Giving all of it back leaves €0.")
    await expect(back).not.toContainText("nothing in the Cash Book under this name")
    await back.getByRole("button", { name: "Save", exact: true }).click()
    await expect(back).toBeHidden()

    await expect(page.getByRole("region", { name: house })).toContainText("deposit €0")
    await expect(page.getByText("Deposits held €0")).toBeVisible()

    // Owed & Held no longer lists the deposit.
    await navigateTo(page, "Cash Book", "/cash-book")
    await page.getByRole("tab", { name: "Owed & Held" }).click()
    await expect(page.getByText(who)).toHaveCount(0)
  })

  test("unlinking a deposit from its lease takes it off the Rent page", async ({ page }) => {
    const house = uniqueName("Via Aurora 7")
    const surname = uniqueName("Gallo")
    const tenant = `Marco ${surname}`
    await seedLease(page, house, surname)
    await receiveDeposit(page, { house, tenant, who: tenant })

    await navigateTo(page, "Rent", "/rent")
    await expect(page.getByRole("region", { name: house })).toContainText("deposit €1,500")

    await navigateTo(page, "Cash Book", "/cash-book")
    await page.getByRole("button", { name: "Deposit Received" }).click()
    const edit = page.getByRole("dialog", { name: "Edit Movement" })
    await edit.getByRole("combobox", { name: "Lease" }).click()
    await page.getByRole("option", { name: "None" }).click()
    await edit.getByRole("button", { name: "Save", exact: true }).click()
    await expect(edit).toBeHidden()

    await navigateTo(page, "Rent", "/rent")
    await expect(page.getByRole("region", { name: house })).not.toContainText("deposit €")
  })

  test("an agreed amount is set from a month and shown on it", async ({ page }) => {
    const year = new Date().getFullYear() - 1
    const surname = uniqueName("Gallo")
    const tenant = `Marco ${surname}`
    await seedLease(page, uniqueName("Via Aurora 7"), surname)
    await navigateTo(page, "Rent", "/rent")
    await page.getByRole("button", { name: "Previous year" }).click()

    await page.getByRole("button", { name: `${tenant}, November: missing` }).click()
    const month = page.getByRole("dialog", { name: `November ${year}` })
    await month.getByLabel("For This Month", { exact: true }).fill("800")
    await month.getByLabel("Note").fill("Moved in on 26 Oct")
    await month.getByRole("button", { name: "Save" }).click()
    await expect(month).toBeHidden()
    await expect(page.getByRole("button", { name: `${tenant}, November: missing, agreed 800 euro` })).toBeVisible()
  })
})

test.describe("Rent: on a phone", () => {
  test("shows one month at a time with each tenant's status", async ({ page }) => {
    const surname = uniqueName("Gallo")
    const tenant = `Marco ${surname}`
    await signIn(page)
    await seedLease(page, uniqueName("Via Aurora 7"), surname)
    await page.setViewportSize({ width: 390, height: 844 }) // no reload: the mock keeps its data
    await navigateTo(page, "Rent", "/rent")

    await expect(page.getByRole("group", { name: "Month" })).toBeVisible()
    await expect(page.getByRole("table")).toHaveCount(0)
    await expect(page.getByRole("button", { name: `${tenant}, ${new Date().toLocaleString("en", { month: "long" })}: not yet` })).toBeVisible()

    // Last month has ended with nothing paid.
    await page.getByRole("button", { name: "Previous month" }).click()
    await expect(page.getByRole("button", { name: new RegExp(`^${tenant}, [A-Za-z]+: missing$`) })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  })
})
