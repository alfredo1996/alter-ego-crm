import type { BackendAdapter } from "@/lib/backend"
import type { Page } from "@playwright/test"

/**
 * Month End through the mock backend, made-up names and round amounts only.
 * Three months have ended since the contracts began: Lumen Srl (Retainer, 10
 * days a month at €450) and Studio Verdi (Support, 4 days) logged them all, and
 * the plan holds them. Every month is invoiced, except that Studio Verdi's
 * invoice for two months ago went in as last month's: last month reads "1 step
 * to do (Invoices)", with two months ago "Also open". Main Bank matches a check
 * made on the 1st of this month, after the month end; the accountant's fee has
 * no payment for last month (amber). Sign in first: a
 * page load wipes the mock.
 */
export async function seedMonthEnd(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const backend = (window as Window & { __mockBackend?: BackendAdapter }).__mockBackend
    if (!backend) throw new Error("window.__mockBackend is missing: the server must run the mock backend")
    const user = await backend.auth.getCurrentUser()
    if (!user) throw new Error("not signed in")
    const u = user.id
    const db = backend.db
    const now = new Date()
    /** Day `d` of the month `n` months back (0 = this month, -1 = next month). */
    const day = (n: number, d: number) => new Date(now.getFullYear(), now.getMonth() - n, d)
    const ym = (n: number) => {
      const d = day(n, 1)
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
    }
    const year = now.getFullYear()

    // 5,000 + every invoice paid by last month's end (5,490 + 2,196 + 5,490 + 2,196) = 20,372.
    const main = (
      await db.createCompanyAccount(u, {
        name: "Main Bank", openingBalance: 5000, openingDate: day(3, 1), statementBalance: 20372, statementDate: day(0, 1),
      })
    ).id
    const lumen = (await db.createClient(u, { name: "Lumen Srl" })).id
    const verdi = (await db.createClient(u, { name: "Studio Verdi" })).id
    const retainer = (await db.createEngagement(u, { clientId: lumen, name: "Retainer", dailyRate: 450, vatApplicable: true, defaultDaysPerMonth: 10, startMonth: ym(3) })).id
    const support = (await db.createEngagement(u, { clientId: verdi, name: "Support", dailyRate: 450, vatApplicable: true, defaultDaysPerMonth: 4, startMonth: ym(3) })).id
    for (const n of [3, 2, 1]) {
      for (let k = 1; k <= 10; k++) await db.setTimecard(u, { engagementId: retainer, date: `${ym(n)}-${String(k).padStart(2, "0")}`, hours: 8 })
      for (let k = 11; k <= 14; k++) await db.setTimecard(u, { engagementId: support, date: `${ym(n)}-${k}`, hours: 8 })
    }

    const invoice = (input: Parameters<typeof db.createInvoice>[1]) => db.createInvoice(u, input)
    await invoice({ clientId: lumen, number: `11/${year}`, yearMonth: ym(3), amount: 4500, vat: 990, paidDate: day(2, 20), paidAccountId: main })
    await invoice({ clientId: verdi, number: `12/${year}`, yearMonth: ym(3), amount: 1800, vat: 396, paidDate: day(2, 15), paidAccountId: main })
    await invoice({ clientId: lumen, number: `13/${year}`, yearMonth: ym(2), amount: 4500, vat: 990, paidDate: day(1, 20), paidAccountId: main })
    // Two months ago's Support, recorded on last month: last month reads covered, two months ago not invoiced.
    await invoice({ clientId: verdi, number: `14/${year}`, yearMonth: ym(1), amount: 1800, vat: 396, paidDate: day(1, 15), paidAccountId: main })
    await invoice({ clientId: lumen, number: `15/${year}`, yearMonth: ym(1), amount: 4500, vat: 990, dueDate: day(-1, 28) })

    const fee = await db.createCompanyExpense(u, { description: "Accountant fee", category: "accountant", amount: 250, vat: 55, date: day(3, 1), isRecurring: true, recurrenceMonths: 1 })
    for (const n of [3, 2]) {
      await db.createCompanyExpense(u, {
        description: "Accountant fee", category: "accountant", amount: 250, vat: 55, date: day(n, 12), paidByOwner: true,
        documentRef: `P ${n}`, recurringExpenseId: fee.id,
      })
    }

    const renewal = await db.createCompanyDeadline(u, { title: "Insurance renewal", date: day(1, 20), kind: "admin", amount: 300 })
    await db.updateCompanyDeadline(u, renewal.id, { isDone: true })
    await db.createCompanyDeadline(u, { title: "Contract renewal", date: day(-1, 15), kind: "contract" })
  })
}

/**
 * The plan's examples (docs/plans/month-end-close.md), last month being the one
 * to close, through the mock backend. Made-up names and round amounts only.
 * - A: Lumen Srl's last month is not invoiced; Studio Verdi's month before went
 *   in on this month (a misdated invoice).
 * - B: Main Bank's check on last month's last day misses an IN of €1,830.00:
 *   Nordica Spa's unpaid 12/yyyy.
 * - C: the accountant's fee was paid in last month without its link; the rent
 *   was paid on the 2nd of this month, linked.
 * - D: a month to close from the top: Lumen's 9 days to Use, Bottega Rossi's
 *   month with no work, Main Bank never checked, a deadline still open.
 */
