import { test, expect } from "@playwright/test"
import { addDays, addMonths, endOfMonth, format, subDays, subMonths } from "date-fns"

import { seedSummaries } from "./helpers/summaries-seed"
import { signIn, navigateTo, uniqueName } from "./helpers/test-utils"

import type { BackendAdapter } from "@/lib/backend"
import type { Locator, Page } from "@playwright/test"

/**
 * The CRM's reason to exist is a flow that crosses pages: a deal becomes a
 * contract, the contract becomes days on the plan, the days become revenue.
 * Testing each page alone would miss every seam between them, so most of what
 * is here follows one thread through several routes.
 *
 * Desktop only — these are dialog- and grid-heavy screens, and the mobile
 * project in playwright.config.ts opts pages in by name rather than running
 * everything.
 */

/** Amounts render through `eur` (en-IE): "€5,000/month". */
const perMonth = (amount: number) => new RegExp(`€${amount.toLocaleString("en-IE")}/month`)

/** The combobox offers an existing client, or creates one from what you typed.
 *  Both arrive as `option`s — the inline create is one too, named `Create "…"`,
 *  so matching on the name as substring covers either. */
async function pickOrCreateClient(page: Page, name: string) {
  await page
    .getByRole("combobox")
    .filter({ hasText: "Choose or type a client" })
    .first()
    .click()
  await page.getByPlaceholder(/search or type a new name/i).fill(name)
  await page.getByRole("option").filter({ hasText: name }).first().click()
}

async function createOpportunity(page: Page, clientName: string, title: string) {
  await page.getByRole("button", { name: /new opportunity/i }).click()
  const form = page.getByRole("dialog", { name: "New Opportunity" })
  await pickOrCreateClient(page, clientName)
  await form.getByLabel("Title").fill(title)
  await form.getByRole("button", { name: /^create opportunity$/i }).click()
  await expect(form).toBeHidden()
}

/** Edit Contract and Delete Contract sit in a contract card's More menu (Amend Contract is a button). */
async function contractMenu(page: Page, scope: Locator | Page, item: "Edit Contract" | "Delete Contract") {
  await scope.getByRole("button", { name: /^More actions for / }).click()
  await page.getByRole("menuitem", { name: item }).click()
}

/** From the Clients catalog to a client's page, where its contracts, tasks and meetings are worked on. */
async function openClient(page: Page, client: string) {
  await page.getByRole("heading", { name: client }).getByRole("link").click()
  await expect(page.getByRole("heading", { name: client, level: 1 })).toBeVisible()
}

/** A section of the client's page: "Contracts", "Tasks", "Meetings"… */
const section = (page: Page, name: string) => page.getByRole("region", { name, exact: true })

/** Turns the open opportunity on screen into a signed contract. */
async function winOpportunity(page: Page) {
  await page.getByRole("button", { name: "Won" }).first().click()
  const form = page.getByRole("dialog", { name: "Create Contract" })
  await expect(form).toBeVisible()
  await form.getByRole("button", { name: /^create contract$/i }).click()
  await expect(form).toBeHidden()
}

