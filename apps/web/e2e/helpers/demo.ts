import type { BackendAdapter } from "@/lib/backend"
import type { Page } from "@playwright/test"

// No runtime imports: scripts/shots.mjs loads this file in plain Node, which
// strips the types but resolves no "@/" alias and no extensionless path.

/**
 * A page of the app, opened by its nav link; for a detail page, by the text to
 * click on the list; for a tab, by the tab's name (its path carries `?tab=`).
 */
export interface DemoPage {
  path: string
  nav: string
  open?: string
  tab?: string
  /** A button to click once the page is open, and the dialog it opens, left open for the shot. */
  click?: string
  dialog?: string
}

/** Every page and tab of the app, in nav order. */
export const DEMO_PAGES: DemoPage[] = [
  { path: "/pipeline", nav: "Pipeline" },
  { path: "/clients", nav: "Clients" },
  { path: "/clients/[id]", nav: "Clients", open: "Nordwind Retail S.p.A." },
  { path: "/collaborators", nav: "Collaborators" },
  { path: "/solutions", nav: "Solutions" },
  { path: "/solutions/[id]", nav: "Solutions", open: "Product Knowledge Graph" },
  { path: "/invoices", nav: "Invoices" },
  { path: "/cash-book", nav: "Cash Book" },
  { path: "/cash-book?tab=summary", nav: "Cash Book", tab: "Summary" },
  { path: "/cash-book?tab=centres", nav: "Cash Book", tab: "Cost Centres" },
  { path: "/cash-book?tab=owed", nav: "Cash Book", tab: "Owed & Held" },
  { path: "/cash-book?tab=chase", nav: "Cash Book", tab: "To Chase" },
  { path: "/rent", nav: "Rent" },
  { path: "/rent?dialog=new-tenant", nav: "Rent", click: "New Tenant", dialog: "New Tenant" },
  { path: "/rent?dialog=edit-lease", nav: "Rent", click: "Edit lease of Nora Bianchi", dialog: "Edit Lease" },
  { path: "/month-end", nav: "Month End" },
  { path: "/tasks", nav: "Tasks" },
  { path: "/plan", nav: "Plan" },
  { path: "/deadlines", nav: "Deadlines" },
  { path: "/deadlines?tab=calendar", nav: "Deadlines", tab: "Calendar" },
  { path: "/costs", nav: "Costs" },
  { path: "/settings", nav: "Settings" },
]

/**
 * Opens a page the way a person does, by its link: `page.goto` reloads, and a
 * reload wipes the mock backend and signs out. Returns once the page has loaded.
 */
export async function openDemoPage(page: Page, { path, nav, open, tab, click, dialog }: DemoPage): Promise<void> {
  // The sidebar shows from md (768 px) up; below it the links live in the nav sheet.
  const phone = page.viewportSize()!.width < 768
  // The page before may have left a dialog open for its shot.
  if (await page.getByRole("dialog").count()) await page.keyboard.press("Escape")
  if (phone) await page.getByRole("button", { name: /open navigation/i }).click()
  await (phone ? page.getByRole("dialog") : page.locator("aside")).getByRole("link", { name: nav, exact: true }).click()
  // The route alone: in a URL glob `?` is a wildcard, and a tab is clicked, not navigated to.
  const route = path.split("?")[0]
  await page.waitForURL(route.replace("/[id]", ""))
  if (open) {
    // An account row is a clickable card, a client's name a link: both are found by their text.
    await page.getByRole("main").getByText(open, { exact: true }).first().click()
    await page.waitForURL((url) => url.pathname.startsWith(route.replace("[id]", "")))
  }
  if (tab) {
    await waitForPage(page)
    await page.getByRole("main").getByRole("tab", { name: tab }).click()
    await page.getByRole("main").getByRole("tab", { name: tab, selected: true }).waitFor()
  }
  await waitForPage(page)
  if (click) {
    await page.getByRole("main").getByRole("button", { name: click, exact: true }).click()
    await page.getByRole("dialog", { name: dialog }).waitFor()
  }
}