export async function seedMonthEndExample(page: Page, example: "A" | "B" | "C" | "D"): Promise<void> {
  await page.evaluate(async (example) => {
    const backend = (window as Window & { __mockBackend?: BackendAdapter }).__mockBackend
    if (!backend) throw new Error("window.__mockBackend is missing: the server must run the mock backend")
    const user = await backend.auth.getCurrentUser()
    if (!user) throw new Error("not signed in")
    const u = user.id
    const db = backend.db
    const now = new Date()
    /** Day `d` of the month `n` months back (0 = this month); day 0 is the last day of the month before. */
    const day = (n: number, d: number) => new Date(now.getFullYear(), now.getMonth() - n, d)
    const ym = (n: number) => {
      const d = day(n, 1)
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
    }
    const year = now.getFullYear()
    const contract = async (client: string, name: string, days: number, startMonth: string, endMonth?: string) => {
      const clientId = (await db.createClient(u, { name: client })).id
      const engagementId = (
        await db.createEngagement(u, { clientId, name, dailyRate: 450, vatApplicable: true, defaultDaysPerMonth: days, startMonth, endMonth })
      ).id
      return { clientId, engagementId }
    }
    const hours = async (engagementId: string, n: number, days: number) => {
      for (let k = 1; k <= days; k++) await db.setTimecard(u, { engagementId, date: `${ym(n)}-${String(k).padStart(2, "0")}`, hours: 8 })
    }

    if (example === "A") {
      const lumen = await contract("Lumen Srl", "Retainer", 9, ym(2))
      const verdi = await contract("Studio Verdi", "Support", 6, ym(2), ym(2))
      await hours(lumen.engagementId, 2, 9)
      await hours(lumen.engagementId, 1, 9)
      await hours(verdi.engagementId, 2, 6)
      await db.createInvoice(u, { clientId: lumen.clientId, number: `14/${year}`, yearMonth: ym(2), amount: 4050, vat: 891, dueDate: day(0, 0), paidDate: day(0, 0) })
      await db.createInvoice(u, { clientId: verdi.clientId, number: `15/${year}`, yearMonth: ym(0), amount: 2700, vat: 594, dueDate: day(-1, 0) })
    } else if (example === "B") {
      const nordica = (await db.createClient(u, { name: "Nordica Spa" })).id
      // 1,000 in the book at the month end, 2,830 in the bank.
      await db.createCompanyAccount(u, { name: "Main Bank", openingBalance: 1000, openingDate: day(3, 1), statementBalance: 2830, statementDate: day(0, 0) })
      await db.createInvoice(u, { clientId: nordica, number: `12/${year}`, yearMonth: ym(2), amount: 1500, vat: 330 })
    } else if (example === "C") {
      const lumen = await contract("Lumen Srl", "Retainer", 10, ym(1))
      await hours(lumen.engagementId, 1, 10)
      await db.createInvoice(u, { clientId: lumen.clientId, number: `16/${year}`, yearMonth: ym(1), amount: 4500, vat: 990, dueDate: day(-1, 0) })
      await db.createCompanyExpense(u, { description: "Accountant fee", category: "accountant", amount: 250, date: day(6, 1), isRecurring: true, recurrenceMonths: 1 })
      await db.createCompanyExpense(u, { description: "Accountant monthly", category: "accountant", amount: 250, date: day(1, 12), paidByOwner: true, documentRef: "R 12" })
      const rent = await db.createCompanyExpense(u, { description: "Office rent", category: "rent", amount: 900, date: day(6, 1), isRecurring: true, recurrenceMonths: 1 })
      await db.createCompanyExpense(u, { description: "Rent", category: "rent", amount: 900, date: day(0, 2), paidByOwner: true, documentRef: "R 13", recurringExpenseId: rent.id })
    } else {
      const lumen = await contract("Lumen Srl", "Retainer", 10, ym(1))
      const rossi = await contract("Bottega Rossi", "Support", 4, ym(2))
      await hours(lumen.engagementId, 1, 9)
      await hours(rossi.engagementId, 2, 4)
      // 1,000 + Bottega Rossi's 2,196 on the 15th: 3,196 at the month end.
      const main = (await db.createCompanyAccount(u, { name: "Main Bank", openingBalance: 1000, openingDate: day(3, 1) })).id
      await db.createInvoice(u, { clientId: rossi.clientId, number: `13/${year}`, yearMonth: ym(2), amount: 1800, vat: 396, dueDate: day(1, 30), paidDate: day(1, 15), paidAccountId: main })
      await db.createInvoice(u, { clientId: lumen.clientId, number: `14/${year}`, yearMonth: ym(1), amount: 4050, vat: 891, dueDate: day(-1, 0) })
      await db.createCompanyDeadline(u, { title: "Insurance renewal", date: day(1, 20), kind: "admin", amount: 300 })
    }
  }, example)
}