test.describe("CRM", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
  })

  // A route that 500s or renders blank is the cheapest possible failure to
  // catch, and until now nothing caught it for any of these routes.
  test.describe("routes", () => {
    const routes = [
      { link: "Pipeline", url: "/pipeline", heading: "Pipeline" },
      { link: "Clients", url: "/clients", heading: "Clients" },
      { link: "Collaborators", url: "/collaborators", heading: "Collaborators" },
      { link: "Invoices", url: "/invoices", heading: "Invoices" },
      { link: "Cash Book", url: "/cash-book", heading: "Cash Book" },
      { link: "Tasks", url: "/tasks", heading: "Tasks" },
      { link: "Plan", url: "/plan", heading: "Plan" },
      { link: "Deadlines", url: "/deadlines", heading: "Deadlines" },
      { link: "Costs", url: "/costs", heading: "Costs" },
    ]

    for (const { link, url, heading } of routes) {
      test(`${link} loads`, async ({ page }) => {
        await navigateTo(page, link, url)
        await expect(page.getByRole("heading", { name: heading, exact: true, level: 1 })).toBeVisible()
      })
    }
  })

  test.describe("pipeline", () => {
    test("creating an opportunity also creates the client it names", async ({ page }) => {
      const client = uniqueName("Acme")
      await navigateTo(page, "Pipeline", "/pipeline")
      await createOpportunity(page, client, "Rinnovo retainer")

      await expect(page.getByText("Rinnovo retainer")).toBeVisible()

      // The empty state on /clients promises exactly this: a client is born
      // from the opportunity rather than having to exist first.
      await navigateTo(page, "Clients", "/clients")
      await expect(page.getByText(client)).toBeVisible()
    })

    test("an open opportunity counts at its probability, not its face value", async ({ page }) => {
      const client = uniqueName("Weighted")
      await navigateTo(page, "Pipeline", "/pipeline")
      await createOpportunity(page, client, "Deal pesato")

      // Form defaults: 10 days × €500/day = €5,000/month at face value, and
      // the "lead" stage seeds 20% → €1,000/month weighted. Both are on the
      // row; dropping the weighting would leave only the 5000.
      await expect(page.getByText(perMonth(5000)).first()).toBeVisible()
      await expect(page.getByText(perMonth(1000)).first()).toBeVisible()
    })
  })

  test.describe("summaries", () => {
    test("the Pipeline's All tab caps its closed deals at six, and View All Closed opens the Closed tab", async ({ page }) => {
      await seedSummaries(page, uniqueName("Summary"))
      await navigateTo(page, "Pipeline", "/pipeline")
      const rows = () => page.getByRole("region", { name: "Closed" }).getByRole("table").getByRole("row")
      await expect(rows()).toHaveCount(7) // header + six
      await page.getByRole("button", { name: /^View All Closed \(\d+\)$/ }).click()
      await expect(page).toHaveURL(/stage=closed/)
      await expect(page.getByRole("tab", { name: /^Closed/ })).toHaveAttribute("aria-selected", "true")
      expect(await rows().count()).toBeGreaterThan(7)
      await expect(page.getByRole("button", { name: /View All Closed/ })).toHaveCount(0)
    })

    test("a client's page caps its meetings, deals, solutions and contracts, and links to the rest", async ({ page }) => {
      const client = uniqueName("Summary")
      await seedSummaries(page, client)
      await navigateTo(page, "Clients", "/clients")
      await openClient(page, client)

      const meetings = section(page, "Meetings")
      await expect(meetings.getByRole("listitem")).toHaveCount(6)
      await meetings.getByRole("button", { name: "Show 2 Older Meetings" }).click()
      await expect(meetings.getByRole("listitem")).toHaveCount(8)

      const contracts = section(page, "Contracts")
      await expect(contracts.getByRole("article")).toHaveCount(1)
      await contracts.getByRole("button", { name: "Show 3 Closed Contracts" }).click()
      await expect(contracts.getByRole("article")).toHaveCount(4)

      await expect(section(page, "Solutions").getByRole("article")).toHaveCount(6)
      await expect(section(page, "Opportunities").getByRole("article")).toHaveCount(6)

      await section(page, "Solutions").getByRole("link", { name: "View All solutions" }).click()
      await expect(page).toHaveURL(/\/solutions\?client=/)
      // Only this client's: all eight of its own, and not the other client's.
      await expect(page.getByText("Solution 8", { exact: true })).toBeVisible()
      await expect(page.getByText("Other Solution")).toHaveCount(0)
      await page.goBack()
      await section(page, "Opportunities").getByRole("link", { name: "View All opportunities" }).click()
      await expect(page).toHaveURL(/\/pipeline\?client=/)
      await expect(page.getByText("Deal 1", { exact: true }).first()).toBeVisible()
      await expect(page.getByText("Other Deal")).toHaveCount(0)
    })
  })

  test.describe("winning a deal", () => {
    test("converts the opportunity into a contract that reaches the plan", async ({ page }) => {
      const client = uniqueName("Converted")
      await navigateTo(page, "Pipeline", "/pipeline")
      await createOpportunity(page, client, "Da vincere")
      await winOpportunity(page)

      // A won deal is not gone — it moves under "Closed" and loses its Won
      // action, which is what stops it being won twice. Its row names the
      // contract it became, which is called after the deal too.
      await expect(page.getByRole("heading", { name: "Closed" })).toBeVisible()
      const closed = page.getByRole("region", { name: "Closed" })
      await expect(closed.getByRole("button", { name: "Da vincere", exact: true })).toBeVisible()
      await expect(closed.getByRole("link", { name: "Da vincere", exact: true })).toBeVisible()
      await expect(page.getByRole("button", { name: "Won" })).toHaveCount(0)

      // ...and arrive as a contract on the client, named after the deal (#163:
      // it used to be saved nameless), and as a row on the plan.
      await navigateTo(page, "Clients", "/clients")
      await expect(page.getByText(client)).toBeVisible()
      await expect(page.getByText("Da vincere", { exact: true })).toBeVisible()
      await expect(page.getByText(/10 days\/month/)).toBeVisible()

      await navigateTo(page, "Plan", "/plan")
      await expect(page.getByText(client).first()).toBeVisible()
    })

    // #154: born with no end, a contract slid a zeroed month's days past the deal forever.
    test("the contract runs for the deal's duration, from this month when the deal has no start", async ({ page }) => {
      const client = uniqueName("Bounded")
      await navigateTo(page, "Pipeline", "/pipeline")
      // Form defaults: no expected start, 6 months.
      await createOpportunity(page, client, "Con scadenza")
      await page.getByRole("button", { name: "Won" }).first().click()
      const form = page.getByRole("dialog", { name: "Create Contract" })
      await expect(form.getByLabel("Start", { exact: true })).toHaveValue(format(new Date(), "yyyy-MM"))
      // A planned end by month: the End date field shows its last day.
      const lastDayOf = (d: Date) => format(endOfMonth(d), "yyyy-MM-dd")
      await expect(form.getByLabel("End date")).toHaveValue(lastDayOf(addMonths(new Date(), 5)))
      // Correcting the start keeps the deal's six months, as convert_to_engagement does.
      const lastMonth = addMonths(new Date(), 7)
      await form.getByLabel("Start", { exact: true }).fill(format(addMonths(new Date(), 2), "yyyy-MM"))
      await expect(form.getByLabel("End date")).toHaveValue(lastDayOf(lastMonth))
      await form.getByRole("button", { name: /^create contract$/i }).click()
      await expect(form).toBeHidden()

      await navigateTo(page, "Plan", "/plan")
      const plan = page.getByRole("table", { name: "Days by month" })
      await expect(plan.getByRole("row").filter({ hasText: client })).toContainText(
        `until ${format(lastMonth, "MMM yyyy")}`,
      )
    })
  })

  test.describe("deleting a client", () => {
    // Regression for the cascade: an orphaned contract used to stay in the
    // projection, billing its days under a fallback name, while /clients could
    // no longer show it. Revenue you could neither see nor reach.
    test("takes its contracts and opportunities with it", async ({ page }) => {
      const client = uniqueName("Doomed")
      await navigateTo(page, "Pipeline", "/pipeline")
      await createOpportunity(page, client, "Vinta poi cancellata")
      await winOpportunity(page)

      await createOpportunity(page, client, "Ancora aperta")

      await navigateTo(page, "Clients", "/clients")
      await expect(page.getByText(client)).toBeVisible()
      // Behind the card's More, beside Edit Client.
      await page.getByRole("button", { name: `More actions for ${client}` }).click()
      await page.getByRole("menuitem", { name: "Delete Client" }).click()

      // The dialog counts out what goes, so the numbers are part of the deal.
      const confirm = page.getByRole("alertdialog")
      await expect(confirm).toContainText("1 contract")
      // Two: the won one, kept as the trail back to the contract, and the open one.
      await expect(confirm).toContainText("2 opportunities")
      await confirm.getByRole("button", { name: /^delete$/i }).click()

      await expect(page.getByText(client)).toBeHidden()

      // The open opportunity went with it...
      await navigateTo(page, "Pipeline", "/pipeline")
      await expect(page.getByText("Ancora aperta")).toBeHidden()

      // ...and so did the contract, so the plan has nothing left to bill.
      await navigateTo(page, "Plan", "/plan")
      await expect(page.getByText(/no active contracts/i)).toBeVisible()
    })
  })

  test.describe("contracts", () => {
    // Two contracts for one client used to read "10 days/month × €500" twice.
    test("a named contract is listed by its name, and can be renamed", async ({ page }) => {
      const client = uniqueName("Named")
      const name = uniqueName("Migrazione cloud")
      await navigateTo(page, "Clients", "/clients")

      await page.getByRole("button", { name: "New Contract", exact: true }).click()
      const form = page.getByRole("dialog", { name: "New Contract" })
      await pickOrCreateClient(page, client)
      await form.getByLabel("Name").fill(name)
      await form.getByRole("button", { name: /^create contract$/i }).click()
      await expect(form).toBeHidden()

      // The catalog card leads with its main contract's name, the rate label after it.
      const card = page.getByRole("article", { name: client, exact: true })
      await expect(card.getByText(name, { exact: true })).toBeVisible()
      await expect(card.getByText(/ · 10 days\/month × €500 · /)).toBeVisible()

      // Contracts are worked on the client's page.
      await openClient(page, client)
      const contracts = section(page, "Contracts")
      await expect(contracts.getByText(name, { exact: true })).toBeVisible()
      // The rate label it replaced moves to the line beneath, not away.
      await expect(contracts.getByText(/10 days\/month/)).toBeVisible()

      await contractMenu(page, contracts, "Edit Contract")
      const edit = page.getByRole("dialog", { name: "Edit Contract" })
      await expect(edit.getByLabel("Name")).toHaveValue(name)
      await edit.getByLabel("Name").fill("Audit sicurezza")
      await edit.getByRole("button", { name: /^save$/i }).click()
      await expect(edit).toBeHidden()

      await expect(contracts.getByText("Audit sicurezza", { exact: true })).toBeVisible()
      await expect(contracts.getByText(name, { exact: true })).toBeHidden()
    })

    // Issue #156: nothing could close a contract, so the "Closed" badge was unreachable.
    test("a contract closes from the edit dialog on its last day, and reopens", async ({ page }) => {
      const client = uniqueName("Closing")
      await navigateTo(page, "Clients", "/clients")

      await page.getByRole("button", { name: "New Contract", exact: true }).click()
      const form = page.getByRole("dialog", { name: "New Contract" })
      await pickOrCreateClient(page, client)
      // A new contract is always active: there is nothing to switch off yet.
      await expect(form.getByRole("switch", { name: "Active" })).toHaveCount(0)
      await form.getByRole("button", { name: /^create contract$/i }).click()
      await expect(form).toBeHidden()

      await openClient(page, client)
      const contracts = section(page, "Contracts")
      const edit = page.getByRole("dialog", { name: "Edit Contract" })
      await contractMenu(page, contracts, "Edit Contract")
      await expect(edit.getByLabel("End date")).toBeHidden()
      await edit.getByRole("switch", { name: "Active" }).click()
      // Defaults to today: no hours go after the last day, and its month is what the plan keeps.
      await expect(edit.getByLabel("End date")).toHaveValue(/^\d{4}-\d{2}-\d{2}$/)
      await edit.getByLabel("End date").fill("2026-08-20")
      await edit.getByRole("button", { name: /^save$/i }).click()
      await expect(edit).toBeHidden()

      // A closed contract is folded away.
      await contracts.getByRole("button", { name: "Show 1 Closed Contract" }).click()
      await expect(contracts.getByText("Closed · ended 20 Aug 2026")).toBeVisible()

      await contractMenu(page, contracts, "Edit Contract")
      await expect(edit.getByLabel("End date")).toHaveValue("2026-08-20")
      // Switching back and forth restores the stored end, instead of moving it to today.
      await edit.getByRole("switch", { name: "Active" }).click()
      await expect(edit.getByLabel("End date")).toBeHidden()
      await edit.getByRole("switch", { name: "Active" }).click()
      await expect(edit.getByLabel("End date")).toHaveValue("2026-08-20")
      await edit.getByRole("switch", { name: "Active" }).click()
      await expect(edit.getByLabel("End date")).toBeHidden()
      await edit.getByRole("button", { name: /^save$/i }).click()
      await expect(edit).toBeHidden()

      await expect(contracts.getByText(/^Closed/)).toBeHidden()
    })

    // A rate rise from next month leaves last month's invoice settled; dating it into that
    // month asks first; Remove undoes it; and once hours exist Edit no longer changes the rate.
    test("Amend Contract sets a new rate from next month, asks before repricing, and Remove undoes it", async ({ page }) => {
      const client = uniqueName("Amend")
      const lastMonth = subMonths(new Date(), 1)
      const next = format(addMonths(new Date(), 1), "MMM yyyy")
      // Seeded through the mock backend, as billing.spec.ts does: 80 days at €700 from three
      // months ago, last month worked (80 h = 10 days) and invoiced at €7,000.
      await page.evaluate(
        async ({ client, start, worked, invoiced }) => {
          const backend = (window as Window & { __mockBackend?: BackendAdapter }).__mockBackend
          if (!backend) throw new Error("window.__mockBackend is missing: the e2e server must run the mock backend")
          const user = await backend.auth.getCurrentUser()
          if (!user) throw new Error("not signed in")
          const { id: clientId } = await backend.db.createClient(user.id, { name: client })
          const e = await backend.db.createEngagement(user.id, {
            clientId, name: "PCM", dailyRate: 700, vatApplicable: false, contractedDays: 80, defaultDaysPerMonth: 10, startMonth: start,
          })
          await backend.db.setTimecard(user.id, { engagementId: e.id, date: worked, hours: 80 })
          await backend.db.createInvoice(user.id, { clientId, number: "1", yearMonth: invoiced, amount: 7000, vat: 0 })
        },
        {
          client,
          start: format(subMonths(new Date(), 3), "yyyy-MM"),
          worked: format(lastMonth, "yyyy-MM-10"),
          invoiced: format(lastMonth, "yyyy-MM"),
        },
      )
      await navigateTo(page, "Clients", "/clients")
      await openClient(page, client)
      const card = page.getByRole("article", { name: "PCM", exact: true })
      await expect(card.getByText(/^10 days\/month × €700 · 80 days · runs out/)).toBeVisible()

      // Hours exist, so the signed rate is read-only here.
      await contractMenu(page, card, "Edit Contract")
      const edit = page.getByRole("dialog", { name: "Edit Contract" })
      await expect(edit.getByLabel("Day rate")).toHaveValue("€700/day signed")
      await expect(edit.getByLabel("Day rate")).not.toBeEditable()
      await expect(edit.getByText("Change it with Amend Contract, from a month on")).toBeVisible()
      await edit.getByRole("button", { name: "Cancel" }).click()

      await card.getByRole("button", { name: "Amend Contract" }).click()
      const amend = page.getByRole("dialog", { name: "Amend Contract" })
      await expect(amend.getByRole("region", { name: "History" })).toContainText("Signed · €700/day · 80 days")
      await expect(amend.getByLabel("From")).toHaveValue(format(addMonths(new Date(), 1), "yyyy-MM"))
      await amend.getByLabel("New Day Rate").fill("800")
      await amend.getByLabel("Add Days").fill("10")
      await amend.getByLabel("Note").fill("Addendum 2")
      await expect(amend.getByText(`From ${next}: €800/day · 90 days (80 + 10)`)).toBeVisible()
      await amend.getByRole("button", { name: "Save Amendment" }).click()
      await expect(amend).toBeHidden()
      await expect(card.getByText(new RegExp(`90 days \\(80 \\+ 10\\) · runs out .* · €800/day from ${next}$`))).toBeVisible()

      // Dated into the invoiced month, the save button itself is the question.
      await card.getByRole("button", { name: "Amend Contract" }).click()
      await amend.getByLabel("From").fill(format(lastMonth, "yyyy-MM"))
      await amend.getByLabel("New Day Rate").fill("850")
      await expect(amend.getByText(`${format(lastMonth, "MMM yyyy")} is invoiced (€7,000 across the client's contracts)`)).toBeVisible()
      // The outcome is pinned beside the button that confirms it, never below the fold.
      await expect(amend.getByText(/^Saving reprices .*, already invoiced: €1,500 more for this contract\./)).toBeInViewport()
      await expect(amend.getByRole("button", { name: "Save and Reprice" })).toBeInViewport()

      await amend.getByRole("button", { name: `Remove the ${next} amendment` }).click()
      const confirm = page.getByRole("alertdialog", { name: "Remove Amendment" })
      await expect(confirm).toContainText(`Removes the ${next} amendment: €800/day · +10 days · Addendum 2.`)
      await confirm.getByRole("button", { name: "Remove Amendment" }).click()
      await expect(amend.getByText("No amendments yet.")).toBeVisible()
      await amend.getByRole("button", { name: "Cancel" }).click()
      await expect(card.getByText(/^10 days\/month × €700 · 80 days · runs out [A-Z][a-z]{2} \d{4}$/)).toBeVisible()
    })
  })

  test.describe("task board", () => {
    // The board and the checklist on the client's page read the same task, so
    // moving it to Done on one must tick it on the other.
    test("a task added on the board moves through its columns and lands ticked on the client's page", async ({ page }) => {
      const client = uniqueName("Board")
      const contract = uniqueName("Sito")
      const title = uniqueName("Consegna wireframe")
      await navigateTo(page, "Clients", "/clients")

      await page.getByRole("button", { name: "New Contract", exact: true }).click()
      const form = page.getByRole("dialog", { name: "New Contract" })
      await pickOrCreateClient(page, client)
      await form.getByLabel("Name").fill(contract)
      await form.getByRole("button", { name: /^create contract$/i }).click()
      await expect(form).toBeHidden()

      await navigateTo(page, "Tasks", "/tasks")
      await page.getByRole("button", { name: "New Task" }).click()
      const add = page.getByRole("dialog", { name: "New Task" })
      await add.getByLabel("Client").click()
      await page.getByRole("option", { name: client }).click()
      await add.getByLabel("Contract").click()
      await page.getByRole("option").filter({ hasText: contract }).click()
      await add.getByLabel("Title").fill(title)
      await add.getByRole("button", { name: "Add Task" }).click()
      await expect(add).toBeHidden()

      const column = (name: string) => page.getByRole("region", { name, exact: true })
      const card = page.getByRole("listitem").filter({ hasText: title })
      await expect(column("To Do").getByText(title)).toBeVisible()
      // The card says whose work it is, without opening anything.
      await expect(card).toContainText(client)
      await expect(card).toContainText(contract)

      for (const target of ["In Progress", "Done"]) {
        await card.getByRole("button", { name: `Move Task: ${title}` }).click()
        await page.getByRole("menuitemradio", { name: target }).click()
        await expect(column(target).getByText(title)).toBeVisible()
      }
      await expect(column("To Do").getByText(title)).toBeHidden()
      await expect(column("In Progress").getByText(title)).toBeHidden()

      await navigateTo(page, "Clients", "/clients")
      await openClient(page, client)
      const tasks = section(page, "Tasks")
      await tasks.getByRole("button", { name: "Show Done Tasks (1)" }).click()
      const row = tasks.getByRole("listitem").filter({ hasText: title })
      await expect(row.getByRole("checkbox", { name: `Reopen task: ${title}` })).toBeChecked()
      await expect(row).toContainText(contract)
    })

    // #164: a prospect with no contract could have no tasks at all.
    test("a client with no contract gets a client-level task, on the board, its card and its page", async ({ page }) => {
      const client = uniqueName("Prospect")
      const title = uniqueName("Chiamata di follow-up")
      await navigateTo(page, "Clients", "/clients")

      await page.getByRole("button", { name: "New Client", exact: true }).click()
      const form = page.getByRole("dialog", { name: "New Client" })
      await form.getByLabel("Name").fill(client)
      await form.getByRole("button", { name: /^create client$/i }).click()
      await expect(form).toBeHidden()

      await navigateTo(page, "Tasks", "/tasks")
      await page.getByRole("button", { name: "New Task" }).click()
      const add = page.getByRole("dialog", { name: "New Task" })
      await add.getByLabel("Client").click()
      await page.getByRole("option", { name: client }).click()
      // Client-level unless a contract is picked.
      await expect(add.getByLabel("Contract")).toContainText("No contract")
      await add.getByLabel("Title").fill(title)
      await add.getByRole("button", { name: "Add Task" }).click()
      await expect(add).toBeHidden()

      const card = page.getByRole("listitem").filter({ hasText: title })
      await expect(page.getByRole("region", { name: "To Do", exact: true }).getByText(title)).toBeVisible()
      // The client alone: no contract to name after it.
      await expect(card.getByText(client, { exact: true })).toBeVisible()

      await page.getByLabel("Contract", { exact: true }).click()
      await page.getByRole("option", { name: "Client only" }).click()
      await expect(card).toBeVisible()

      await navigateTo(page, "Clients", "/clients")
      await expect(page.getByRole("article", { name: client, exact: true })).toContainText("1 open task")
      await openClient(page, client)
      const row = section(page, "Tasks").getByRole("listitem").filter({ hasText: title })
      await expect(row.getByRole("checkbox", { name: `Complete task: ${title}` })).not.toBeChecked()
    })

    // The card is the way into a task: everything the board only summarises is edited here.
    test("a card opens like a Trello card: description, labels, contract, label filter", async ({ page }) => {
      const client = uniqueName("Scheda")
      const contract = uniqueName("App")
      const title = uniqueName("Preparare offerta")
      const other = uniqueName("Senza etichette")
      const urgent = uniqueName("Urgente")
      const vip = uniqueName("VIP")
      await navigateTo(page, "Clients", "/clients")

      await page.getByRole("button", { name: "New Contract", exact: true }).click()
      const form = page.getByRole("dialog", { name: "New Contract" })
      await pickOrCreateClient(page, client)
      await form.getByLabel("Name").fill(contract)
      await form.getByRole("button", { name: /^create contract$/i }).click()
      await expect(form).toBeHidden()

      await navigateTo(page, "Tasks", "/tasks")
      for (const [name, onContract] of [[title, true], [other, false]] as const) {
        await page.getByRole("button", { name: "New Task" }).click()
        const add = page.getByRole("dialog", { name: "New Task" })
        await add.getByLabel("Client").click()
        await page.getByRole("option", { name: client }).click()
        if (onContract) {
          await add.getByLabel("Contract").click()
          await page.getByRole("option").filter({ hasText: contract }).click()
        }
        await add.getByLabel("Title").fill(name)
        await add.getByRole("button", { name: "Add Task" }).click()
        await expect(add).toBeHidden()
      }

      const card = page.getByRole("listitem").filter({ hasText: title })
      // The move menu lives on the card but is not the card: using it opens nothing.
      await card.getByRole("button", { name: `Move Task: ${title}` }).click()
      await page.getByRole("menuitemradio", { name: "In Progress" }).click()
      await expect(page.getByRole("region", { name: "In Progress", exact: true }).getByText(title)).toBeVisible()
      await expect(page.getByRole("dialog")).toBeHidden()

      await card.getByText(title).click()
      const details = page.getByRole("dialog", { name: title })
      await expect(details.getByLabel("Status")).toContainText("In Progress")
      await details.getByLabel("Description").fill("Riga uno\nRiga due")
      const labelInput = details.getByLabel("Labels")
      await labelInput.fill(urgent)
      await labelInput.press("Enter")
      await labelInput.pressSequentially(`${vip},`)
      await expect(details.getByRole("button", { name: `Remove Label ${urgent}` })).toBeVisible()
      await expect(details.getByRole("button", { name: `Remove Label ${vip}` })).toBeVisible()
      // Unsaved edits survive a click beside the dialog.
      await page.mouse.click(5, 5)
      await expect(details).toBeVisible()
      await details.getByRole("button", { name: "Save" }).click()
      await expect(details).toBeHidden()

      await expect(card.getByText(urgent)).toBeVisible()
      await expect(card.getByText(vip)).toBeVisible()
      await expect(card.getByText("Has description")).toBeAttached()

      // The title is the card's keyboard way in: Enter opens it, showing what was saved.
      await card.getByRole("button", { name: title, exact: true }).focus()
      await page.keyboard.press("Enter")
      await expect(details).toBeVisible()
      await expect(details.getByLabel("Description")).toHaveValue("Riga uno\nRiga due")
      await expect(details.getByRole("button", { name: `Remove Label ${urgent}` })).toBeVisible()
      await expect(details.getByRole("button", { name: `Remove Label ${vip}` })).toBeVisible()
      await expect(details.getByLabel("Contract")).toContainText(contract)

      // Off the contract, onto the client.
      await details.getByLabel("Contract").click()
      await page.getByRole("option", { name: "No contract" }).click()
      await details.getByRole("button", { name: "Save" }).click()
      await expect(details).toBeHidden()
      await expect(card).toContainText(client)
      await expect(card).not.toContainText(contract)

      await page.getByLabel("Label", { exact: true }).click()
      await page.getByRole("option", { name: urgent }).click()
      await expect(card).toBeVisible()
      await expect(page.getByRole("listitem").filter({ hasText: other })).toBeHidden()
    })
  })

  test.describe("verbali", () => {
    const today = new Date()
    const yesterday = subDays(today, 1)
    const iso = (d: Date) => format(d, "yyyy-MM-dd")
    /** How the chip writes a day: "12 Sep". */
    const short = (d: Date) => format(d, "d MMM")

    // The status is never stored: it is the light of the newest verbale that states one.
    test("a contract's status follows its newest verbale that states one", async ({ page }) => {
      const client = uniqueName("Stato")
      const contract = uniqueName("Portale")
      await navigateTo(page, "Clients", "/clients")

      await page.getByRole("button", { name: "New Contract", exact: true }).click()
      const form = page.getByRole("dialog", { name: "New Contract" })
      await pickOrCreateClient(page, client)
      await form.getByLabel("Name").fill(contract)
      await form.getByRole("button", { name: /^create contract$/i }).click()
      await expect(form).toBeHidden()

      // Meetings are logged on the client's page, each about a contract or the client.
      await openClient(page, client)
      const row = page.getByRole("article", { name: contract, exact: true })
      const chip = row.getByTitle(/^Status from the meeting on/)
      const meetings = section(page, "Meetings")
      const dialog = page.getByRole("dialog")
      // No verbale, no light: an unassessed contract shows nothing, not green.
      await expect(chip).toHaveCount(0)

      async function logMeetingOnContract() {
        await meetings.getByRole("button", { name: "Log Meeting" }).click()
        await expect(dialog).toHaveAccessibleName("Log Meeting")
        await dialog.getByLabel("Contract").click()
        await page.getByRole("option", { name: contract }).click()
      }

      async function logVerbale(text: string, { date, time, health }: { date?: Date; time?: string; health?: string }) {
        await logMeetingOnContract()
        await dialog.getByLabel("What happened").fill(text)
        if (date) await dialog.getByLabel("Date", { exact: true }).fill(iso(date))
        if (time) await dialog.getByLabel("Time", { exact: true }).fill(time)
        if (health) await dialog.getByRole("button", { name: health, exact: true }).click()
        await dialog.getByRole("button", { name: "Save" }).click()
        await expect(dialog).toBeHidden()
      }

      await logVerbale("Test slittati di una settimana", { date: yesterday, time: "15:00", health: "Yellow" })
      await expect(chip).toContainText(`Yellow · ${short(yesterday)}`)

      // A newer verbale with no light keeps the status and its date: the date means "last assessed".
      await logMeetingOnContract()
      await expect(dialog.getByRole("button", { name: "None", exact: true })).toHaveAttribute("aria-pressed", "true")
      await expect(dialog.getByText(`Current: Yellow since ${short(yesterday)}`)).toBeVisible()
      await dialog.getByRole("button", { name: "Cancel" }).click()
      await logVerbale("Call veloce, nulla di nuovo", {})
      await expect(chip).toContainText(`Yellow · ${short(yesterday)}`)

      // No time, like a status change made without a call: written after "Call veloce", so newer.
      await logVerbale("Bloccati i pagamenti", { health: "Red" })
      await expect(chip).toContainText(`Red · ${short(today)}`)

      // Newest first, each row with its own light: reading down is the history.
      const rows = meetings.getByRole("listitem")
      await expect(rows).toHaveText([/Bloccati i pagamenti.*Red/, /Call veloce/, /Test slittati.*Yellow/])

      await rows.filter({ hasText: "Call veloce" }).getByRole("button").click()
      await expect(dialog.getByLabel("What happened")).toHaveValue("Call veloce, nulla di nuovo")
      await dialog.getByLabel("What happened").fill("Call veloce: la demo slitta")
      // Unsaved edits survive a click beside the dialog.
      await page.mouse.click(5, 5)
      await expect(dialog).toBeVisible()
      await dialog.getByRole("button", { name: "Save" }).click()
      await expect(dialog).toBeHidden()
      await expect(rows.filter({ hasText: "Call veloce: la demo slitta" })).toBeVisible()

      // Deleting the verbale that set the status falls back to the one before.
      await rows.filter({ hasText: "Bloccati i pagamenti" }).getByRole("button").click()
      await dialog.getByRole("button", { name: "Delete" }).click()
      const confirm = page.getByRole("alertdialog")
      await expect(confirm).toContainText("Delete Meeting")
      await confirm.getByRole("button", { name: /^delete$/i }).click()
      await expect(dialog).toBeHidden()
      await expect(rows).toHaveCount(2)
      await expect(chip).toContainText(`Yellow · ${short(yesterday)}`)

      // Deleting the contract hands its verbali to the client, lights intact.
      await contractMenu(page, row, "Delete Contract")
      await expect(confirm).toContainText("Its tasks and meetings stay with the client.")
      await confirm.getByRole("button", { name: /^delete$/i }).click()
      // Until the dialog is gone the page behind it is aria-hidden, and a role locator counts 0 there anyway.
      await expect(confirm).toBeHidden()
      await expect(row).toHaveCount(0)
      await expect(rows).toHaveCount(2)
      const kept = rows.filter({ hasText: "Test slittati" })
      await expect(kept).toContainText("Yellow")
      await expect(kept).toContainText("About the client")
    })

    // A prospect has calls before it has a contract.
    test("a client with no contract gets client-level verbali", async ({ page }) => {
      const client = uniqueName("Prospect verbali")
      await navigateTo(page, "Clients", "/clients")

      await page.getByRole("button", { name: "New Client", exact: true }).click()
      const form = page.getByRole("dialog", { name: "New Client" })
      await form.getByLabel("Name").fill(client)
      await form.getByRole("button", { name: /^create client$/i }).click()
      await expect(form).toBeHidden()

      await openClient(page, client)
      const meetings = section(page, "Meetings")
      await meetings.getByRole("button", { name: "Log Meeting" }).click()
      const dialog = page.getByRole("dialog", { name: "Log Meeting" })
      await expect(dialog.getByLabel("Contract")).toContainText("No contract")
      // No contract, so the light is not a contract's.
      await expect(dialog.getByRole("group", { name: "Status", exact: true })).toBeVisible()
      await dialog.getByLabel("What happened").fill("Prima call conoscitiva")

      // A future call is a task with a due date, not a verbale.
      await dialog.getByLabel("Date", { exact: true }).fill(iso(addDays(today, 2)))
      await dialog.getByRole("button", { name: "Save" }).click()
      await expect(dialog.getByRole("alert")).toContainText("A future call is a task with a due date")
      await dialog.getByLabel("Date", { exact: true }).fill(iso(today))
      await dialog.getByRole("button", { name: "Save" }).click()
      await expect(dialog).toBeHidden()

      const entry = meetings.getByRole("listitem").filter({ hasText: "Prima call conoscitiva" })
      // The timeline dates it in full.
      await expect(entry).toContainText(iso(today))
      await expect(entry).toContainText("About the client")

      // Deleting the client takes its verbali: the dialog says so.
      await page.getByRole("button", { name: "More actions", exact: true }).click()
      await page.getByRole("menuitem", { name: "Delete Client" }).click()
      const confirm = page.getByRole("alertdialog")
      await expect(confirm).toContainText(`"${client}" is deleted along with 1 meeting.`)
      await confirm.getByRole("button", { name: /^delete$/i }).click()
      // Back on the catalog, without it.
      await expect(page).toHaveURL("/clients")
      await expect(page.getByRole("heading", { name: client })).toBeHidden()
    })
  })

  test.describe("plan", () => {
    test("a typed allocation overrides the contract default", async ({ page }) => {
      const client = uniqueName("Allocated")
      await navigateTo(page, "Clients", "/clients")

      await page.getByRole("button", { name: "New Contract", exact: true }).click()
      const form = page.getByRole("dialog", { name: "New Contract" })
      await pickOrCreateClient(page, client)
      await form.getByRole("button", { name: /^create contract$/i }).click()
      await expect(form).toBeHidden()

      await navigateTo(page, "Plan", "/plan")
      // This month's plan button: named "Client · contract, Month yyyy: N d planned".
      const month = () =>
        page
          .getByRole("table", { name: "Days by month" })
          .getByRole("row")
          .filter({ hasText: client })
          .getByRole("button", { name: `, ${format(new Date(), "MMMM yyyy")}: ` })

      // No allocation stored yet, so the month shows the contract default.
      await expect(month()).toHaveText("10")

      await month().click()
      const input = page.getByRole("spinbutton")
      // The editor opens empty rather than seeded: typing is what makes the
      // value explicit, and clearing it is how you fall back to the default.
      await expect(input).toHaveValue("")
      await input.fill("4")
      await input.press("Enter")

      await expect(month()).toHaveText("4")
    })
  })

  test.describe("contract form", () => {
    // step="10" on the rate input made the browser refuse any rate that was not a
    // multiple of ten: "the two nearest valid values are 680 and 690".
    test("accepts a daily rate that is not a round number", async ({ page }) => {
      const client = uniqueName("Rate")
      await navigateTo(page, "Clients", "/clients")

      await page.getByRole("button", { name: "New Contract", exact: true }).click()
      const form = page.getByRole("dialog", { name: "New Contract" })
      await pickOrCreateClient(page, client)
      await form.getByLabel("Day rate").fill("684")
      await form.getByRole("button", { name: /^create contract$/i }).click()
      await expect(form).toBeHidden()

      await expect(page.getByText(/days\/month × €684/).first()).toBeVisible()
    })
  })

  test.describe("deadline form", () => {
    // Same step="10" as the rate inputs, on the field where non-round amounts are
    // the norm: a €366 accountant's fee could not be saved.
    test("accepts an amount that is not a round number", async ({ page }) => {
      const title = uniqueName("Parcella")
      await navigateTo(page, "Deadlines", "/deadlines")

      await page.getByRole("button", { name: /new deadline/i }).click()
      const form = page.getByRole("dialog", { name: "New Deadline" })
      await form.getByLabel("What's due").fill(title)
      await form.getByLabel("Amount").fill("366")
      await form.getByRole("button", { name: /^add deadline$/i }).click()
      await expect(form).toBeHidden()

      // Due today: this week's period, in the default list.
      const row = page.getByRole("region", { name: "This week" }).getByRole("listitem", { name: title })
      await expect(row).toContainText("−€366.00")
    })

    // A row has one action; edit and delete live in the dialog its title opens.
    test("opens from its title to be edited, and is deleted from the dialog", async ({ page }) => {
      const title = uniqueName("Insurance")
      await navigateTo(page, "Deadlines", "/deadlines")
      await page.getByRole("button", { name: /new deadline/i }).click()
      const form = page.getByRole("dialog", { name: "New Deadline" })
      await form.getByLabel("What's due").fill(title)
      await form.getByRole("button", { name: /^add deadline$/i }).click()
      await expect(form).toBeHidden()

      const row = page.getByRole("listitem", { name: title })
      await row.getByRole("button", { name: "Mark Done" }).click()
      await expect(page.getByRole("region", { name: "Done" }).getByRole("listitem", { name: title })).toContainText("Done")
      await row.getByRole("button", { name: "Reopen" }).click()
      await expect(row.getByRole("button", { name: "Mark Done" })).toBeVisible()

      await row.getByRole("button", { name: title }).click()
      const edit = page.getByRole("dialog", { name: "Edit Deadline" })
      await edit.getByLabel("What's due").fill(`${title} renewed`)
      await edit.getByRole("button", { name: "Save" }).click()
      await expect(edit).toBeHidden()

      const renamed = page.getByRole("listitem", { name: `${title} renewed` })
      await renamed.getByRole("button", { name: `${title} renewed` }).click()
      await page.getByRole("dialog", { name: "Edit Deadline" }).getByRole("button", { name: "Delete Deadline" }).click()
      await page.getByRole("alertdialog", { name: "Delete Deadline" }).getByRole("button", { name: "Delete", exact: true }).click()
      await expect(renamed).toHaveCount(0)
    })
  })
})
