import type { BackendAdapter } from "@/lib/backend"
import type { Page } from "@playwright/test"

/**
 * A populated Cash Book through the mock backend, made-up names and round
 * amounts only: Main Bank and Second Bank opened on the 1st of last month, a
 * customer with one invoice paid and one not, a flat rented out by the room
 * (Flat Rental) next to Consulting, a supplier invoice paid in part, a cost on
 * the owner's card, a shareholder loan and its first repayment, a recurring
 * estimate with its payment. Last month is whole; this month has the 1st only
 * (a laptop, the repayment, the rent),
 * so nothing is dated after today. Sign in first: a
 * page load wipes the mock.
 */
export async function seedCashBook(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const backend = (window as Window & { __mockBackend?: BackendAdapter }).__mockBackend
    if (!backend) throw new Error("window.__mockBackend is missing: the server must run the mock backend")
    const user = await backend.auth.getCurrentUser()
    if (!user) throw new Error("not signed in")
    const u = user.id
    const db = backend.db
    const now = new Date()
    /** Day `n` of last month (0 = last month) or of this month (1). */
    const day = (month: 0 | 1, n: number) => new Date(now.getFullYear(), now.getMonth() - 1 + month, n)
    const ym = (month: 0 | 1) => {
      const d = day(month, 1)
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
    }
    const year = now.getFullYear()

    const main = (await db.createCompanyAccount(u, { name: "Main Bank", openingBalance: 5000, openingDate: day(0, 1) })).id
    const second = (await db.createCompanyAccount(u, { name: "Second Bank", openingBalance: 0, openingDate: day(0, 1) })).id

    const acme = (await db.createClient(u, { name: "Acme Ltd" })).id
    await db.createInvoice(u, { clientId: acme, number: `1/${year}`, yearMonth: ym(0), amount: 4000, vat: 880, paidDate: day(0, 10), paidAccountId: main })
    await db.createInvoice(u, { clientId: acme, number: `2/${year}`, yearMonth: ym(0), amount: 3000, vat: 660 })

    await db.createCompanyLoan(u, { description: "Shareholder loan", direction: "to_company", amount: 3000, date: day(0, 1), accountId: main })
    const move = (m: Parameters<typeof db.createCompanyMovement>[1]) => db.createCompanyMovement(u, m)
    await move({ kind: "transfer", direction: "out", amount: 1500, date: day(0, 3), accountId: main, toAccountId: second, description: "Transfer to Second Bank" })
    await db.createCompanyExpense(u, { description: "Flat rent", category: "rent", amount: 1200, vat: 0, date: day(0, 4), accountId: second, documentRef: "Rent receipt 4", project: "Flat Rental" })
    await move({ kind: "income", direction: "in", amount: 650, date: day(0, 5), accountId: second, description: "Rent Room 2", project: "Flat Rental", counterparty: "Room 2" })
    await move({ kind: "income", direction: "in", amount: 100, date: day(0, 5), accountId: second, description: "Expense contribution Room 2", project: "Flat Rental", counterparty: "Room 2" })
    await move({ kind: "deposit_held", direction: "in", amount: 700, date: day(0, 5), accountId: second, description: "Deposit Room 2", project: "Flat Rental", counterparty: "Room 2" })
    const bill = await db.createCompanyExpense(u, { description: "Renovation", category: "other", amount: 4000, vat: 0, date: day(0, 12), documentRef: "INV 40", project: "Flat Rental" })
    await db.createCompanyExpense(u, { description: "Fridge", category: "office_supplies", amount: 480, vat: 0, date: day(0, 14), paidByOwner: true, documentRef: "R 9", project: "Flat Rental" })
    const google = await db.createCompanyExpense(u, { description: "Google Workspace", category: "software", amount: 12, vat: 2.64, date: new Date(year, 0, 1), isRecurring: true, recurrenceMonths: 1 })
    await db.createCompanyExpense(u, { description: "Google Workspace", category: "software", amount: 12, vat: 2.64, date: day(0, 15), accountId: main, recurringExpenseId: google.id, documentRef: "G 15", project: "Consulting" })
    await move({ kind: "vat", direction: "out", amount: 300, date: day(0, 16), accountId: main, description: "VAT", documentRef: "F24 16" })
    await move({ kind: "supplier_payment", direction: "out", amount: 1500, date: day(0, 20), accountId: main, expenseId: bill.id, description: "Payment of INV 40", documentRef: "INV 40", project: "Flat Rental" })
    await db.createCompanyExpense(u, { description: "Laptop", category: "office_supplies", amount: 800, vat: 176, date: day(1, 1), accountId: main, documentRef: "FT 12", project: "Consulting" })
    await db.createCompanyLoan(u, { description: "Repayment of the fridge", direction: "from_company", amount: 480, date: day(1, 1), accountId: main })
    await move({ kind: "income", direction: "in", amount: 650, date: day(1, 1), accountId: second, description: "Rent Room 2", project: "Flat Rental", counterparty: "Room 2" })
  })
}