/**
 * Waits out every loading look: the h1, which a page renders only past its
 * data gate (until then the gate shows PageLoader, the app's one spinner), then
 * no spinner and no skeleton left anywhere in it.
 */
export async function waitForPage(page: Page): Promise<void> {
  const main = page.getByRole("main")
  await main.getByRole("heading", { level: 1 }).first().waitFor()
  await page.getByRole("status", { name: "Loading", exact: true }).first().waitFor({ state: "detached" })
  await main.locator(".animate-pulse").first().waitFor({ state: "detached" })
}

/**
 * A lived-in account through window.__mockBackend (the mock, or Firebase on the
 * local emulator: scripts/seed-demo.mjs), synthetic names and amounts only:
 * three clients (Nordwind Retail S.p.A., Lumen Srl, Vela
 * Analytics Srl) with contracts, hours, invoices, deals, tasks, meetings and
 * solutions; the company's costs, cash book, loans and deadlines. Dates follow
 * today. Sign in first: a page load wipes the mock.
 */
export async function seedDemo(page: Page): Promise<void> {
  await page.evaluate(async () => {
    type E2eWindow = Window & { __mockBackend?: BackendAdapter; __clearQueryCache?: () => void }
    const backend = (window as E2eWindow).__mockBackend
    if (!backend) throw new Error("window.__mockBackend is missing: the server must run the mock backend or the emulator")
    const user = await backend.auth.getCurrentUser()
    if (!user) throw new Error("not signed in")
    const u = user.id
    const db = backend.db
    const now = new Date()
    const Y = now.getFullYear()
    /** Day `d` of the month `n` months back (0 = this month, -1 = next month). */
    const day = (n: number, d: number) => new Date(Y, now.getMonth() - n, d, 12)
    const ym = (n: number) => {
      const d = day(n, 1)
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
    }

    // Company
    const bank = (await db.createCompanyAccount(u, { name: "Company Bank", openingBalance: 8000, openingDate: day(4, 1) })).id
    const reserve = (await db.createCompanyAccount(u, { name: "Reserve Account", openingBalance: 2000, openingDate: day(4, 1) })).id

    const nordwind = (await db.createClient(u, { name: "Nordwind Retail S.p.A.", vatNumber: "IT04821930157", email: "procurement@nordwind.example", contactName: "Marta Keller", contactPhone: "+39 02 5550 1180", notes: "Retail chain, 140 stores. Procurement wants POs before each phase." })).id
    const lumen = (await db.createClient(u, { name: "Lumen Srl", vatNumber: "IT09317460961", email: "admin@lumen.example", contactName: "Paolo Neri", contactPhone: "+39 011 555 0192" })).id
    const vela = (await db.createClient(u, { name: "Vela Analytics Srl", vatNumber: "IT11203580963", email: "ops@vela.example", contactName: "Chiara Bassi" })).id

    const graph = (await db.createEngagement(u, { clientId: nordwind, name: "Product Graph", dailyRate: 520, vatApplicable: true, contractedDays: 80, defaultDaysPerMonth: 8, startMonth: ym(3), endMonth: ym(-6) })).id
    const retainer = (await db.createEngagement(u, { clientId: lumen, name: "Retainer", dailyRate: 450, vatApplicable: true, defaultDaysPerMonth: 10, startMonth: ym(4) })).id
    const support = (await db.createEngagement(u, { clientId: vela, name: "Data Platform Support", dailyRate: 480, vatApplicable: true, contractedDays: 30, defaultDaysPerMonth: 4, startMonth: ym(2), endMonth: ym(-3) })).id

    /** Logs `h` hours on `count` weekdays of month `n`, from its `skip`-th weekday, none after today. */
    const hours = async (engagementId: string, n: number, count: number, skip: number, h = 8, collaboratorId?: string) => {
      const dates: string[] = []
      for (const d = day(n, 1); d.getMonth() === day(n, 1).getMonth(); d.setDate(d.getDate() + 1))
        if (d.getDay() % 6 !== 0 && d <= now) dates.push(`${ym(n)}-${String(d.getDate()).padStart(2, "0")}`)
      for (const date of dates.slice(skip, skip + count)) await db.setTimecard(u, { engagementId, date, hours: h, ...(collaboratorId && { collaboratorId }) })
    }
    for (const n of [3, 2, 1, 0]) {
      await hours(graph, n, n === 0 ? 4 : 8, 0)
      await hours(retainer, n, n === 0 ? 5 : 10, 8)
      if (n <= 2) await hours(support, n, n === 0 ? 2 : 4, 1, n === 1 ? 6 : 8)
    }

    const inv = (i: Parameters<typeof db.createInvoice>[1]) => db.createInvoice(u, i)
    await inv({ clientId: nordwind, number: `18/${Y}`, yearMonth: ym(3), amount: 4160, vat: 915.2, dueDate: day(2, 30), paidDate: day(2, 27), paidAccountId: bank })
    await inv({ clientId: lumen, number: `19/${Y}`, yearMonth: ym(3), amount: 4500, vat: 990, dueDate: day(2, 30), paidDate: day(2, 22), paidAccountId: bank })
    await inv({ clientId: nordwind, number: `21/${Y}`, yearMonth: ym(2), amount: 4160, vat: 915.2, dueDate: day(1, 30), paidDate: day(1, 29), paidAccountId: bank })
    await inv({ clientId: lumen, number: `22/${Y}`, yearMonth: ym(2), amount: 4500, vat: 990, dueDate: day(1, 30), paidDate: day(1, 18), paidAccountId: bank })
    await inv({ clientId: vela, number: `23/${Y}`, yearMonth: ym(2), amount: 1920, vat: 422.4, dueDate: day(1, 30), paidDate: day(1, 26), paidAccountId: reserve })
    await inv({ clientId: nordwind, number: `25/${Y}`, yearMonth: ym(1), amount: 4160, vat: 915.2, dueDate: day(-1, 0) })
    await inv({ clientId: lumen, number: `26/${Y}`, yearMonth: ym(1), amount: 4500, vat: 990, dueDate: day(0, 31), paidDate: day(0, 9), paidAccountId: bank })
    await inv({ clientId: vela, number: `27/${Y}`, yearMonth: ym(1), amount: 1440, vat: 316.8, dueDate: day(0, 5) })

    const deal = (o: Omit<Parameters<typeof db.createOpportunity>[1], "vatApplicable">) => db.createOpportunity(u, { vatApplicable: true, ...o })
    await deal({ clientId: lumen, title: "Demand Forecasting PoC", stage: "lead", probability: 15, dailyRate: 500, estimatedDaysPerMonth: 6, estimatedDurationMonths: 3, expectedStartMonth: ym(-2), nextActionDate: day(0, 20), nextActionNote: "Intro call with Paolo" })
    await deal({ clientId: vela, title: "Graph RAG Assistant", stage: "proposal", probability: 40, dailyRate: 520, estimatedDaysPerMonth: 8, estimatedDurationMonths: 4, expectedStartMonth: ym(-1), nextActionDate: day(0, 17), nextActionNote: "Send revised proposal" })
    const phase2 = await deal({ clientId: nordwind, title: "Store Analytics Phase 2", stage: "negotiation", probability: 70, dailyRate: 540, estimatedDaysPerMonth: 10, estimatedDurationMonths: 6, expectedStartMonth: ym(-2), nextActionDate: day(0, 22), nextActionNote: "Agree on rate with procurement" })
    await deal({ clientId: lumen, title: "BI Dashboard Refresh", stage: "lead", probability: 20, dailyRate: 450, estimatedDaysPerMonth: 4, estimatedDurationMonths: 2, expectedStartMonth: null, nextActionDate: day(-1, 3), nextActionNote: "Wait for budget approval" })
    const won = await deal({ clientId: nordwind, title: "Product Graph", stage: "won", probability: 100, dailyRate: 520, estimatedDaysPerMonth: 8, estimatedDurationMonths: 10, expectedStartMonth: ym(3) })
    await db.updateOpportunity(u, won.id, { closedAt: day(4, 20), engagementId: graph })
    const lost = await deal({ clientId: vela, title: "Warehouse Dashboard", stage: "lost", probability: 0, dailyRate: 480, estimatedDaysPerMonth: 5, estimatedDurationMonths: 2, expectedStartMonth: null })
    await db.updateOpportunity(u, lost.id, { lostReason: "Went with an in-house team", closedAt: day(2, 8) })

    const task = async (t: Parameters<typeof db.createTask>[1], state?: "started" | "done") => {
      const { id } = await db.createTask(u, t)
      if (state === "started") await db.updateTask(u, id, { startedAt: day(0, 8) })
      if (state === "done") await db.updateTask(u, id, { isDone: true })
    }
    await task({ clientId: nordwind, engagementId: graph, title: "Load store hierarchy into the graph", dueDate: day(0, 18), labels: ["data", "graph"] }, "started")
    await task({ clientId: nordwind, engagementId: graph, title: "Prepare phase 2 estimate", dueDate: day(0, 21), labels: ["sales"] })
    await task({ clientId: lumen, engagementId: retainer, title: "Monthly KPI review deck", dueDate: day(0, 28), labels: ["report"] })
    await task({ clientId: lumen, title: "Send September timesheet", dueDate: day(0, 3), labels: ["admin"] }, "done")
    await task({ clientId: vela, engagementId: support, title: "Upgrade Kafka connectors", dueDate: day(0, 16), labels: ["ops"] }, "started")
    await task({ clientId: vela, title: "Draft Graph RAG proposal", dueDate: day(0, 17), labels: ["sales"] })
    await task({ clientId: lumen, title: "Book forecasting intro call", dueDate: day(0, 12), labels: ["sales"] })
    await task({ clientId: nordwind, engagementId: graph, title: "Fix duplicate SKUs in import", dueDate: day(1, 25), labels: ["bug", "data"] }, "done")

    const meet = (m: Omit<Parameters<typeof db.createMeeting>[1], "engagementId" | "time" | "health"> & Partial<Parameters<typeof db.createMeeting>[1]>) =>
      db.createMeeting(u, { time: null, health: null, engagementId: null, ...m })
    await meet({ clientId: nordwind, engagementId: graph, date: `${ym(0)}-09`, time: "10:00", health: "green", text: "Weekly status: graph load on track\nStore hierarchy imported for 120 of 140 stores. Next: categories and promotions." })
    await meet({ clientId: nordwind, engagementId: graph, date: `${ym(1)}-25`, time: "10:00", health: "yellow", text: "Weekly status: duplicate SKUs\nSource export has duplicates; agreed a dedup rule with Marta." })
    await meet({ clientId: lumen, engagementId: retainer, date: `${ym(0)}-06`, time: "15:30", health: "green", text: "Monthly review\nKPI deck approved, two new dashboards requested." })
    await meet({ clientId: vela, date: `${ym(0)}-02`, time: "11:00", text: "Pre-sales call on Graph RAG\nThey want a demo on their support tickets." })

    const productGraph = await db.createSolution(u, {
      clientId: nordwind,
      engagementId: graph,
      name: "Product Knowledge Graph",
      status: "building",
      target: "Merchandising plans a promotion from one view of products, categories and stores.",
      steps: [
        { title: "Product master load", state: "done", fromMonth: ym(3), toMonth: ym(2), paidBy: { type: "contract", id: graph }, goal: null, outcome: "Nightly load runs; 12k products match the ERP.", doneOn: `${ym(2)}-20` },
        { title: "Categories and promotions", state: "now", fromMonth: ym(1), toMonth: ym(-1), paidBy: { type: "contract", id: graph }, goal: "Merchandisers edit the category tree; promotions link to products.", outcome: null, doneOn: null },
        { title: "Store app API", state: "next", fromMonth: ym(-2), toMonth: null, paidBy: { type: "opportunity", id: phase2.id }, goal: "Store managers read the plan on their tablets.", outcome: null, doneOn: null },
        { title: "Rollout to all 140 stores", state: "later", fromMonth: ym(-4), toMonth: null, paidBy: null, goal: null, outcome: null, doneOn: null },
      ],
      domain: "retail",
      stack: ["neo4j", "kafka", "python"],
      sections: {
        purpose: "Give merchandising one view of products, categories and promotions across 140 stores, replacing four spreadsheets.",
        requirements: "- Nightly sync from the ERP\n- Category tree editable by merchandisers\n- Answers in under 2 seconds for store managers",
        kpis: "Time to build a promo plan: from 3 days to half a day.",
        sources: "ERP product master (nightly CSV), promo calendar (Excel), store list (API).",
        model: "Products hang off leaf categories; promotions link to products, not categories, so overlaps stay visible.",
        architecture: "Kafka topics per source → Python loaders → Neo4j; a small API serves the store app.",
        steps: "1. Product master load\n2. Category tree\n3. Promotions\n4. Store app API",
        history: [
          `${ym(3)}-02 Kickoff on the 80-day contract.`,
          `${ym(3)}-24 Model v1 approved: promotions link to products, not categories.`,
          `${ym(2)}-18 From the nightly CSV to Kafka topics: a day of latency was blocking store managers.`,
          `${ym(1)}-25 Duplicate SKUs in the source export; agreed a dedup rule with Marta.`,
        ].join("\n"),
      },
      entities: [
        { name: "Product", source: "ERP product master", notes: null },
        { name: "Category", source: "ERP category tree", notes: null },
        { name: "Promotion", source: "Promo calendar", notes: null },
        { name: "Store", source: "Store API", notes: null },
        { name: "Supplier", source: "ERP vendor table", notes: null },
      ],
      relations: [
        { from: "Product", to: "Category", type: "IN_CATEGORY" },
        { from: "Promotion", to: "Product", type: "DISCOUNTS" },
        { from: "Store", to: "Product", type: "STOCKS" },
        { from: "Supplier", to: "Product", type: "SUPPLIES" },
        { from: "Category", to: "Category", type: "CHILD_OF" },
      ],
    })
    const journal = (e: Omit<Parameters<typeof db.createJournalEntry>[1], "solutionId" | "clientId">) =>
      db.createJournalEntry(u, { solutionId: productGraph.id, clientId: nordwind, ...e })
    await journal({
      date: `${ym(1)}-20`, stepTitle: "Categories and promotions", text: "Category tree editable by merchandisers; promotions link to products.",
      decisions: ["A promotion belongs to one category tree node, not to a product list."], links: ["PR #12"], next: "Review the tree with merchandising.",
      source: "Claude Code \u00b7 product-graph",
    })
    await journal({ kind: "decision", date: `${ym(1)}-25`, stepTitle: "Categories and promotions", text: "Duplicate SKUs are merged on the ERP code." })
    await journal({ date: `${ym(0)}-03`, stepTitle: "Categories and promotions", text: "Promotion plans load from the Excel calendar every night.", links: ["PR #14", "PR #15"] })
    await db.createSolution(u, {
      clientId: lumen,
      engagementId: retainer,
      name: "Customer 360 Warehouse",
      status: "delivered",
      domain: "services",
      stack: ["postgres", "dbt", "metabase"],
      sections: {
        purpose: "One customer table for sales and support.",
        requirements: "Daily refresh, GDPR deletions honoured within 24h.",
        kpis: "Report prep time down from 6h to 20 min a week.",
        sources: "CRM export, ticketing API, billing database.",
        architecture: "dbt models on Postgres, Metabase on top.",
        results: "Live since spring; 14 dashboards built on it.",
      },
      entities: [
        { name: "Customer", source: "CRM export", notes: null },
        { name: "Ticket", source: "Ticketing API", notes: null },
        { name: "Invoice", source: "Billing DB", notes: null },
      ],
      relations: [
        { from: "Ticket", to: "Customer", type: "OPENED_BY" },
        { from: "Invoice", to: "Customer", type: "BILLED_TO" },
      ],
    })
    await db.createSolution(u, {
      clientId: vela,
      name: "Support Ticket Graph RAG",
      status: "proposed",
      domain: "support",
      stack: ["neo4j", "langchain"],
      sections: { purpose: "Answer support questions from past tickets and docs, with sources.", requirements: "Italian and English; citations on every answer." },
      entities: [
        { name: "Ticket", source: "Helpdesk export", notes: null },
        { name: "Article", source: "Docs site", notes: null },
      ],
      relations: [{ from: "Ticket", to: "Article", type: "RESOLVED_BY" }],
    })

    // Collaborators: a fee that changes, one that ends, one that never started, one that is over.
    const verdi = (await db.createCollaborator(u, {
      name: "Studio Verdi", type: "company", notes: "UX and front-end, on invoice at month end.",
      fee: { amount: 2400, from: ym(9), until: null, changes: [{ from: ym(-5), amount: 2600 }] },
    })).id
    await db.createCollaborator(u, { name: "Marco Bianchi", type: "freelancer", fee: { amount: 1500, from: ym(1), until: ym(-6), changes: [] } })
    const giulia = (await db.createCollaborator(u, { name: "Giulia Neri", type: "freelancer" })).id
    // Giulia is on Product Graph, subcontracted: part of its days, at €320 a day against the client's €520.
    await db.createAssignment(u, { collaboratorId: giulia, engagementId: graph, dailyRate: 320, from: ym(2), defaultDays: 4, monthDays: { [ym(-1)]: 6 } })
    for (const [n, count] of [[2, 4], [1, 4], [0, 2]]) await hours(graph, n, count, 10, 8, giulia)
    await db.createCollaborator(u, {
      name: "Lab Nove Srl", type: "company", notes: "Design system work.", isActive: false,
      fee: { amount: 900, from: ym(14), until: ym(3), changes: [] },
    })

    const cost = (c: Omit<Parameters<typeof db.createCompanyExpense>[1], "vat"> & { vat?: number }) => db.createCompanyExpense(u, { vat: 0, ...c })
    const fee = await cost({ description: "Accountant fee", category: "accountant", amount: 250, vat: 55, date: day(5, 1), isRecurring: true, recurrenceMonths: 1 })
    const suite = await cost({ description: "Office suite licence", category: "software", amount: 14, vat: 3.08, date: day(5, 1), isRecurring: true, recurrenceMonths: 1 })
    const cowork = await cost({ description: "Coworking desk", category: "rent", amount: 300, vat: 66, date: day(5, 1), isRecurring: true, recurrenceMonths: 1 })
    await cost({ description: "Professional liability insurance", category: "insurance", amount: 620, date: new Date(Y, 2, 1), isRecurring: true, recurrenceMonths: 12 })
    // A quarterly estimate counted in the months it is paid, with a price change and an end.
    await cost({
      description: "Quarterly tax advisory", category: "accountant", amount: 1200, date: day(5, 15), isRecurring: true, recurrenceMonths: 3,
      countedWhenPaid: true, endMonth: ym(-9), priceChanges: [{ from: ym(2), amount: 1350 }],
    })
    for (const n of [3, 2, 1, 0]) {
      if (n > 0) await cost({ description: "Accountant fee", category: "accountant", amount: 250, vat: 55, date: day(n, 12), accountId: bank, documentRef: `ST ${10 - n}`, recurringExpenseId: fee.id, project: "Consulting" })
      await cost({ description: "Office suite licence", category: "software", amount: 14, vat: 3.08, date: day(n, 2), accountId: bank, documentRef: `OS-${n}`, recurringExpenseId: suite.id, project: "Consulting" })
      await cost({ description: "Coworking desk", category: "rent", amount: 300, vat: 66, date: day(n, 5), accountId: bank, documentRef: `CW ${n}`, recurringExpenseId: cowork.id, project: "Consulting" })
    }
    await cost({ description: "Laptop", category: "office_supplies", amount: 1450, vat: 319, date: day(2, 14), accountId: bank, documentRef: "FT 311", project: "Consulting" })
    await cost({ description: "Train to Milan client visit", category: "travel", amount: 89, date: day(1, 10), paidByOwner: true, documentRef: "TK 77", project: "Consulting" })
    const bill = await cost({ description: "Brand and website refresh", category: "marketing", amount: 1800, vat: 396, date: day(1, 20), documentRef: "INV 52", project: "Consulting" })
    await cost({ description: "Bank fees", category: "bank_fees", amount: 9.5, date: day(1, 30), accountId: bank, documentRef: "BK 9" })

    // Collaborator invoices, by the month of work they pay: Studio Verdi's every ended month but last month's (the gap), Giulia's first.
    for (const n of [9, 8, 7, 6, 5, 4]) {
      await cost({ description: `Studio Verdi, ${ym(n)}`, category: "collaborators", amount: 2400, date: day(n - 1, 5), collaboratorId: verdi, forMonth: ym(n) })
    }
    for (const n of [3, 2]) {
      await cost({
        description: `Studio Verdi invoice ${12 - n}/${Y}`, category: "collaborators", amount: 2400, date: day(n - 1, 5), accountId: bank,
        documentRef: `${12 - n}/${Y}`, collaboratorId: verdi, forMonth: ym(n), project: "Consulting",
      })
    }
    await cost({
      description: "Giulia Neri invoice 9", category: "collaborators", amount: 1280, date: day(1, 4), accountId: bank, documentRef: "GN 9",
      collaboratorId: giulia, engagementId: graph, forMonth: ym(2), project: "Consulting",
    })

    await db.createCompanyLoan(u, { description: "Shareholder loan", direction: "to_company", amount: 5000, date: day(4, 2), accountId: bank })
    await db.createCompanyLoan(u, { description: "Repayment of train ticket", direction: "from_company", amount: 89, date: day(0, 3), accountId: bank })
    const move = (m: Parameters<typeof db.createCompanyMovement>[1]) => db.createCompanyMovement(u, m)
    await move({ kind: "transfer", direction: "out", amount: 3000, date: day(3, 15), accountId: bank, toAccountId: reserve, description: "Move to Reserve Account" })
    await move({ kind: "vat", direction: "out", amount: 1840, date: day(2, 16), accountId: bank, description: "VAT Q2", documentRef: "F24 Q2" })
    await move({ kind: "compensation", direction: "out", amount: 2200, date: day(2, 27), accountId: bank, description: "Director's pay", counterparty: "Director" })
    await move({ kind: "compensation", direction: "out", amount: 2200, date: day(1, 27), accountId: bank, description: "Director's pay", counterparty: "Director" })
    await move({ kind: "supplier_payment", direction: "out", amount: 900, date: day(0, 6), accountId: bank, expenseId: bill.id, description: "Payment of INV 52 (1/2)", documentRef: "INV 52", project: "Consulting" })
    await move({ kind: "tax", direction: "out", amount: 1250, date: day(3, 30), accountId: bank, description: "IRES balance", documentRef: "F24 06" })

    const deadline = (d: Parameters<typeof db.createCompanyDeadline>[1]) => db.createCompanyDeadline(u, d)
    await deadline({ title: "VAT Q3 payment", date: new Date(Y, 10, 16), kind: "tax", amount: 2350 })
    await deadline({ title: "IRES second advance", date: new Date(Y, 10, 30), kind: "tax", amount: 1400 })
    await deadline({ title: "Vela contract end", date: day(-3, 28), kind: "contract" })
    await deadline({ title: "Renew professional insurance", date: day(-1, 1), kind: "admin", amount: 620 })
    await deadline({ title: "File F24 for withholding", date: day(0, 16), kind: "tax", amount: 480 })
    const filed = await deadline({ title: "Annual accounts filing", date: day(1, 30), kind: "admin", amount: 150 })
    await db.updateCompanyDeadline(u, filed.id, { isDone: true })

    await db.createAllocation(u, { engagementId: graph, yearMonth: ym(-1), days: 10 })
    await db.createAllocation(u, { engagementId: retainer, yearMonth: ym(-2), days: 6 })

    // Rent: tenants and this year's leases, in two houses.
    const tenant = async (firstName: string, surname: string, country = "Italy") =>
      (await db.createTenant(u, { firstName, surname, taxId: `TX-${surname.toUpperCase()}`, street: "Via Solferino 4", postcode: "50123", city: "Firenze", province: "FI", country })).id
    const lease = (tenantId: string, property: string, room: string | null, rent: number, contribution: number | null, paidBy: string | null = null) =>
      db.createLease(u, { tenantId, property, room, rent, contribution, paidBy, startDate: `${Y}-01-01`, endDate: `${Y}-12-31` })
    const elena = await lease(await tenant("Elena", "Ivanova", "Bulgaria"), "Via Aurora 7", "Room 1", 1050, 150, "Petra Ivanova")
    const tomas = await lease(await tenant("Tomas", "Vaitkus", "Lithuania"), "Via Aurora 7", "Room 2", 1000, 150)
    const luca = await lease(await tenant("Luca", "Ferri"), "Via Aurora 7", "Room 3", 750, 300)
    const sara = await lease(await tenant("Sara", "Conti"), "Via Aurora 7", "Room 4", 900, 100)
    const jonas = await lease(await tenant("Jonas", "Petraitis", "Lithuania"), "Via Aurora 7", "Room 5", 1000, null, "Darius Petraitis")
    const marta = await lease(await tenant("Marta", "Rossi"), "Via Roma 12", "Room 1", 800, null)
    // Entered before the tax ID, address and room were known: their rows show a "Not set" line.
    const nora = await lease((await db.createTenant(u, { firstName: "Nora", surname: "Bianchi" })).id, "Via Roma 12", null, 700, null)
    const omar = await lease((await db.createTenant(u, { firstName: "Omar", surname: "Haddad", taxId: "TX-HADDAD" })).id, "Via Roma 12", "Room 2", 650, null)

    // Who paid: every month before this one is paid and invoiced, but the last of them, which has one of each state:
    // a part-paid month (Elena), a missing one (Luca), a payment with no invoice number (Tomas), a rent offset (Sara).
    // Jonas agreed €800 for his first month. A new year starts with nothing to show, which is right.
    const past = Array.from({ length: now.getMonth() }, (_, i) => i + 1)
    const last = past[past.length - 1]
    const rentRow = (l: { id: string; property: string }, m: number, part: "rent" | "contribution", amount: number, doc: string | null) =>
      db.createCompanyMovement(u, {
        kind: "income", direction: "in", amount, date: new Date(Y, m - 1, 5, 12), accountId: bank, description: `${part === "rent" ? "Rent" : "Contribution"} ${m}/${Y}`,
        documentRef: doc, project: l.property, leaseId: l.id, rentMonth: `${Y}-${String(m).padStart(2, "0")}`, rentPart: part,
      })
    for (const [l, rent, contribution] of [[elena, 1050, 150], [tomas, 1000, 150], [luca, 750, 300], [sara, 900, 100], [jonas, 1000, 0], [marta, 800, 0], [nora, 700, 0], [omar, 650, 0]] as const) {
      for (const m of past) {
        if (l === luca && m === last) continue
        if (l === jonas && m === 1) {
          await db.updateLease(u, l.id, { agreedMonths: { [`${Y}-01`]: { amount: 800, note: "Moved in on 26 Jan" } } })
          await rentRow(l, m, "rent", 800, `${m}/${String(Y).slice(2)}`)
          continue
        }
        const doc = l === tomas && m === last ? null : `${m}/${String(Y).slice(2)}`
        await rentRow(l, m, "rent", rent, doc)
        if (contribution && !(l === elena && m === last)) await rentRow(l, m, "contribution", contribution, doc)
      }
    }
    if (last)
      await db.createCompanyExpense(u, {
        description: "Room during the works, taken off Sara Conti's rent", category: "other", amount: 520, vat: 0, date: new Date(Y, last - 1, 7, 12),
        accountId: bank, project: "Via Aurora 7", leaseId: sara.id, forMonth: `${Y}-${String(last).padStart(2, "0")}`,
      })

    // What the pages read before the seed is cached: drop it.
    ;(window as E2eWindow).__clearQueryCache?.()
  })
}
