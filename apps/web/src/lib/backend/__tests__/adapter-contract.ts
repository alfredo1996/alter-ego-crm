import { describeRentContract } from "@alter-ego/rent/contract"
import { describe, it, expect, beforeAll, afterAll } from "vitest"

import { ACCOUNT_HAS_ENTRIES, BILL_HAS_PAYMENTS, CLIENT_HAS_CASH, NON_CASH } from "@/lib/cash-book"
import { CONTRACT_HAS_HOURS } from "@/lib/engagements"
import { invoiceClientId } from "@/lib/invoices"

import type { DatabaseAdapter, FilesAdapter } from "../types"
import type { CreateCompanyMovementInput, CreateJournalEntryInput } from "@/types"

export interface ContractSetup {
  (): Promise<{
    db: DatabaseAdapter
    files: FilesAdapter
    userId: string
    otherUserId: string
    /** Stores a task as the app wrote it before #164 — a contract, no clientId — and returns its id. */
    seedLegacyTask: (engagementId: string, title: string) => Promise<string>
    /**
     * Stores an invoice as the app wrote it before invoices named their customer —
     * a contract, no clientId: 2027-01, €1,000 + €220 VAT — and returns its id.
     */
    seedLegacyInvoice: (engagementId: string, number: string) => Promise<string>
    cleanup: () => Promise<void>
  }>
}

export function describeAdapterContract(name: string, setup: ContractSetup) {
  describe(`${name} — adapter contract`, () => {
    let db: DatabaseAdapter
    let files: FilesAdapter
    let userId: string
    let otherUserId: string
    let seedLegacyTask: (engagementId: string, title: string) => Promise<string>
    let seedLegacyInvoice: (engagementId: string, number: string) => Promise<string>
    let cleanupFn: () => Promise<void>

    beforeAll(async () => {
      const result = await setup()
      db = result.db
      files = result.files
      userId = result.userId
      otherUserId = result.otherUserId
      seedLegacyTask = result.seedLegacyTask
      seedLegacyInvoice = result.seedLegacyInvoice
      cleanupFn = result.cleanup
    })

    afterAll(async () => {
      await cleanupFn?.()
    })

    // ── Company Expenses ─────────────────────────────────────────────────

    describe("company expenses", () => {
      it("CRUD roundtrip", async () => {
        const created = await db.createCompanyExpense(userId, {
          description: "Office Rent",
          category: "rent",
          amount: 1200,
          date: new Date("2026-03-01"),
          isRecurring: true,
          recurrenceMonths: 1,
        })
        expect(created.description).toBe("Office Rent")
        expect(created.category).toBe("rent")
        expect(created.amount).toBe(1200)
        expect(created.isRecurring).toBe(true)
        expect(created.recurrenceMonths).toBe(1)

        const updated = await db.updateCompanyExpense(userId, created.id, { amount: 1300 })
        expect(updated.amount).toBe(1300)

        const fetched = (await db.getCompanyExpenses(userId)).find((e) => e.id === created.id) ?? null
        expect(fetched).not.toBeNull()
        expect(fetched!.amount).toBe(1300)

        await db.deleteCompanyExpense(userId, created.id)
        const deleted = (await db.getCompanyExpenses(userId)).find((e) => e.id === created.id) ?? null
        expect(deleted).toBeNull()
      })

      it("keeps an estimate's end, price changes and timing, clears them, and reads none on a plain one", async () => {
        const plain = await db.createCompanyExpense(userId, {
          description: "Hosting", category: "software", amount: 480, date: new Date("2026-11-20"), isRecurring: true, recurrenceMonths: 12,
        })
        expect([plain.endMonth ?? null, plain.priceChanges ?? [], plain.countedWhenPaid ?? false]).toEqual([null, [], false])
        const created = await db.createCompanyExpense(userId, {
          description: "Accountant", category: "accountant", amount: 1200, date: new Date("2027-01-15"), isRecurring: true, recurrenceMonths: 3,
          endMonth: "2028-12", priceChanges: [{ from: "2027-07", amount: 1350 }], countedWhenPaid: true,
        })
        expect([created.endMonth, created.priceChanges, created.countedWhenPaid]).toEqual(["2028-12", [{ from: "2027-07", amount: 1350 }], true])
        // An edit that sends none of the three leaves them alone.
        const renamed = await db.updateCompanyExpense(userId, created.id, { description: "Accountant fee" })
        expect([renamed.endMonth, renamed.priceChanges, renamed.countedWhenPaid]).toEqual(["2028-12", [{ from: "2027-07", amount: 1350 }], true])
        const edited = await db.updateCompanyExpense(userId, created.id, {
          endMonth: null, priceChanges: [{ from: "2027-04", amount: 1250 }, { from: "2027-10", amount: 1400 }], countedWhenPaid: false,
        })
        expect([edited.endMonth ?? null, edited.priceChanges, edited.countedWhenPaid]).toEqual([
          null, [{ from: "2027-04", amount: 1250 }, { from: "2027-10", amount: 1400 }], false,
        ])
        const stored = (await db.getCompanyExpenses(userId)).find((e) => e.id === created.id)!
        expect([stored.endMonth ?? null, stored.priceChanges, stored.countedWhenPaid]).toEqual([
          null, [{ from: "2027-04", amount: 1250 }, { from: "2027-10", amount: 1400 }], false,
        ])
      })

      it("keeps the account a cost was paid from; a cost without one reads null", async () => {
        const fee = await db.createCompanyExpense(userId, {
          description: "Bank fee on 16/2026", category: "bank_fees", amount: 25, date: new Date("2026-10-05"),
          accountId: "acc-fee",
        })
        expect(fee.accountId).toBe("acc-fee")
        const plain = await db.createCompanyExpense(userId, {
          description: "Stationery", category: "office_supplies", amount: 12, date: new Date("2026-10-05"),
        })
        expect(plain.accountId).toBeNull()
        // An edit that leaves it out keeps it.
        expect((await db.updateCompanyExpense(userId, fee.id, { amount: 26 })).accountId).toBe("acc-fee")
        expect((await db.updateCompanyExpense(userId, fee.id, { accountId: null })).accountId).toBeNull()
        await db.deleteCompanyExpense(userId, fee.id)
        await db.deleteCompanyExpense(userId, plain.id)
      })

      it("round-trips the cash book fields; a cost written without them reads null or false", async () => {
        const plain = await db.createCompanyExpense(userId, {
          description: "Stationery", category: "office_supplies", amount: 12, date: new Date("2026-10-05"),
        })
        expect(plain).toMatchObject({
          paidByOwner: false, vat: null, documentRef: null, project: null, recurringExpenseId: null,
          dateEstimated: false, importRef: null,
        })
        const paid = await db.createCompanyExpense(userId, {
          description: "Boiler repair", category: "other", amount: 100, vat: 22, date: new Date("2026-10-06"),
          accountId: "acc-a", documentRef: "R-7", project: "Flat Rental", recurringExpenseId: "est-1",
          dateEstimated: true, importRef: "2026:S1!4",
        })
        expect(paid).toMatchObject({
          amount: 100, vat: 22, accountId: "acc-a", paidByOwner: false, documentRef: "R-7", project: "Flat Rental",
          recurringExpenseId: "est-1", dateEstimated: true, importRef: "2026:S1!4",
        })
        // Paid by the owner instead: the account goes in the same write.
        const moved = await db.updateCompanyExpense(userId, paid.id, { accountId: null, paidByOwner: true, dateEstimated: false })
        expect(moved).toMatchObject({ accountId: null, paidByOwner: true, vat: 22, project: "Flat Rental", dateEstimated: false })
        const refund = await db.createCompanyExpense(userId, {
          description: "Refund from the shop", category: "other", amount: -40, vat: -8.8, date: new Date("2026-10-07"),
          accountId: "acc-a",
        })
        expect(refund).toMatchObject({ amount: -40, vat: -8.8 })
        await Promise.all([plain, paid, refund].map((e) => db.deleteCompanyExpense(userId, e.id)))
      })

      it("round-trips a rent offset's lease and month; a cost written without them reads null", async () => {
        const plain = await db.createCompanyExpense(userId, { description: "Plumber", category: "other", amount: 90, date: new Date("2026-10-05") })
        expect(plain).toMatchObject({ leaseId: null, forMonth: null })
        const offset = await db.createCompanyExpense(userId, {
          description: "Room during the works", category: "other", amount: 520, vat: 0, date: new Date("2026-10-07"),
          project: "Via Aurora 7", leaseId: "lease-1", forMonth: "2026-10",
        })
        expect(offset).toMatchObject({ leaseId: "lease-1", forMonth: "2026-10", collaboratorId: null })
        expect((await db.getCompanyExpenses(userId)).find((e) => e.id === offset.id)).toMatchObject({ leaseId: "lease-1", forMonth: "2026-10" })
        expect(await db.updateCompanyExpense(userId, offset.id, { leaseId: null, forMonth: null })).toMatchObject({ leaseId: null, forMonth: null })
        await Promise.all([plain, offset].map((e) => db.deleteCompanyExpense(userId, e.id)))
      })

      it("round-trips the collaborator link; a cost written without it reads null", async () => {
        const plain = await db.createCompanyExpense(userId, {
          description: "Stationery", category: "office_supplies", amount: 12, date: new Date("2026-10-05"),
        })
        expect(plain).toMatchObject({ collaboratorId: null, engagementId: null, forMonth: null })
        const linked = await db.createCompanyExpense(userId, {
          description: "Invoice 14/2026", category: "collaborators", amount: 2400, date: new Date("2026-10-05"),
          collaboratorId: "col-1", engagementId: "eng-1", forMonth: "2026-09",
        })
        expect(linked).toMatchObject({ category: "collaborators", collaboratorId: "col-1", engagementId: "eng-1", forMonth: "2026-09" })
        expect((await db.getCompanyExpenses(userId)).find((e) => e.id === linked.id)).toMatchObject({ collaboratorId: "col-1", forMonth: "2026-09" })
        const moved = await db.updateCompanyExpense(userId, linked.id, { forMonth: "2026-08", engagementId: null })
        expect(moved).toMatchObject({ collaboratorId: "col-1", engagementId: null, forMonth: "2026-08" })
        const cleared = await db.updateCompanyExpense(userId, linked.id, { collaboratorId: null, forMonth: null })
        expect(cleared).toMatchObject({ collaboratorId: null, forMonth: null })
        await expect(db.updateCompanyExpense(userId, linked.id, { forMonth: "2026-13" })).rejects.toThrow()
        await Promise.all([plain, linked].map((e) => db.deleteCompanyExpense(userId, e.id)))
      })

      it.each([
        ["a recurring estimate paid from an account", { isRecurring: true, recurrenceMonths: 1, accountId: "acc-a" }],
        ["a recurring estimate paid by the owner", { isRecurring: true, paidByOwner: true }],
        ["an account and the owner's card together", { accountId: "acc-a", paidByOwner: true }],
        ["a negative amount not paid back into an account", { amount: -5 }],
        ["a zero amount", { amount: 0 }],
        ["VAT of the other sign", { vat: -1 }],
      ] as const)("refuses %s", async (_, over) => {
        await expect(
          db.createCompanyExpense(userId, { description: "Bad", category: "other", amount: 10, date: new Date("2026-10-05"), ...over }),
        ).rejects.toThrow()
      })

      it("checks the whole cost on update", async () => {
        const owner = await db.createCompanyExpense(userId, {
          description: "Fridge", category: "office_supplies", amount: 480, date: new Date("2026-10-05"), paidByOwner: true,
        })
        await expect(db.updateCompanyExpense(userId, owner.id, { accountId: "acc-a" })).rejects.toThrow()
        await expect(db.updateCompanyExpense(userId, owner.id, { isRecurring: true })).rejects.toThrow()
        expect((await db.getCompanyExpenses(userId)).find((e) => e.id === owner.id)).toMatchObject({ paidByOwner: true, accountId: null })
        await db.deleteCompanyExpense(userId, owner.id)
      })

      it("refuses to delete or repurpose a supplier invoice while payments point at it", async () => {
        const bill = await db.createCompanyExpense(userId, {
          description: "Works", category: "other", amount: 1000, vat: 0, date: new Date("2026-10-01"), documentRef: "FPR 1/26",
        })
        const payment = await db.createCompanyMovement(userId, {
          kind: "supplier_payment", direction: "out", amount: 400, date: new Date("2026-10-02"), accountId: "acc-a",
          expenseId: bill.id, description: "First instalment",
        })
        await expect(db.deleteCompanyExpense(userId, bill.id)).rejects.toThrow(BILL_HAS_PAYMENTS)
        expect((await db.getCompanyExpenses(userId)).some((e) => e.id === bill.id)).toBe(true)
        // Nor made anything but a supplier invoice: its cash would count twice, its payments name nothing.
        for (const change of [{ accountId: "acc-a" }, { paidByOwner: true }, { documentRef: null }, { isRecurring: true, recurrenceMonths: 1 }]) {
          await expect(db.updateCompanyExpense(userId, bill.id, change)).rejects.toThrow(BILL_HAS_PAYMENTS)
        }
        // Still a supplier invoice: the edit goes through.
        await db.updateCompanyExpense(userId, bill.id, { description: "Works, kitchen", accountId: null, paidByOwner: false, documentRef: "FPR 1/26" })
        expect((await db.getCompanyExpenses(userId)).find((e) => e.id === bill.id)).toMatchObject({
          description: "Works, kitchen", accountId: null, paidByOwner: false, documentRef: "FPR 1/26",
        })
        await db.deleteCompanyMovement(userId, payment.id)
        // With no payment left, it may be paid from an account after all.
        await db.updateCompanyExpense(userId, bill.id, { accountId: "acc-a" })
        await db.deleteCompanyExpense(userId, bill.id)
        expect((await db.getCompanyExpenses(userId)).some((e) => e.id === bill.id)).toBe(false)
      })

      it("lists expenses for user", async () => {
        await db.createCompanyExpense(userId, {
          description: "Accountant Fee",
          category: "accountant",
          amount: 500,
          date: new Date("2026-04-01"),
        })
        const list = await db.getCompanyExpenses(userId)
        expect(list.length).toBeGreaterThanOrEqual(1)
        expect(list.every((e) => e.userId === userId)).toBe(true)
      })
    })

    // ── Company Loans ────────────────────────────────────────────────────

    describe("company loans", () => {
      it("CRUD roundtrip", async () => {
        const created = await db.createCompanyLoan(userId, {
          description: "Loan to SRL",
          direction: "to_company",
          amount: 5000,
          date: new Date("2026-05-01"),
        })
        expect(created.description).toBe("Loan to SRL")
        expect(created.direction).toBe("to_company")
        expect(created.amount).toBe(5000)

        const updated = await db.updateCompanyLoan(userId, created.id, { amount: 7000 })
        expect(updated.amount).toBe(7000)

        await db.deleteCompanyLoan(userId, created.id)
        const loans = await db.getCompanyLoans(userId)
        expect(loans.find((l) => l.id === created.id)).toBeUndefined()
      })

      it("tracks both directions", async () => {
        await db.createCompanyLoan(userId, {
          description: "Lend to SRL",
          direction: "to_company",
          amount: 10000,
          date: new Date("2026-01-01"),
        })
        await db.createCompanyLoan(userId, {
          description: "Withdraw from SRL",
          direction: "from_company",
          amount: 3000,
          date: new Date("2026-02-01"),
        })
        const loans = await db.getCompanyLoans(userId)
        const toCompany = loans.filter((l) => l.direction === "to_company")
        const fromCompany = loans.filter((l) => l.direction === "from_company")
        expect(toCompany.length).toBeGreaterThanOrEqual(1)
        expect(fromCompany.length).toBeGreaterThanOrEqual(1)
      })

      it("round-trips the account, the estimated date and the import ref; without them null or false", async () => {
        const legacy = await db.createCompanyLoan(userId, {
          description: "Loan to SRL", direction: "to_company", amount: 100, date: new Date("2026-05-01"),
        })
        expect(legacy).toMatchObject({ accountId: null, dateEstimated: false, importRef: null })
        const loan = await db.createCompanyLoan(userId, {
          description: "Repay Shareholder Loan", direction: "from_company", amount: 480, date: new Date("2026-10-30"),
          accountId: "acc-a", dateEstimated: true, importRef: "2026:S1!9",
        })
        expect(loan).toMatchObject({ accountId: "acc-a", dateEstimated: true, importRef: "2026:S1!9" })
        const edited = await db.updateCompanyLoan(userId, legacy.id, { accountId: "acc-b", date: new Date("2026-05-02") })
        expect(edited).toMatchObject({ accountId: "acc-b", description: "Loan to SRL", amount: 100 })
        await expect(db.updateCompanyLoan(userId, legacy.id, { amount: 0 })).rejects.toThrow()
        await expect(db.updateCompanyLoan(userId, legacy.id, { description: "" })).rejects.toThrow()
        await Promise.all([legacy, loan].map((l) => db.deleteCompanyLoan(userId, l.id)))
      })
    })

    // ── Company Accounts and Movements (the cash book) ─────────────────────
    //
    // Every rejection below comes from the rules on Firebase and from the shared
    // zod schemas on the mock: the two must refuse the same writes.

    describe("company accounts", () => {
      const opening = new Date("2026-05-01")
      const newAccount = (name: string) =>
        db.createCompanyAccount(userId, { name, openingBalance: 1000, openingDate: opening })

      it("CRUD roundtrip, optional fields null", async () => {
        const created = await db.createCompanyAccount(userId, { name: "Contract Bank", openingBalance: -25.5, openingDate: opening })
        expect(created.id).toBeTruthy()
        expect(created).toMatchObject({
          userId, name: "Contract Bank", openingBalance: -25.5, statementBalance: null, statementDate: null, importRef: null,
        })
        expect(created.openingDate.getTime()).toBe(opening.getTime())

        const checked = await db.updateCompanyAccount(userId, created.id, {
          statementBalance: 1200.5,
          statementDate: new Date("2026-06-30"),
        })
        expect(checked).toMatchObject({ name: "Contract Bank", openingBalance: -25.5, statementBalance: 1200.5 })
        expect(checked.statementDate?.getTime()).toBe(new Date("2026-06-30").getTime())

        const fetched = (await db.getCompanyAccounts(userId)).find((a) => a.id === created.id)
        expect(fetched).toMatchObject({ name: "Contract Bank", statementBalance: 1200.5, importRef: null })

        await db.deleteCompanyAccount(userId, created.id)
        expect((await db.getCompanyAccounts(userId)).find((a) => a.id === created.id)).toBeUndefined()
      })

      it("lists the user's accounts by name, never another user's", async () => {
        const b = await newAccount("Sort B")
        const a = await newAccount("Sort A")
        const list = await db.getCompanyAccounts(userId)
        expect(list.every((x) => x.userId === userId)).toBe(true)
        expect(list.findIndex((x) => x.id === a.id)).toBeLessThan(list.findIndex((x) => x.id === b.id))
        expect(await db.getCompanyAccounts(otherUserId)).toEqual([])
        await Promise.all([a, b].map((x) => db.deleteCompanyAccount(userId, x.id)))
      })

      it("refuses an empty name and a bank balance without its date", async () => {
        await expect(db.createCompanyAccount(userId, { name: "", openingBalance: 0, openingDate: opening })).rejects.toThrow()
        await expect(
          db.createCompanyAccount(userId, { name: "Half", openingBalance: 0, openingDate: opening, statementBalance: 10 }),
        ).rejects.toThrow()
      })

      it("checks the whole account on update", async () => {
        const account = await newAccount("Half update")
        await db.updateCompanyAccount(userId, account.id, { statementBalance: 900, statementDate: opening })
        await expect(db.updateCompanyAccount(userId, account.id, { statementBalance: null })).rejects.toThrow()
        await expect(db.updateCompanyAccount(userId, account.id, { name: "" })).rejects.toThrow()
        const kept = (await db.getCompanyAccounts(userId)).find((a) => a.id === account.id)
        expect(kept).toMatchObject({ name: "Half update", statementBalance: 900 })
        await db.deleteCompanyAccount(userId, account.id)
      })
    })

    describe("company settings", () => {
      it("starts with no cash floor, sets it, replaces it and clears it", async () => {
        expect(await db.getCompanySettings(userId)).toEqual({ cashFloor: null })
        expect(await db.setCompanyCashFloor(userId, 10000)).toEqual({ cashFloor: 10000 })
        expect(await db.setCompanyCashFloor(userId, 2500.5)).toEqual({ cashFloor: 2500.5 })
        expect(await db.getCompanySettings(userId)).toEqual({ cashFloor: 2500.5 })
        expect(await db.setCompanyCashFloor(userId, 0)).toEqual({ cashFloor: 0 })
        expect(await db.setCompanyCashFloor(userId, null)).toEqual({ cashFloor: null })
        expect(await db.getCompanySettings(userId)).toEqual({ cashFloor: null })
      })

      // On Firebase the other user's read is permission-denied and falls back to no floor: the rules tests prove that isolation, this case the mock's.
      it("keeps each user's floor apart", async () => {
        await db.setCompanyCashFloor(userId, 700)
        expect(await db.getCompanySettings(otherUserId)).toEqual({ cashFloor: null })
        await db.setCompanyCashFloor(userId, null)
      })

      it("refuses a negative or non-finite floor", async () => {
        await expect(db.setCompanyCashFloor(userId, -1)).rejects.toThrow()
        await expect(db.setCompanyCashFloor(userId, Number.NaN)).rejects.toThrow()
        expect(await db.getCompanySettings(userId)).toEqual({ cashFloor: null })
      })
    })

    // Time off, one record per month: the Plan writes it from the app, the connector through the Admin SDK.
    describe("time off (capacity)", () => {
      const aug = { yearMonth: "2026-08", daysOff: 5, availableDays: 16, reason: "vacation" as const, note: null }

      it("starts empty, stores a month, replaces it and reads a window in month order", async () => {
        expect(await db.getCapacityDocs(userId, { from: "2026-01", to: "2026-12" })).toEqual([])
        await db.setCapacity(userId, { ...aug, yearMonth: "2026-09", daysOff: 2, availableDays: 20, reason: "training", note: "AWS" })
        await db.setCapacity(userId, aug)
        await db.setCapacity(userId, { ...aug, daysOff: 0, availableDays: 21 })
        expect(await db.getCapacityDocs(userId, { from: "2026-01", to: "2026-12" })).toEqual([
          { ...aug, daysOff: 0, availableDays: 21 },
          { ...aug, yearMonth: "2026-09", daysOff: 2, availableDays: 20, reason: "training", note: "AWS" },
        ])
        expect(await db.getCapacityDocs(userId, { from: "2026-09", to: "2026-09" })).toHaveLength(1)
      })

      it("stores and reads back a month with no reason", async () => {
        const bare = { yearMonth: aug.yearMonth, daysOff: aug.daysOff, availableDays: aug.availableDays, note: aug.note }
        await db.setCapacity(userId, bare)
        expect(await db.getCapacityDocs(userId, { from: "2026-08", to: "2026-08" })).toEqual([bare])
      })

      // Another user's months are covered by the rules test "rejects another user's months": on
      // Firebase a read of them is permission-denied, which an adapter test would read as [].

      it.each([
        ["more days off than a month has", { daysOff: 40 }],
        ["a negative number", { daysOff: -1 }],
        ["a reason that is not one of the four", { reason: "holiday" as never }],
        ["a month that is not a month", { yearMonth: "2026-13" }],
      ])("refuses %s", async (_name, bad) => {
        const before = await db.getCapacityDocs(userId, { from: "2026-01", to: "2026-12" })
        await expect(db.setCapacity(userId, { ...aug, ...bad })).rejects.toThrow()
        expect(await db.getCapacityDocs(userId, { from: "2026-01", to: "2026-12" })).toEqual(before)
      })
    })

    describe("company movements", () => {
      const income = (o: Partial<CreateCompanyMovementInput> = {}): CreateCompanyMovementInput => ({
        kind: "income", direction: "in", amount: 100, date: new Date("2026-06-02"), accountId: "acc-a",
        description: "Room A rent", ...o,
      })

      it("CRUD roundtrip, optional fields null", async () => {
        const created = await db.createCompanyMovement(userId, income())
        expect(created.id).toBeTruthy()
        expect(created).toMatchObject({
          userId, kind: "income", direction: "in", amount: 100, accountId: "acc-a", toAccountId: null,
          expenseId: null, description: "Room A rent", documentRef: null, project: null, counterparty: null,
          notes: null, dateEstimated: false, importRef: null,
        })
        expect(created.date.getTime()).toBe(new Date("2026-06-02").getTime())

        const edited = await db.updateCompanyMovement(userId, created.id, {
          kind: "deposit_held", counterparty: "Room A", project: "Project X", documentRef: "R-1",
          notes: "n", dateEstimated: true, importRef: "2026:S1!2",
        })
        expect(edited).toMatchObject({
          kind: "deposit_held", direction: "in", amount: 100, description: "Room A rent", counterparty: "Room A",
          project: "Project X", documentRef: "R-1", notes: "n", dateEstimated: true, importRef: "2026:S1!2",
        })

        const fetched = (await db.getCompanyMovements(userId)).find((m) => m.id === created.id)
        expect(fetched).toMatchObject({ kind: "deposit_held", counterparty: "Room A", dateEstimated: true })

        await db.deleteCompanyMovement(userId, created.id)
        expect((await db.getCompanyMovements(userId)).find((m) => m.id === created.id)).toBeUndefined()
      })

      it("round-trips the rent link; a movement written without it reads null, a rent part on a non-income is refused", async () => {
        const plain = await db.createCompanyMovement(userId, income())
        expect(plain).toMatchObject({ leaseId: null, rentMonth: null, rentPart: null })
        const rent = await db.createCompanyMovement(userId, income({ leaseId: "lease-1", rentMonth: "2026-10", rentPart: "contribution" }))
        expect(rent).toMatchObject({ leaseId: "lease-1", rentMonth: "2026-10", rentPart: "contribution" })
        expect((await db.getCompanyMovements(userId)).find((m) => m.id === rent.id)).toMatchObject({ leaseId: "lease-1", rentMonth: "2026-10", rentPart: "contribution" })
        const moved = await db.updateCompanyMovement(userId, rent.id, { rentMonth: "2026-09", rentPart: "rent" })
        expect(moved).toMatchObject({ leaseId: "lease-1", rentMonth: "2026-09", rentPart: "rent" })
        const cleared = await db.updateCompanyMovement(userId, rent.id, { leaseId: null, rentMonth: null, rentPart: null })
        expect(cleared).toMatchObject({ leaseId: null, rentMonth: null, rentPart: null })
        await expect(db.createCompanyMovement(userId, income({ kind: "deposit_held", leaseId: "lease-1", rentMonth: "2026-10", rentPart: "rent" }))).rejects.toThrow()
        await expect(db.createCompanyMovement(userId, income({ rentMonth: "2026-13", rentPart: "rent" }))).rejects.toThrow()
        await expect(db.updateCompanyMovement(userId, plain.id, { kind: "vat", direction: "out", rentPart: "rent" })).rejects.toThrow()
        await Promise.all([plain, rent].map((m) => db.deleteCompanyMovement(userId, m.id)))
      })

      it("round-trips a deposit's lease, received and given back", async () => {
        const received = await db.createCompanyMovement(userId, income({ kind: "deposit_held", direction: "in", counterparty: "Room A", leaseId: "lease-1" }))
        const back = await db.createCompanyMovement(userId, income({ kind: "deposit_held", direction: "out", counterparty: "Room A", leaseId: "lease-1" }))
        const stored = await db.getCompanyMovements(userId)
        expect(stored.find((m) => m.id === received.id)).toMatchObject({ kind: "deposit_held", direction: "in", leaseId: "lease-1", rentMonth: null, rentPart: null })
        expect(stored.find((m) => m.id === back.id)).toMatchObject({ kind: "deposit_held", direction: "out", leaseId: "lease-1" })
        await Promise.all([received, back].map((m) => db.deleteCompanyMovement(userId, m.id)))
      })

      it("stores a transfer as one document out of one account into another", async () => {
        const transfer = await db.createCompanyMovement(userId, income({ kind: "transfer", direction: "out", toAccountId: "acc-b" }))
        expect(transfer).toMatchObject({ kind: "transfer", direction: "out", accountId: "acc-a", toAccountId: "acc-b" })
        const payment = await db.createCompanyMovement(userId, income({ kind: "supplier_payment", direction: "out", expenseId: "exp-1" }))
        expect(payment.expenseId).toBe("exp-1")
        await Promise.all([transfer, payment].map((m) => db.deleteCompanyMovement(userId, m.id)))
      })

      it("lists the user's movements newest first, never another user's", async () => {
        const older = await db.createCompanyMovement(userId, income({ date: new Date("2026-01-10") }))
        const newer = await db.createCompanyMovement(userId, income({ date: new Date("2026-03-10") }))
        const list = await db.getCompanyMovements(userId)
        expect(list.every((m) => m.userId === userId)).toBe(true)
        expect(list.findIndex((m) => m.id === newer.id)).toBeLessThan(list.findIndex((m) => m.id === older.id))
        expect(await db.getCompanyMovements(otherUserId)).toEqual([])
        await Promise.all([older, newer].map((m) => db.deleteCompanyMovement(userId, m.id)))
      })

      it.each([
        ["a transfer to the same account", { kind: "transfer", direction: "out", toAccountId: "acc-a" }],
        ["a transfer coming in", { kind: "transfer", direction: "in", toAccountId: "acc-b" }],
        ["a supplier payment without its document", { kind: "supplier_payment", direction: "out" }],
        ["a destination on a non-transfer", { toAccountId: "acc-b" }],
        ["a zero amount", { amount: 0 }],
        ["an empty description", { description: "" }],
      ] as const)("refuses %s", async (_, over) => {
        await expect(db.createCompanyMovement(userId, income(over))).rejects.toThrow()
      })

      it("checks the whole movement on update", async () => {
        const created = await db.createCompanyMovement(userId, income())
        // Becoming a transfer needs its destination in the same write.
        await expect(db.updateCompanyMovement(userId, created.id, { kind: "transfer", direction: "out" })).rejects.toThrow()
        const moved = await db.updateCompanyMovement(userId, created.id, { kind: "transfer", direction: "out", toAccountId: "acc-b" })
        expect(moved).toMatchObject({ kind: "transfer", toAccountId: "acc-b" })
        await expect(db.updateCompanyMovement(userId, created.id, { accountId: "acc-b" })).rejects.toThrow()
        await db.deleteCompanyMovement(userId, created.id)
      })
    })

    describe("deleting a company account", () => {
      const newAccount = (name: string) =>
        db.createCompanyAccount(userId, { name, openingBalance: 0, openingDate: new Date("2026-05-01") })
      const accountIds = async () => (await db.getCompanyAccounts(userId)).map((a) => a.id)

      it("refuses while a movement leaves it or lands on it", async () => {
        const [from, into] = await Promise.all([newAccount("Guard from"), newAccount("Guard into")])
        const transfer = await db.createCompanyMovement(userId, {
          kind: "transfer", direction: "out", amount: 50, date: new Date("2026-06-01"),
          accountId: from.id, toAccountId: into.id, description: "Between own accounts",
        })
        await expect(db.deleteCompanyAccount(userId, from.id)).rejects.toThrow(ACCOUNT_HAS_ENTRIES)
        await expect(db.deleteCompanyAccount(userId, into.id)).rejects.toThrow(ACCOUNT_HAS_ENTRIES)
        expect(await accountIds()).toEqual(expect.arrayContaining([from.id, into.id]))

        await db.deleteCompanyMovement(userId, transfer.id)
        await db.deleteCompanyAccount(userId, from.id)
        await db.deleteCompanyAccount(userId, into.id)
        expect(await accountIds()).not.toContain(from.id)
        expect(await accountIds()).not.toContain(into.id)
      })

      it("refuses while a cost was paid from it", async () => {
        const account = await newAccount("Guard cost")
        const fee = await db.createCompanyExpense(userId, {
          description: "Bank fee", category: "bank_fees", amount: 3, date: new Date("2026-06-01"), accountId: account.id,
        })
        await expect(db.deleteCompanyAccount(userId, account.id)).rejects.toThrow(ACCOUNT_HAS_ENTRIES)
        await db.deleteCompanyExpense(userId, fee.id)
        await db.deleteCompanyAccount(userId, account.id)
        expect(await accountIds()).not.toContain(account.id)
      })

      it("refuses while a loan went through it", async () => {
        const account = await newAccount("Guard loan")
        const loan = await db.createCompanyLoan(userId, {
          description: "Lend to SRL", direction: "to_company", amount: 500, date: new Date("2026-06-01"), accountId: account.id,
        })
        await expect(db.deleteCompanyAccount(userId, account.id)).rejects.toThrow(ACCOUNT_HAS_ENTRIES)
        await db.deleteCompanyLoan(userId, loan.id)
        await db.deleteCompanyAccount(userId, account.id)
        expect(await accountIds()).not.toContain(account.id)
      })

      it("refuses while an invoice is paid into it, and clears it from an unticked one", async () => {
        const account = await newAccount("Guard invoice")
        const invoice = await db.createInvoice(userId, {
          clientId: "invoice-client", number: "guard", yearMonth: "2027-01", amount: 100, vat: 22,
          paidDate: new Date("2027-02-01"), paidAccountId: account.id,
        })
        await expect(db.deleteCompanyAccount(userId, account.id)).rejects.toThrow(ACCOUNT_HAS_ENTRIES)

        // An untick keeps the account on the invoice, but an unpaid invoice holds no cash.
        await db.updateInvoice(userId, invoice.id, { paidDate: null })
        await db.deleteCompanyAccount(userId, account.id)
        expect(await accountIds()).not.toContain(account.id)

        // The delete clears the kept account, so a re-tick with the date alone
        // (Deadlines Undo, mark_invoice_paid) cannot pay into the gone account.
        const reticked = await db.updateInvoice(userId, invoice.id, { paidDate: new Date("2027-02-02") })
        expect(reticked.paidAccountId).toBeNull()
        await db.deleteInvoice(userId, invoice.id)
      })
    })

    // ── CRM Clients ────────────────────────────────────────────────────────

    describe("deleting a client with cash", () => {
      it("refuses while one of its invoices is paid into a company account, by client or by contract", async () => {
        const client = await db.createClient(userId, { name: "Cash Guard Client" })
        const engagement = await db.createEngagement(userId, {
          clientId: client.id, dailyRate: 500, vatApplicable: true, defaultDaysPerMonth: 5,
        })
        const own = await db.createInvoice(userId, {
          clientId: client.id, number: "cash-1", yearMonth: "2026-09", amount: 100, vat: 22,
          paidDate: new Date("2026-10-01"), paidAccountId: "acc-cash",
        })
        await expect(db.deleteClient(userId, client.id)).rejects.toThrow(CLIENT_HAS_CASH)

        // Unpaid with a kept account, or offset with no money: no balance moves.
        await db.updateInvoice(userId, own.id, { paidDate: null })
        const offset = await db.createInvoice(userId, {
          clientId: client.id, number: "cash-2", yearMonth: "2026-09", amount: 100, vat: 22,
          paidDate: new Date("2026-10-01"), paidAccountId: NON_CASH,
        })
        // An invoice from before invoices named their customer, found by its contract.
        const legacyId = await seedLegacyInvoice(engagement.id, "cash-3")
        await db.updateInvoice(userId, legacyId, { paidDate: new Date("2026-10-02"), paidAccountId: "acc-cash" })
        await expect(db.deleteClient(userId, client.id)).rejects.toThrow(CLIENT_HAS_CASH)

        await db.updateInvoice(userId, legacyId, { paidDate: null })
        await db.deleteClient(userId, client.id)
        expect((await db.getClients(userId)).map((c) => c.id)).not.toContain(client.id)
        const left = (await db.getInvoices(userId)).map((i) => i.id)
        expect(left).not.toContain(own.id)
        expect(left).not.toContain(offset.id)
        expect(left).not.toContain(legacyId)
      })
    })

    describe("clients", () => {
      it("CRUD roundtrip", async () => {
        const created = await db.createClient(userId, {
          name: "Acme SpA",
          vatNumber: "IT01234567890",
          email: "billing@acme.example",
          contactName: "Maria Rossi",
          contactPhone: "+39 340 1234567",
        })
        expect(created.id).toBeTruthy()
        expect(created.name).toBe("Acme SpA")
        expect(created.vatNumber).toBe("IT01234567890")
        expect(created.contactName).toBe("Maria Rossi")
        expect(created.contactPhone).toBe("+39 340 1234567")
        expect(created.notes).toBeNull()
        expect(created.isActive).toBe(true)

        const updated = await db.updateClient(userId, created.id, {
          name: "Acme Srl",
          contactName: "Luca Bianchi",
        })
        expect(updated.name).toBe("Acme Srl")
        expect(updated.contactName).toBe("Luca Bianchi")
        // Untouched by the update — a partial input must not blank a sibling field.
        expect(updated.contactPhone).toBe("+39 340 1234567")

        const fetched = (await db.getClients(userId)).find((c) => c.id === created.id) ?? null
        expect(fetched).not.toBeNull()
        expect(fetched!.name).toBe("Acme Srl")

        await db.deleteClient(userId, created.id)
        expect((await db.getClients(userId)).find((c) => c.id === created.id)).toBeUndefined()
      })

      it("lists clients for user only", async () => {
        await db.createClient(userId, { name: "Client A" })
        const list = await db.getClients(userId)
        expect(list.length).toBeGreaterThanOrEqual(1)
        expect(list.every((c) => c.userId === userId)).toBe(true)
      })

      it("deactivates without deleting", async () => {
        const created = await db.createClient(userId, { name: "Dormant Client" })
        const updated = await db.updateClient(userId, created.id, { isActive: false })
        expect(updated.isActive).toBe(false)
      })
    })

    // ── CRM Opportunities ──────────────────────────────────────────────────

    describe("opportunities", () => {
      let clientId: string

      beforeAll(async () => {
        const client = await db.createClient(userId, { name: "Pipeline Client" })
        clientId = client.id
      })

      function baseInput(overrides: Record<string, unknown> = {}) {
        return {
          clientId,
          title: "Retainer 2027",
          stage: "lead" as const,
          probability: 20,
          dailyRate: 600,
          estimatedDaysPerMonth: 10,
          estimatedDurationMonths: 6,
          vatApplicable: true,
          ...overrides,
        }
      }

      it("CRUD roundtrip", async () => {
        const created = await db.createOpportunity(userId, baseInput())
        expect(created.id).toBeTruthy()
        expect(created.clientId).toBe(clientId)
        expect(created.stage).toBe("lead")
        expect(created.probability).toBe(20)
        expect(created.estimatedDurationMonths).toBe(6)
        // Closing fields start empty — they are only set by winning or losing.
        expect(created.lostReason).toBeNull()
        expect(created.closedAt).toBeNull()
        expect(created.engagementId).toBeNull()

        const updated = await db.updateOpportunity(userId, created.id, { dailyRate: 650 })
        expect(updated.dailyRate).toBe(650)

        const fetched = (await db.getOpportunities(userId)).find((o) => o.id === created.id) ?? null
        expect(fetched).not.toBeNull()
        expect(fetched!.dailyRate).toBe(650)

        await db.deleteOpportunity(userId, created.id)
        expect((await db.getOpportunities(userId)).find((o) => o.id === created.id)).toBeUndefined()
      })

      it("lists opportunities for user only", async () => {
        await db.createOpportunity(userId, baseInput({ title: "Listed" }))
        const list = await db.getOpportunities(userId)
        expect(list.length).toBeGreaterThanOrEqual(1)
        expect(list.every((o) => o.userId === userId)).toBe(true)
      })

      it("advances through stages and records the probability", async () => {
        const created = await db.createOpportunity(userId, baseInput({ title: "Advancing" }))
        const proposal = await db.updateOpportunity(userId, created.id, {
          stage: "proposal",
          probability: 50,
        })
        expect(proposal.stage).toBe("proposal")
        expect(proposal.probability).toBe(50)

        const negotiation = await db.updateOpportunity(userId, created.id, {
          stage: "negotiation",
          probability: 75,
        })
        expect(negotiation.stage).toBe("negotiation")
        expect(negotiation.probability).toBe(75)
      })

      it("links to the contract it becomes when won", async () => {
        const opportunity = await db.createOpportunity(userId, baseInput({ title: "Winner" }))
        const engagement = await db.createEngagement(userId, {
          clientId,
          opportunityId: opportunity.id,
          dailyRate: 600,
          vatApplicable: true,
          defaultDaysPerMonth: 10,
        })
        const won = await db.updateOpportunity(userId, opportunity.id, {
          stage: "won",
          probability: 100,
          closedAt: new Date("2026-09-01"),
          engagementId: engagement.id,
        })
        expect(won.stage).toBe("won")
        expect(won.engagementId).toBe(engagement.id)
        expect(won.closedAt).toBeInstanceOf(Date)
        expect(engagement.opportunityId).toBe(opportunity.id)
      })

      it("records why a deal was lost", async () => {
        const created = await db.createOpportunity(userId, baseInput({ title: "Loser" }))
        const lost = await db.updateOpportunity(userId, created.id, {
          stage: "lost",
          probability: 0,
          lostReason: "Prezzo troppo alto",
          closedAt: new Date("2026-09-02"),
        })
        expect(lost.stage).toBe("lost")
        expect(lost.lostReason).toBe("Prezzo troppo alto")
      })

      it("keeps nullable planning fields nullable", async () => {
        const created = await db.createOpportunity(
          userId,
          baseInput({ title: "Undated", expectedStartMonth: null, nextActionDate: null }),
        )
        expect(created.expectedStartMonth).toBeNull()
        expect(created.nextActionDate).toBeNull()

        const scheduled = await db.updateOpportunity(userId, created.id, {
          expectedStartMonth: "2027-01",
          nextActionDate: new Date("2026-10-15"),
          nextActionNote: "Richiamare",
        })
        expect(scheduled.expectedStartMonth).toBe("2027-01")
        expect(scheduled.nextActionDate).toBeInstanceOf(Date)
        expect(scheduled.nextActionNote).toBe("Richiamare")
      })
    })

    // ── Engagements (signed contracts) ─────────────────────────────────────

    describe("engagements", () => {
      let clientId: string

      beforeAll(async () => {
        const client = await db.createClient(userId, { name: "Contract Client" })
        clientId = client.id
      })

      it("CRUD roundtrip", async () => {
        const created = await db.createEngagement(userId, {
          clientId,
          dailyRate: 75,
          vatApplicable: true,
          defaultDaysPerMonth: 15,
        })
        expect(created.id).toBeTruthy()
        expect(created.clientId).toBe(clientId)
        expect(created.dailyRate).toBe(75)
        expect(created.defaultDaysPerMonth).toBe(15)
        expect(created.vatApplicable).toBe(true)
        expect(created.contractedDays).toBeNull()
        expect(created.opportunityId).toBeNull()
        expect(created.isActive).toBe(true)

        const updated = await db.updateEngagement(userId, created.id, { dailyRate: 85 })
        expect(updated.dailyRate).toBe(85)

        const fetched = (await db.getEngagements(userId)).find((e) => e.id === created.id) ?? null
        expect(fetched).not.toBeNull()
        expect(fetched!.dailyRate).toBe(85)

        await db.deleteEngagement(userId, created.id)
        expect((await db.getEngagements(userId)).find((e) => e.id === created.id)).toBeUndefined()
      })

      it("lists engagements for user only", async () => {
        await db.createEngagement(userId, {
          clientId,
          dailyRate: 50,
          vatApplicable: false,
          defaultDaysPerMonth: 5,
        })
        const list = await db.getEngagements(userId)
        expect(list.length).toBeGreaterThanOrEqual(1)
        expect(list.every((e) => e.userId === userId)).toBe(true)
      })

      it("toggles isActive", async () => {
        const created = await db.createEngagement(userId, {
          clientId,
          dailyRate: 60,
          vatApplicable: true,
          defaultDaysPerMonth: 10,
        })
        const deactivated = await db.updateEngagement(userId, created.id, { isActive: false })
        expect(deactivated.isActive).toBe(false)
      })

      it("persists the contracted-days budget and its removal", async () => {
        const created = await db.createEngagement(userId, {
          clientId,
          dailyRate: 80,
          vatApplicable: false,
          defaultDaysPerMonth: 10,
          contractedDays: 60,
          startMonth: "2027-02",
        })
        expect(created.contractedDays).toBe(60)
        expect(created.startMonth).toBe("2027-02")

        const updated = await db.updateEngagement(userId, created.id, { contractedDays: null })
        expect(updated.contractedDays).toBeNull()
      })

      it("persists a name, defaults it to null, and renames", async () => {
        const unnamed = await db.createEngagement(userId, {
          clientId,
          dailyRate: 70,
          vatApplicable: true,
          defaultDaysPerMonth: 8,
        })
        expect(unnamed.name).toBeNull()

        const named = await db.createEngagement(userId, {
          clientId,
          name: "Migrazione cloud",
          dailyRate: 70,
          vatApplicable: true,
          defaultDaysPerMonth: 8,
        })
        expect(named.name).toBe("Migrazione cloud")

        // A rate change must not wipe the name (firebase.ts builds updates field by field).
        await db.updateEngagement(userId, named.id, { dailyRate: 72 })
        const renamed = await db.updateEngagement(userId, named.id, { name: "Audit sicurezza" })
        expect(renamed.name).toBe("Audit sicurezza")
        const cleared = await db.updateEngagement(userId, unnamed.id, { name: "Nuovo" })
        expect(cleared.name).toBe("Nuovo")
        expect((await db.updateEngagement(userId, cleared.id, { name: null })).name).toBeNull()

        const fetched = (await db.getEngagements(userId)).find((e) => e.id === named.id)
        expect(fetched?.name).toBe("Audit sicurezza")
      })

      it("persists an end month, defaults it to null, and closes with it", async () => {
        const open = await db.createEngagement(userId, {
          clientId,
          dailyRate: 70,
          vatApplicable: true,
          defaultDaysPerMonth: 8,
        })
        expect(open.endMonth).toBeNull()

        const planned = await db.createEngagement(userId, {
          clientId,
          dailyRate: 70,
          vatApplicable: true,
          defaultDaysPerMonth: 8,
          startMonth: "2027-01",
          endMonth: "2027-06",
        })
        expect(planned.endMonth).toBe("2027-06")

        // Closing is one update writing both; a later edit must not wipe the end.
        await db.updateEngagement(userId, open.id, { isActive: false, endMonth: "2026-06" })
        await db.updateEngagement(userId, open.id, { dailyRate: 72 })
        const fetched = (await db.getEngagements(userId)).find((e) => e.id === open.id)
        expect(fetched).toMatchObject({ isActive: false, endMonth: "2026-06", dailyRate: 72 })

        expect((await db.updateEngagement(userId, planned.id, { endMonth: null })).endMonth).toBeNull()
      })

      it("persists an end date, defaults it to null, keeps it across edits, and clears it", async () => {
        const legacy = await db.createEngagement(userId, {
          clientId,
          dailyRate: 70,
          vatApplicable: true,
          defaultDaysPerMonth: 8,
          endMonth: "2026-06",
        })
        expect(legacy).toMatchObject({ endMonth: "2026-06", endDate: null })

        const dated = await db.createEngagement(userId, {
          clientId,
          dailyRate: 70,
          vatApplicable: true,
          defaultDaysPerMonth: 8,
          endMonth: "2026-08",
          endDate: "2026-08-20",
        })
        expect(dated.endDate).toBe("2026-08-20")

        await db.updateEngagement(userId, legacy.id, { isActive: false, endMonth: "2026-06", endDate: "2026-06-12" })
        await db.updateEngagement(userId, legacy.id, { dailyRate: 72 })
        const fetched = (await db.getEngagements(userId)).find((e) => e.id === legacy.id)
        expect(fetched).toMatchObject({ isActive: false, endMonth: "2026-06", endDate: "2026-06-12", dailyRate: 72 })

        const reopened = await db.updateEngagement(userId, dated.id, { endMonth: null, endDate: null })
        expect(reopened).toMatchObject({ endMonth: null, endDate: null })
      })

      describe("amendments", () => {
        const entry = (from: string, o: Record<string, unknown> = {}) => ({
          from, dailyRate: null, addedDays: null, lastDay: null, lastDayBefore: null, note: null, ...o,
        })
        const addendum = entry("2026-10", { addedDays: 40, lastDay: "2027-01-31", lastDayBefore: "2026-12-31", note: "Addendum 2" })
        const raise = entry("2027-01", { dailyRate: 800 })
        const contract = () =>
          db.createEngagement(userId, {
            clientId, dailyRate: 700, vatApplicable: false, defaultDaysPerMonth: 10, contractedDays: 80,
            startMonth: "2026-01", endMonth: "2026-12", endDate: "2026-12-31",
          })
        const read = async (id: string) => (await db.getEngagements(userId)).find((e) => e.id === id)

        it("reads a contract that never had any as none", async () => {
          const created = await contract()
          expect(created.amendments ?? []).toEqual([])
          expect((await read(created.id))?.amendments ?? []).toEqual([])
        })

        it("writes the list with the end and isActive in one update, and reads them back together", async () => {
          const created = await contract()
          await db.updateEngagement(userId, created.id, { isActive: false })
          const amended = await db.updateEngagement(userId, created.id, {
            amendments: [addendum, raise], endMonth: "2027-01", endDate: "2027-01-31", isActive: true,
          })
          const expected = { amendments: [addendum, raise], endMonth: "2027-01", endDate: "2027-01-31", isActive: true, contractedDays: 80, dailyRate: 700 }
          expect(amended).toMatchObject(expected)
          expect(await read(created.id)).toMatchObject(expected)
        })

        it("keeps the list across unrelated updates, then replaces and clears it", async () => {
          const created = await contract()
          await db.updateEngagement(userId, created.id, { amendments: [addendum, raise] })
          await db.updateEngagement(userId, created.id, { name: "Migration" })
          await db.updateEngagement(userId, created.id, { dailyRate: 770 })
          await db.updateEngagement(userId, created.id, { isActive: false, endMonth: "2026-11", endDate: "2026-11-30" })
          expect((await read(created.id))?.amendments).toEqual([addendum, raise])

          expect((await db.updateEngagement(userId, created.id, { amendments: [raise] })).amendments).toEqual([raise])
          expect((await db.updateEngagement(userId, created.id, { amendments: [] })).amendments).toEqual([])
          expect((await read(created.id))?.amendments).toEqual([])
        })

        it("never hands a malformed entry, or the caller's own array, back to a reader", async () => {
          const created = await contract()
          const list = [raise, { from: "2027-02", dailyRate: "900" }, entry("2027-03")] as typeof raise[]
          await db.updateEngagement(userId, created.id, { amendments: list })
          list.push(entry("2027-04", { dailyRate: 999 }))
          expect((await read(created.id))?.amendments).toEqual([raise])
        })
      })
    })

    // ── Tasks (per-engagement to-dos) ──────────────────────────────────────

    describe("tasks", () => {
      it("CRUD roundtrip", async () => {
        const engagement = await db.createEngagement(userId, {
          clientId: "task-client",
          dailyRate: 500,
          vatApplicable: true,
          defaultDaysPerMonth: 5,
        })
        const created = await db.createTask(userId, {
          clientId: "task-client",
          engagementId: engagement.id,
          title: "Kickoff call",
          dueDate: new Date("2027-01-10"),
          notes: "prepara agenda",
        })
        expect(created.id).toBeTruthy()
        expect(created.engagementId).toBe(engagement.id)
        expect(created.title).toBe("Kickoff call")
        expect(created.notes).toBe("prepara agenda")
        // Nothing is done the moment you write it down.
        expect(created.isDone).toBe(false)

        const ticked = await db.updateTask(userId, created.id, { isDone: true })
        expect(ticked.isDone).toBe(true)

        await db.deleteTask(userId, created.id)
        const remaining = await db.getTasks(userId)
        expect(remaining.find((t) => t.id === created.id)).toBeUndefined()
        await db.deleteEngagement(userId, engagement.id)
      })

      it("keeps an omitted dueDate and notes null", async () => {
        const engagement = await db.createEngagement(userId, {
          clientId: "task-client",
          dailyRate: 500,
          vatApplicable: true,
          defaultDaysPerMonth: 5,
        })
        const created = await db.createTask(userId, {
          clientId: "task-client",
          engagementId: engagement.id,
          title: "Senza scadenza",
        })
        expect(created.dueDate).toBeNull()
        expect(created.notes).toBeNull()
        await db.deleteEngagement(userId, engagement.id)
      })

      it("is born todo, then round-trips startedAt through doing, done and back", async () => {
        const engagement = await db.createEngagement(userId, {
          clientId: "task-client",
          dailyRate: 500,
          vatApplicable: true,
          defaultDaysPerMonth: 5,
        })
        const created = await db.createTask(userId, { clientId: "task-client", engagementId: engagement.id, title: "Bozza" })
        expect(created.startedAt).toBeNull()

        const started = new Date("2026-09-24T10:00:00Z")
        const doing = await db.updateTask(userId, created.id, { startedAt: started })
        expect(doing.startedAt?.getTime()).toBe(started.getTime())

        // A write that omits startedAt must keep it (firebase.ts builds updates field by field).
        const done = await db.updateTask(userId, created.id, { isDone: true })
        expect(done.startedAt?.getTime()).toBe(started.getTime())
        const fetched = (await db.getTasks(userId)).find((t) => t.id === created.id)
        expect(fetched?.startedAt?.getTime()).toBe(started.getTime())

        const todo = await db.updateTask(userId, created.id, { isDone: false, startedAt: null })
        expect(todo.startedAt).toBeNull()
        expect(todo.isDone).toBe(false)
        await db.deleteEngagement(userId, engagement.id)
      })

      it("round-trips labels: normalized on create, [] when omitted, replaced on update", async () => {
        const engagement = await db.createEngagement(userId, {
          clientId: "task-client",
          dailyRate: 500,
          vatApplicable: true,
          defaultDaysPerMonth: 5,
        })
        const labelled = await db.createTask(userId, {
          clientId: "task-client",
          engagementId: engagement.id,
          title: "Con etichette",
          labels: [" Urgente ", "urgente", "Cliente"],
        })
        expect(labelled.labels).toEqual(["Urgente", "Cliente"])
        const plain = await db.createTask(userId, {
          clientId: "task-client",
          engagementId: engagement.id,
          title: "Senza etichette",
        })
        expect(plain.labels).toEqual([])

        // A write that omits labels must keep them (firebase.ts builds updates field by field).
        const ticked = await db.updateTask(userId, labelled.id, { isDone: true })
        expect(ticked.labels).toEqual(["Urgente", "Cliente"])

        const relabelled = await db.updateTask(userId, labelled.id, { labels: ["Bug", "  bug  "] })
        expect(relabelled.labels).toEqual(["Bug"])
        const cleared = await db.updateTask(userId, plain.id, { labels: [] })
        expect(cleared.labels).toEqual([])
        const fetched = new Map((await db.getTasks(userId)).map((t) => [t.id, t.labels]))
        expect(fetched.get(labelled.id)).toEqual(["Bug"])
        expect(fetched.get(plain.id)).toEqual([])
        await db.deleteEngagement(userId, engagement.id)
      })

      // ── Client-level tasks (#164) ──

      const contractOf = (clientId: string) =>
        db.createEngagement(userId, { clientId, dailyRate: 500, vatApplicable: true, defaultDaysPerMonth: 5 })
      const taskById = async (id: string) => (await db.getTasks(userId)).find((t) => t.id === id)

      it("creates a client-level task, attaches it to a contract and detaches it again", async () => {
        const client = await db.createClient(userId, { name: "Task Owner" })
        const created = await db.createTask(userId, { clientId: client.id, title: "Chiamata di cortesia" })
        expect(created).toMatchObject({ clientId: client.id, engagementId: null })
        expect(await taskById(created.id)).toMatchObject({ clientId: client.id, engagementId: null })

        const contract = await contractOf(client.id)
        const attached = await db.updateTask(userId, created.id, { engagementId: contract.id, clientId: client.id })
        expect(attached).toMatchObject({ clientId: client.id, engagementId: contract.id })
        // A write that omits both must keep them (firebase.ts builds updates field by field).
        expect(await db.updateTask(userId, created.id, { isDone: true })).toMatchObject({
          clientId: client.id, engagementId: contract.id,
        })

        const detached = await db.updateTask(userId, created.id, { engagementId: null })
        expect(detached).toMatchObject({ clientId: client.id, engagementId: null })
        expect(await taskById(created.id)).toMatchObject({ clientId: client.id, engagementId: null })
        await db.deleteClient(userId, client.id)
      })

      it("reads a task written before #164 with no clientId, and still updates it", async () => {
        const contract = await contractOf("legacy-client")
        const id = await seedLegacyTask(contract.id, "Vecchia attività")
        expect(await taskById(id)).toMatchObject({ clientId: null, engagementId: contract.id, labels: [] })
        expect(await db.updateTask(userId, id, { isDone: true })).toMatchObject({
          clientId: null, engagementId: contract.id, isDone: true,
        })
        await db.deleteEngagement(userId, contract.id)
      })

      it("deleting a contract keeps its tasks, as client-level tasks of its client", async () => {
        const contract = await contractOf("task-client")
        const task = await db.createTask(userId, {
          clientId: "task-client",
          engagementId: contract.id,
          title: "Sopravvive al contratto",
          labels: ["Urgente"],
        })
        const legacy = await seedLegacyTask(contract.id, "Vecchia, sopravvive anche lei")

        await db.deleteEngagement(userId, contract.id)
        expect(await taskById(task.id)).toMatchObject({
          clientId: "task-client", engagementId: null, title: "Sopravvive al contratto", labels: ["Urgente"],
        })
        // The old document gains the client it only had through the contract.
        expect(await taskById(legacy)).toMatchObject({ clientId: "task-client", engagementId: null })
      })

      it("deleting a client deletes its client-level tasks, its contracts' tasks and their old ones", async () => {
        const [doomed, spared] = await Promise.all([
          db.createClient(userId, { name: "Task Cascade" }),
          db.createClient(userId, { name: "Task Bystander" }),
        ])
        const [doomedContract, sparedContract] = await Promise.all([contractOf(doomed.id), contractOf(spared.id)])
        const gone = await Promise.all([
          db.createTask(userId, { clientId: doomed.id, title: "Del cliente" }).then((t) => t.id),
          db.createTask(userId, { clientId: doomed.id, engagementId: doomedContract.id, title: "Del contratto" })
            .then((t) => t.id),
          seedLegacyTask(doomedContract.id, "Vecchia del contratto"),
        ])
        const kept = await Promise.all([
          db.createTask(userId, { clientId: spared.id, title: "Altro cliente" }).then((t) => t.id),
          seedLegacyTask(sparedContract.id, "Vecchia di un altro contratto"),
        ])

        await db.deleteClient(userId, doomed.id)
        const ids = new Set((await db.getTasks(userId)).map((t) => t.id))
        for (const id of gone) expect(ids.has(id), id).toBe(false)
        for (const id of kept) expect(ids.has(id), id).toBe(true)
        await db.deleteClient(userId, spared.id)
      })

      it("moving a contract to another client moves its tasks, old ones included", async () => {
        const contract = await contractOf("task-from")
        const task = await db.createTask(userId, { clientId: "task-from", engagementId: contract.id, title: "Segue" })
        const legacy = await seedLegacyTask(contract.id, "Segue anche lei")
        const stays = await db.createTask(userId, { clientId: "task-from", title: "Resta al cliente" })

        await db.updateEngagement(userId, contract.id, { clientId: "task-to" })
        expect(await taskById(task.id)).toMatchObject({ clientId: "task-to", engagementId: contract.id })
        expect(await taskById(legacy)).toMatchObject({ clientId: "task-to", engagementId: contract.id })
        expect(await taskById(stays.id)).toMatchObject({ clientId: "task-from", engagementId: null })
        await db.deleteEngagement(userId, contract.id)
      })
    })

    // ── Timecards (hours per contract per day) ─────────────────────────────

    describe("timecards", () => {
      const newEngagement = (clientId = "timecard-client") =>
        db.createEngagement(userId, { clientId, dailyRate: 500, vatApplicable: true, defaultDaysPerMonth: 5 })
      const hoursOf = async (engagementId: string) =>
        (await db.getTimecards(userId))
          .filter((t) => t.engagementId === engagementId)
          .map((t) => [t.date, t.hours])

      it("setting the same contract and day twice leaves one document with the second value and the first createdAt", async () => {
        const engagement = await newEngagement()
        const first = await db.setTimecard(userId, {
          engagementId: engagement.id,
          date: "2026-09-21",
          hours: 6,
          notes: "analisi",
        })
        expect(first).toMatchObject({
          id: `${engagement.id}_2026-09-21`,
          engagementId: engagement.id,
          date: "2026-09-21",
          hours: 6,
          notes: "analisi",
        })

        const second = await db.setTimecard(userId, { engagementId: engagement.id, date: "2026-09-21", hours: 7.5 })
        expect(second.id).toBe(first.id)
        expect(second.hours).toBe(7.5)
        expect(second.notes).toBe("analisi") // omitted notes keep the stored one
        expect(second.createdAt.getTime()).toBe(first.createdAt.getTime())
        expect(await hoursOf(engagement.id)).toEqual([["2026-09-21", 7.5]])

        const cleared = await db.setTimecard(userId, {
          engagementId: engagement.id,
          date: "2026-09-21",
          hours: 7.5,
          notes: null,
        })
        expect(cleared.notes).toBeNull()
        await db.deleteTimecard(userId, engagement.id, "2026-09-21")
        await db.deleteEngagement(userId, engagement.id)
      })

      it("deletes one day and leaves the others", async () => {
        const engagement = await newEngagement()
        await db.setTimecard(userId, { engagementId: engagement.id, date: "2026-09-21", hours: 6 })
        await db.setTimecard(userId, { engagementId: engagement.id, date: "2026-09-22", hours: 2.5 })

        await db.deleteTimecard(userId, engagement.id, "2026-09-21")
        expect(await hoursOf(engagement.id)).toEqual([["2026-09-22", 2.5]])
        await db.deleteTimecard(userId, engagement.id, "2026-09-22")
        await db.deleteEngagement(userId, engagement.id)
      })

      it("refuses to delete a contract with hours, keeps it and its hours, and deletes it once they are cleared", async () => {
        const engagement = await newEngagement()
        await db.setTimecard(userId, { engagementId: engagement.id, date: "2026-09-21", hours: 8 })

        await expect(db.deleteEngagement(userId, engagement.id)).rejects.toThrow(CONTRACT_HAS_HOURS)
        expect((await db.getEngagements(userId)).some((e) => e.id === engagement.id)).toBe(true)
        expect(await hoursOf(engagement.id)).toEqual([["2026-09-21", 8]])

        await db.deleteTimecard(userId, engagement.id, "2026-09-21")
        await db.deleteEngagement(userId, engagement.id)
        expect((await db.getEngagements(userId)).some((e) => e.id === engagement.id)).toBe(false)
      })

      it("deleting a client deletes its contracts' timecards, and only its own", async () => {
        const [doomed, spared] = await Promise.all([
          db.createClient(userId, { name: "Timecard Cascade" }),
          db.createClient(userId, { name: "Timecard Bystander" }),
        ])
        const [doomedEng, sparedEng] = await Promise.all([newEngagement(doomed.id), newEngagement(spared.id)])
        await db.setTimecard(userId, { engagementId: doomedEng.id, date: "2026-09-22", hours: 8 })
        await db.setTimecard(userId, { engagementId: sparedEng.id, date: "2026-09-22", hours: 3 })

        await db.deleteClient(userId, doomed.id)
        expect(await hoursOf(doomedEng.id)).toEqual([])
        expect(await hoursOf(sparedEng.id)).toEqual([["2026-09-22", 3]])
        await db.deleteClient(userId, spared.id)
      })
    })

    // ── Meetings (verbali: calls and status updates) ───────────────────────

    describe("meetings", () => {
      const contractOf = (clientId: string) =>
        db.createEngagement(userId, { clientId, dailyRate: 500, vatApplicable: true, defaultDaysPerMonth: 5 })
      const meetingById = async (id: string) => (await db.getMeetings(userId)).find((m) => m.id === id)
      const verbale = { date: "2026-09-12", time: null, health: null, text: "Call di allineamento" }

      it("creates and reads back every field, nulls included", async () => {
        const contract = await contractOf("meeting-client")
        const full = await db.createMeeting(userId, {
          clientId: "meeting-client",
          engagementId: contract.id,
          date: "2026-09-12",
          time: "10:30",
          health: "yellow",
          text: "Test slittati di due settimane.\nSecondo punto.",
        })
        const bare = await db.createMeeting(userId, { ...verbale, clientId: "meeting-client", engagementId: null })

        const expected = {
          userId,
          clientId: "meeting-client",
          engagementId: contract.id,
          date: "2026-09-12",
          time: "10:30",
          health: "yellow",
          text: "Test slittati di due settimane.\nSecondo punto.",
        }
        expect(full).toMatchObject(expected)
        expect(full.id).toBeTruthy()
        expect(full.createdAt).toBeInstanceOf(Date)
        expect(full.updatedAt).toBeInstanceOf(Date)
        expect(await meetingById(full.id)).toMatchObject(expected)
        const bareExpected = { clientId: "meeting-client", engagementId: null, time: null, health: null }
        expect(bare).toMatchObject(bareExpected)
        expect(await meetingById(bare.id)).toMatchObject(bareExpected)
        await Promise.all([db.deleteMeeting(userId, full.id), db.deleteMeeting(userId, bare.id)])
        await db.deleteEngagement(userId, contract.id)
      })

      // firebase.ts builds the update record field by field: a field left out
      // there is a silent no-op in production that only this round trip catches.
      it("updates each field on its own and reads it back", async () => {
        const [a, b] = await Promise.all([contractOf("meeting-edit"), contractOf("meeting-edit")])
        const created = await db.createMeeting(userId, {
          clientId: "meeting-edit",
          engagementId: a.id,
          date: "2026-09-12",
          time: "10:30",
          health: "green",
          text: "Prima versione",
        })
        const steps: [Parameters<typeof db.updateMeeting>[2], Record<string, unknown>][] = [
          [{ date: "2026-09-11" }, { date: "2026-09-11" }],
          [{ time: "11:00" }, { time: "11:00" }],
          [{ health: "red" }, { health: "red" }],
          [{ text: "Seconda versione" }, { text: "Seconda versione" }],
          [{ engagementId: b.id }, { engagementId: b.id }],
          [{ engagementId: null }, { engagementId: null, clientId: "meeting-edit" }],
        ]
        for (const [input, expected] of steps) {
          expect(await db.updateMeeting(userId, created.id, input), JSON.stringify(input)).toMatchObject(expected)
          expect(await meetingById(created.id), JSON.stringify(input)).toMatchObject(expected)
        }
        expect(await meetingById(created.id)).toMatchObject({
          date: "2026-09-11", time: "11:00", health: "red", text: "Seconda versione", engagementId: null,
        })
        await db.deleteMeeting(userId, created.id)
        await Promise.all([db.deleteEngagement(userId, a.id), db.deleteEngagement(userId, b.id)])
      })

      it("keeps what an update omits, and clears time and health with null", async () => {
        const created = await db.createMeeting(userId, {
          clientId: "meeting-keep",
          engagementId: null,
          date: "2026-09-12",
          time: "10:30",
          health: "yellow",
          text: "Resta così",
        })
        const cleared = await db.updateMeeting(userId, created.id, { time: null, health: null })
        const expected = { time: null, health: null, text: "Resta così", date: "2026-09-12", clientId: "meeting-keep" }
        expect(cleared).toMatchObject(expected)
        expect(await meetingById(created.id)).toMatchObject(expected)
        await db.deleteMeeting(userId, created.id)
      })

      it("deletes one verbale and leaves the others", async () => {
        const [doomed, spared] = await Promise.all([
          db.createMeeting(userId, { ...verbale, clientId: "meeting-del", engagementId: null }),
          db.createMeeting(userId, { ...verbale, clientId: "meeting-del", engagementId: null }),
        ])
        await db.deleteMeeting(userId, doomed.id)
        expect(await meetingById(doomed.id)).toBeUndefined()
        expect(await meetingById(spared.id)).toBeDefined()
        await db.deleteMeeting(userId, spared.id)
      })

      it("deleting a contract keeps its verbali on the client, health intact", async () => {
        const client = await db.createClient(userId, { name: "Meeting Repoint" })
        const [doomed, spared] = await Promise.all([contractOf(client.id), contractOf(client.id)])
        const [onDoomed, onSpared] = await Promise.all([
          db.createMeeting(userId, { ...verbale, clientId: client.id, engagementId: doomed.id, health: "red" }),
          db.createMeeting(userId, { ...verbale, clientId: client.id, engagementId: spared.id, health: "green" }),
        ])

        await db.deleteEngagement(userId, doomed.id)
        expect(await meetingById(onDoomed.id)).toMatchObject({
          clientId: client.id, engagementId: null, health: "red", text: verbale.text,
        })
        expect(await meetingById(onSpared.id)).toMatchObject({ clientId: client.id, engagementId: spared.id })
        await db.deleteClient(userId, client.id)
      })

      it("deleting a client deletes its contract-level and client-level verbali, and only its own", async () => {
        const [doomed, spared] = await Promise.all([
          db.createClient(userId, { name: "Meeting Cascade" }),
          db.createClient(userId, { name: "Meeting Bystander" }),
        ])
        const [doomedContract, sparedContract] = await Promise.all([contractOf(doomed.id), contractOf(spared.id)])
        const gone = await Promise.all([
          db.createMeeting(userId, { ...verbale, clientId: doomed.id, engagementId: null }),
          db.createMeeting(userId, { ...verbale, clientId: doomed.id, engagementId: doomedContract.id }),
        ])
        const kept = await Promise.all([
          db.createMeeting(userId, { ...verbale, clientId: spared.id, engagementId: null }),
          db.createMeeting(userId, { ...verbale, clientId: spared.id, engagementId: sparedContract.id }),
        ])

        await db.deleteClient(userId, doomed.id)
        const left = new Set((await db.getMeetings(userId)).map((m) => m.id))
        for (const m of gone) expect(left.has(m.id), m.id).toBe(false)
        for (const m of kept) expect(left.has(m.id), m.id).toBe(true)
        await db.deleteClient(userId, spared.id)
      })

      it("moving a contract to another client carries its verbali, and leaves the client-level ones", async () => {
        const contract = await contractOf("meeting-from")
        const onContract = await db.createMeeting(userId, {
          ...verbale, clientId: "meeting-from", engagementId: contract.id, health: "yellow",
        })
        const onClient = await db.createMeeting(userId, { ...verbale, clientId: "meeting-from", engagementId: null })

        await db.updateEngagement(userId, contract.id, { clientId: "meeting-to" })
        expect(await meetingById(onContract.id)).toMatchObject({
          clientId: "meeting-to", engagementId: contract.id, health: "yellow",
        })
        expect(await meetingById(onClient.id)).toMatchObject({ clientId: "meeting-from", engagementId: null })
        await Promise.all([db.deleteMeeting(userId, onContract.id), db.deleteMeeting(userId, onClient.id)])
        await db.deleteEngagement(userId, contract.id)
      })
    })

    // ── Solutions (what was built for a client, kept for pre-sales) ────────

    describe("solutions", () => {
      const contractOf = (clientId: string) =>
        db.createEngagement(userId, { clientId, dailyRate: 500, vatApplicable: true, defaultDaysPerMonth: 5 })
      const solutionById = async (id: string) => (await db.getSolutions(userId)).find((x) => x.id === id)
      const noSections = {
        purpose: null, requirements: null, kpis: null, sources: null, model: null,
        architecture: null, steps: null, history: null, results: null,
      }
      // The fictional Nordwind Retail product knowledge graph.
      const graph = {
        entities: [
          { name: "Product", source: "SAP MARA + MAKT, Akeneo", notes: "the core, keyed by sku" },
          { name: "Category", source: "Akeneo", notes: null },
        ],
        relations: [
          { from: "Product", to: "Category", type: "IN_CATEGORY" },
          { from: "Product", to: "Product", type: "SIMILAR_TO" },
        ],
      }

      const road = [
        { title: "Audit", state: "done", fromMonth: "2026-03", toMonth: "2026-03", paidBy: null, goal: "Find the slow queries", outcome: "Nine found", doneOn: "2026-04-02" },
        { title: "Tune", state: "now", fromMonth: "2026-04", toMonth: null, paidBy: { type: "opportunity", id: "opp-1" }, goal: null, outcome: null, doneOn: null },
        { title: "Hand over", state: "later", fromMonth: "2026-09", toMonth: null, paidBy: null, goal: null, outcome: null, doneOn: null },
      ] as const

      it("creates and reads back every field, and fills in what a bare one omits", async () => {
        const contract = await contractOf("solution-client")
        const full = await db.createSolution(userId, {
          clientId: "solution-client",
          engagementId: contract.id,
          name: "Product knowledge graph",
          status: "delivered",
          domain: "retail",
          stack: ["neo4j", "gds", "kafka"],
          sections: { purpose: "180,000 SKUs in three systems.", history: "2026-02-10 Kickoff" },
          kind: "advisory",
          target: "Every report under 2 s",
          steps: [...road],
          ...graph,
        })
        const bare = await db.createSolution(userId, { clientId: "solution-client", name: "Search pilot" })

        const expected = {
          userId,
          clientId: "solution-client",
          engagementId: contract.id,
          name: "Product knowledge graph",
          status: "delivered",
          domain: "retail",
          stack: ["neo4j", "gds", "kafka"],
          sections: { ...noSections, purpose: "180,000 SKUs in three systems.", history: "2026-02-10 Kickoff" },
          kind: "advisory",
          target: "Every report under 2 s",
          steps: road,
          ...graph,
        }
        expect(full).toMatchObject(expected)
        expect(full.id).toBeTruthy()
        expect(full.createdAt).toBeInstanceOf(Date)
        expect(full.updatedAt).toBeInstanceOf(Date)
        expect(await solutionById(full.id)).toMatchObject(expected)
        const bareExpected = {
          clientId: "solution-client", engagementId: null, name: "Search pilot", status: "proposed", domain: null,
          stack: [], sections: noSections, entities: [], relations: [],
          // A solution filed with no kind reads as a product with no target and no road.
          kind: "product", target: null, steps: [],
        }
        expect(bare).toMatchObject(bareExpected)
        expect(await solutionById(bare.id)).toMatchObject(bareExpected)
        expect(await db.getSolutions(otherUserId)).toEqual([])
        await Promise.all([db.deleteSolution(userId, full.id), db.deleteSolution(userId, bare.id)])
        await db.deleteEngagement(userId, contract.id)
      })

      // firebase.ts builds the update record field by field: a field left out
      // there is a silent no-op in production that only this round trip catches.
      it("updates each field on its own, one section at a time, and reads it back", async () => {
        const [a, b] = await Promise.all([contractOf("solution-edit"), contractOf("solution-edit")])
        const created = await db.createSolution(userId, {
          clientId: "solution-edit", engagementId: a.id, name: "First", sections: { purpose: "Why" },
        })
        const steps: [Parameters<typeof db.updateSolution>[2], Record<string, unknown>][] = [
          [{ name: "Second" }, { name: "Second" }],
          [{ status: "building" }, { status: "building" }],
          [{ domain: "retail" }, { domain: "retail" }],
          // The client SDK stores the tag as given; it reads back as zod writes it.
          [{ stack: ["Neo4j", "kafka"] }, { stack: ["neo4j", "kafka"] }],
          [{ sections: { kpis: "Zero-result searches from 12% to under 5%" } }, {
            sections: { ...noSections, purpose: "Why", kpis: "Zero-result searches from 12% to under 5%" },
          }],
          [{ sections: { purpose: null, results: "Live in July" } }, {
            sections: { ...noSections, kpis: "Zero-result searches from 12% to under 5%", results: "Live in July" },
          }],
          // undefined = unchanged, as at the top level.
          [{ sections: { kpis: undefined, steps: "Ingest, then model" } }, {
            sections: { ...noSections, kpis: "Zero-result searches from 12% to under 5%", results: "Live in July", steps: "Ingest, then model" },
          }],
          [graph, graph],
          [{ relations: [] }, { entities: graph.entities, relations: [] }],
          [{ engagementId: b.id }, { engagementId: b.id }],
          [{ engagementId: null }, { engagementId: null, clientId: "solution-edit" }],
          [{ domain: null, stack: [] }, { domain: null, stack: [] }],
          [{ kind: "advisory" }, { kind: "advisory" }],
          [{ target: "Every report under 2 s" }, { target: "Every report under 2 s" }],
          [{ steps: [...road] }, { steps: road, kind: "advisory", target: "Every report under 2 s" }],
          [{ steps: [] }, { steps: [] }],
          [{ target: null, kind: "product" }, { target: null, kind: "product" }],
        ]
        for (const [input, expected] of steps) {
          expect(await db.updateSolution(userId, created.id, input), JSON.stringify(input)).toMatchObject(expected)
          expect(await solutionById(created.id), JSON.stringify(input)).toMatchObject(expected)
        }
        expect(await solutionById(created.id)).toMatchObject({ name: "Second", status: "building", engagementId: null })
        await db.deleteSolution(userId, created.id)
        await Promise.all([db.deleteEngagement(userId, a.id), db.deleteEngagement(userId, b.id)])
      })

      it("deletes one solution and leaves the others", async () => {
        const [doomed, spared] = await Promise.all([
          db.createSolution(userId, { clientId: "solution-del", name: "Doomed" }),
          db.createSolution(userId, { clientId: "solution-del", name: "Spared" }),
        ])
        await db.deleteSolution(userId, doomed.id)
        expect(await solutionById(doomed.id)).toBeUndefined()
        expect(await solutionById(spared.id)).toBeDefined()
        await db.deleteSolution(userId, spared.id)
      })

      it("deleting a contract puts its solutions back to pre-sales, content intact", async () => {
        const client = await db.createClient(userId, { name: "Solution Unlink" })
        const [doomed, spared] = await Promise.all([contractOf(client.id), contractOf(client.id)])
        const [onDoomed, onSpared] = await Promise.all([
          db.createSolution(userId, { clientId: client.id, engagementId: doomed.id, name: "Graph", status: "delivered", ...graph }),
          db.createSolution(userId, { clientId: client.id, engagementId: spared.id, name: "Search" }),
        ])

        await db.deleteEngagement(userId, doomed.id)
        expect(await solutionById(onDoomed.id)).toMatchObject({
          clientId: client.id, engagementId: null, name: "Graph", status: "delivered", ...graph,
        })
        expect(await solutionById(onSpared.id)).toMatchObject({ clientId: client.id, engagementId: spared.id })
        await db.deleteClient(userId, client.id)
      })

      it("deleting a client deletes its solutions, pre-sales ones included, and only its own", async () => {
        const [doomed, spared] = await Promise.all([
          db.createClient(userId, { name: "Solution Cascade" }),
          db.createClient(userId, { name: "Solution Bystander" }),
        ])
        const [doomedContract, sparedContract] = await Promise.all([contractOf(doomed.id), contractOf(spared.id)])
        const gone = await Promise.all([
          db.createSolution(userId, { clientId: doomed.id, name: "Pre-sales" }),
          db.createSolution(userId, { clientId: doomed.id, engagementId: doomedContract.id, name: "Delivered" }),
        ])
        const kept = await Promise.all([
          db.createSolution(userId, { clientId: spared.id, name: "Pre-sales" }),
          db.createSolution(userId, { clientId: spared.id, engagementId: sparedContract.id, name: "Delivered" }),
        ])

        await db.deleteClient(userId, doomed.id)
        const left = new Set((await db.getSolutions(userId)).map((x) => x.id))
        for (const x of gone) expect(left.has(x.id), x.id).toBe(false)
        for (const x of kept) expect(left.has(x.id), x.id).toBe(true)
        await db.deleteClient(userId, spared.id)
      })

      it("moving a contract to another client carries its solutions, and leaves the pre-sales ones", async () => {
        const contract = await contractOf("solution-from")
        const onContract = await db.createSolution(userId, { clientId: "solution-from", engagementId: contract.id, name: "Graph" })
        const preSales = await db.createSolution(userId, { clientId: "solution-from", name: "Pilot" })

        await db.updateEngagement(userId, contract.id, { clientId: "solution-to" })
        expect(await solutionById(onContract.id)).toMatchObject({ clientId: "solution-to", engagementId: contract.id })
        expect(await solutionById(preSales.id)).toMatchObject({ clientId: "solution-from", engagementId: null })
        await Promise.all([db.deleteSolution(userId, onContract.id), db.deleteSolution(userId, preSales.id)])
        await db.deleteEngagement(userId, contract.id)
      })
    })

    // ── Journal (work sessions and decisions on a solution) ────────────────

    describe("journal", () => {
      const journalOf = async (solutionId: string) => (await db.getJournal(userId)).filter((e) => e.solutionId === solutionId)
      const session: Omit<CreateJournalEntryInput, "solutionId" | "clientId"> = {
        kind: "work", date: "2026-11-07", stepTitle: "MVP", text: "Loading rewritten as idempotent Cypher.",
        decisions: ["A stay's spend goes to the booking holder."], links: ["PR #7", "https://example.com/pull/8"],
        next: "One nightly run.", source: "Claude Code · guest-360",
      }

      it("creates, updates and deletes an entry, every field read back", async () => {
        const created = await db.createJournalEntry(userId, { solutionId: "journal-s", clientId: "journal-c", ...session })
        const bare = await db.createJournalEntry(userId, { solutionId: "journal-s", clientId: "journal-c", date: "2026-11-08", text: "Bare" })
        expect(created).toMatchObject({ userId, solutionId: "journal-s", clientId: "journal-c", ...session })
        expect(created.id).toBeTruthy()
        expect(created.createdAt).toBeInstanceOf(Date)
        expect(bare).toMatchObject({ kind: "work", stepTitle: null, decisions: [], links: [], next: null, source: null })
        expect((await journalOf("journal-s")).map((e) => e.id).sort()).toEqual([created.id, bare.id].sort())
        expect(await db.getJournal(otherUserId)).toEqual([])

        const steps: [Parameters<typeof db.updateJournalEntry>[2], Record<string, unknown>][] = [
          [{ text: "Edited" }, { text: "Edited" }],
          [{ date: "2026-11-06" }, { date: "2026-11-06" }],
          [{ stepTitle: null }, { stepTitle: null }],
          [{ decisions: [] }, { decisions: [] }],
          [{ links: ["PR #9"] }, { links: ["PR #9"] }],
          [{ next: null }, { next: null }],
          [{ source: null }, { source: null }],
        ]
        for (const [input, expected] of steps) {
          expect(await db.updateJournalEntry(userId, created.id, input), JSON.stringify(input)).toMatchObject(expected)
        }
        const stored = (await journalOf("journal-s")).find((e) => e.id === created.id)
        expect(stored).toMatchObject({ text: "Edited", date: "2026-11-06", links: ["PR #9"], solutionId: "journal-s", kind: "work" })

        await db.deleteJournalEntry(userId, created.id)
        expect((await journalOf("journal-s")).map((e) => e.id)).toEqual([bare.id])
        await db.deleteJournalEntry(userId, bare.id)
      })

      it("deleting a solution deletes its entries, and only its own", async () => {
        const [doomed, spared] = await Promise.all([
          db.createSolution(userId, { clientId: "journal-del", name: "Doomed" }),
          db.createSolution(userId, { clientId: "journal-del", name: "Spared" }),
        ])
        await db.createJournalEntry(userId, { solutionId: doomed.id, clientId: "journal-del", date: "2026-11-07", text: "Gone" })
        const kept = await db.createJournalEntry(userId, { solutionId: spared.id, clientId: "journal-del", date: "2026-11-07", text: "Kept" })
        await db.deleteSolution(userId, doomed.id)
        expect(await journalOf(doomed.id)).toEqual([])
        expect((await journalOf(spared.id)).map((e) => e.id)).toEqual([kept.id])
        await db.deleteSolution(userId, spared.id)
        await db.deleteJournalEntry(userId, kept.id)
      })

      it("deleting a client deletes the entries of its solutions, and only its own", async () => {
        const [doomed, spared] = await Promise.all([
          db.createClient(userId, { name: "Journal Cascade" }),
          db.createClient(userId, { name: "Journal Bystander" }),
        ])
        const [a, b] = await Promise.all([
          db.createSolution(userId, { clientId: doomed.id, name: "Graph" }),
          db.createSolution(userId, { clientId: spared.id, name: "Graph" }),
        ])
        const entry = (s: typeof a) => db.createJournalEntry(userId, { solutionId: s.id, clientId: s.clientId, date: "2026-11-07", text: "Work" })
        const [gone, kept] = await Promise.all([entry(a), entry(b)])

        await db.deleteClient(userId, doomed.id)
        const left = new Set((await db.getJournal(userId)).map((e) => e.id))
        expect(left.has(gone.id)).toBe(false)
        expect(left.has(kept.id)).toBe(true)
        await db.deleteClient(userId, spared.id)
      })
    })

    // ── Invoices (a customer's record of issued paper) ───────────────────

    describe("collaborators", () => {
      const byId = async (id: string) => (await db.getCollaborators(userId)).find((x) => x.id === id)
      const fee = {
        amount: 2400, from: "2026-01", until: null,
        changes: [{ from: "2027-05", amount: 2800 }, { from: "2027-03", amount: 2600 }],
      }

      it("creates and reads back every field, changes oldest first, and fills in what a bare one omits", async () => {
        const full = await db.createCollaborator(userId, { name: " Studio Verdi ", type: "company", notes: "UX", fee })
        const bare = await db.createCollaborator(userId, { name: "Giulia Neri", type: "freelancer" })
        const expected = {
          userId, name: "Studio Verdi", type: "company", notes: "UX", isActive: true,
          fee: { amount: 2400, from: "2026-01", until: null, changes: [{ from: "2027-03", amount: 2600 }, { from: "2027-05", amount: 2800 }] },
        }
        expect(full).toMatchObject(expected)
        expect(full.createdAt).toBeInstanceOf(Date)
        expect(await byId(full.id)).toMatchObject(expected)
        const bareExpected = { name: "Giulia Neri", type: "freelancer", notes: null, isActive: true, fee: null }
        expect(bare).toMatchObject(bareExpected)
        expect(await byId(bare.id)).toMatchObject(bareExpected)
        expect(await db.getCollaborators(otherUserId)).toEqual([])
        await Promise.all([db.deleteCollaborator(userId, full.id), db.deleteCollaborator(userId, bare.id)])
        expect(await byId(full.id)).toBeUndefined()
      })

      it("lists active collaborators first, then by name", async () => {
        const [b, a, z] = await Promise.all([
          db.createCollaborator(userId, { name: "b-order", type: "company" }),
          db.createCollaborator(userId, { name: "a-order", type: "company", isActive: false }),
          db.createCollaborator(userId, { name: "z-order", type: "company" }),
        ])
        const ids = (await db.getCollaborators(userId)).map((x) => x.id).filter((id) => [a.id, b.id, z.id].includes(id))
        expect(ids).toEqual([b.id, z.id, a.id])
        await Promise.all([a, b, z].map((x) => db.deleteCollaborator(userId, x.id)))
      })

      it("updates each field on its own, replaces the fee whole, and clears it", async () => {
        const c = await db.createCollaborator(userId, { name: "First", type: "freelancer", fee })
        const steps: [Parameters<typeof db.updateCollaborator>[2], Record<string, unknown>][] = [
          [{ name: "Second" }, { name: "Second" }],
          [{ type: "company" }, { type: "company" }],
          [{ notes: "Design" }, { notes: "Design" }],
          [{ notes: null }, { notes: null }],
          [{ isActive: false }, { isActive: false }],
          [{ fee: { amount: 900, from: "2026-02", until: "2026-06", changes: [] } }, { fee: { amount: 900, from: "2026-02", until: "2026-06", changes: [] } }],
          [
            { fee: { amount: 900, from: "2026-02", until: null, changes: [{ from: "2026-09", amount: 3 }, { from: "2026-04", amount: 2 }] } },
            { fee: { amount: 900, from: "2026-02", until: null, changes: [{ from: "2026-04", amount: 2 }, { from: "2026-09", amount: 3 }] } },
          ],
          [{ fee: null }, { fee: null }],
        ]
        for (const [input, expected] of steps) {
          expect(await db.updateCollaborator(userId, c.id, input)).toMatchObject(expected)
          expect(await byId(c.id)).toMatchObject(expected)
        }
        // Left alone, whatever was not named.
        expect(await byId(c.id)).toMatchObject({ name: "Second", type: "company", notes: null, isActive: false })
        await db.deleteCollaborator(userId, c.id)
      })
    })

    describe("assignments and the people on a timecard", () => {
      const setup = async () => {
        const e = await db.createEngagement(userId, { clientId: "assign-client", dailyRate: 520, vatApplicable: true, defaultDaysPerMonth: 8 })
        const c = await db.createCollaborator(userId, { name: "Giulia Neri", type: "freelancer" })
        return { e, c }
      }
      const rows = async (engagementId: string) =>
        (await db.getTimecards(userId)).filter((t) => t.engagementId === engagementId).map((t) => [t.date, t.collaboratorId, t.hours]).sort()

      it("creates, reads back every field, updates the map whole, and deletes", async () => {
        const { e, c } = await setup()
        const a = await db.createAssignment(userId, {
          collaboratorId: c.id, engagementId: e.id, dailyRate: 320, from: "2026-09", until: "2027-02", defaultDays: 4, monthDays: { "2026-11": 6 },
        })
        const expected = {
          userId, collaboratorId: c.id, engagementId: e.id, dailyRate: 320, from: "2026-09", until: "2027-02", defaultDays: 4, monthDays: { "2026-11": 6 },
        }
        expect(a).toMatchObject(expected)
        expect((await db.getAssignments(userId)).find((x) => x.id === a.id)).toMatchObject(expected)
        expect(await db.getAssignments(otherUserId)).toEqual([])
        // One per collaborator per contract: its id says so, and a second create is refused.
        expect(a.id).toBe(`${c.id}_${e.id}`)
        await expect(db.createAssignment(userId, { collaboratorId: c.id, engagementId: e.id, dailyRate: 100, from: "2026-09", defaultDays: 2 })).rejects.toThrow(/already/)
        expect((await db.getAssignments(userId)).find((x) => x.id === a.id)).toMatchObject({ dailyRate: 320 })
        const e2 = await db.createEngagement(userId, { clientId: "assign-client", dailyRate: 520, vatApplicable: true, defaultDaysPerMonth: 8 })
        const bare = await db.createAssignment(userId, { collaboratorId: c.id, engagementId: e2.id, dailyRate: 100, from: "2026-09", defaultDays: 2 })
        expect(bare).toMatchObject({ until: null, monthDays: {} })
        await db.deleteAssignment(userId, bare.id)
        await db.deleteEngagement(userId, e2.id)
        expect(await db.updateAssignment(userId, a.id, { monthDays: { "2026-10": 0 }, until: null })).toMatchObject({
          monthDays: { "2026-10": 0 }, until: null, dailyRate: 320, defaultDays: 4,
        })
        await db.deleteAssignment(userId, a.id)
        expect((await db.getAssignments(userId)).find((x) => x.id === a.id)).toBeUndefined()
        await db.deleteCollaborator(userId, c.id)
        await db.deleteEngagement(userId, e.id)
      })

      it("keeps two people's hours on one contract and day apart, and deletes one without the other", async () => {
        const { e, c } = await setup()
        await db.setTimecard(userId, { engagementId: e.id, date: "2026-10-05", hours: 8 })
        await db.setTimecard(userId, { engagementId: e.id, date: "2026-10-05", collaboratorId: c.id, hours: 4 })
        await db.setTimecard(userId, { engagementId: e.id, date: "2026-10-05", collaboratorId: c.id, hours: 6 })
        expect(await rows(e.id)).toEqual([["2026-10-05", c.id, 6], ["2026-10-05", null, 8]].sort())
        await db.deleteTimecard(userId, e.id, "2026-10-05", c.id)
        expect(await rows(e.id)).toEqual([["2026-10-05", null, 8]])
        await db.deleteTimecard(userId, e.id, "2026-10-05")
        await db.deleteCollaborator(userId, c.id)
        await db.deleteEngagement(userId, e.id)
      })

      it("refuses to remove an assignment or delete a collaborator with days logged for them, and allows it once they are gone", async () => {
        const { e, c } = await setup()
        const a = await db.createAssignment(userId, { collaboratorId: c.id, engagementId: e.id, dailyRate: 320, from: "2026-09", defaultDays: 4 })
        await db.setTimecard(userId, { engagementId: e.id, date: "2026-10-05", collaboratorId: c.id, hours: 8 })
        await expect(db.deleteAssignment(userId, a.id)).rejects.toThrow(/Until/)
        await expect(db.deleteCollaborator(userId, c.id)).rejects.toThrow(/Inactive/)
        expect((await db.getAssignments(userId)).some((x) => x.id === a.id)).toBe(true)
        await db.deleteTimecard(userId, e.id, "2026-10-05", c.id)
        await db.deleteCollaborator(userId, c.id)
        expect((await db.getAssignments(userId)).some((x) => x.id === a.id)).toBe(false)
        await db.deleteEngagement(userId, e.id)
      })

      it("takes a contract's assignments with it when the contract is deleted", async () => {
        const { e, c } = await setup()
        const a = await db.createAssignment(userId, { collaboratorId: c.id, engagementId: e.id, dailyRate: 320, from: "2026-09", defaultDays: 4 })
        await db.deleteEngagement(userId, e.id)
        expect((await db.getAssignments(userId)).some((x) => x.id === a.id)).toBe(false)
        await db.deleteCollaborator(userId, c.id)
      })
    })

    describe("invoices", () => {
      const newEngagement = (clientId = "invoice-client") =>
        db.createEngagement(userId, {
          clientId,
          dailyRate: 500,
          vatApplicable: true,
          defaultDaysPerMonth: 5,
        })

      it("CRUD roundtrip", async () => {
        const created = await db.createInvoice(userId, {
          clientId: "invoice-client",
          number: "2026/14",
          yearMonth: "2027-01",
          amount: 5000,
          vat: 1100,
          dueDate: new Date("2027-02-28"),
        })
        expect(created.id).toBeTruthy()
        expect(created.userId).toBe(userId)
        // It bills the customer: no contract is named.
        expect(created.clientId).toBe("invoice-client")
        expect(created.engagementId).toBeNull()
        expect(created.number).toBe("2026/14")
        // A single month: no period.
        expect(created.fromMonth).toBeNull()
        expect(created.yearMonth).toBe("2027-01")
        expect(created.amount).toBe(5000)
        expect(created.vat).toBe(1100)
        expect(created.dueDate?.getTime()).toBe(new Date("2027-02-28").getTime())
        // No status enum: unpaid is simply a null paidDate.
        expect(created.paidDate).toBeNull()

        const fetched = (await db.getInvoices(userId)).find((i) => i.id === created.id)
        expect(fetched).toBeDefined()
        expect(fetched).toMatchObject({ clientId: "invoice-client", engagementId: null, amount: 5000, yearMonth: "2027-01" })

        await db.deleteInvoice(userId, created.id)
        expect((await db.getInvoices(userId)).find((i) => i.id === created.id)).toBeUndefined()
      })

      it("keeps omitted dueDate and paidDate null", async () => {
        const created = await db.createInvoice(userId, {
          clientId: "invoice-client",
          number: "no-dates",
          yearMonth: "2027-01",
          amount: 1000,
          vat: 0,
        })
        expect(created.dueDate).toBeNull()
        expect(created.paidDate).toBeNull()
        expect(created.paidAccountId).toBeNull()
        await db.deleteInvoice(userId, created.id)
      })

      it("update touches only the fields passed", async () => {
        const created = await db.createInvoice(userId, {
          clientId: "invoice-client",
          number: "2026/15",
          yearMonth: "2027-01",
          amount: 5000,
          vat: 1100,
          dueDate: new Date("2027-02-28"),
        })

        // Marking it paid must not disturb the competenza month, the amounts or the customer.
        const paid = await db.updateInvoice(userId, created.id, {
          paidDate: new Date("2027-03-05"),
        })
        expect(paid.paidDate?.getTime()).toBe(new Date("2027-03-05").getTime())
        expect(paid.number).toBe("2026/15")
        expect(paid.clientId).toBe("invoice-client")
        expect(paid.yearMonth).toBe("2027-01")
        expect(paid.amount).toBe(5000)
        expect(paid.vat).toBe(1100)
        expect(paid.dueDate?.getTime()).toBe(new Date("2027-02-28").getTime())

        const unpaid = await db.updateInvoice(userId, created.id, { paidDate: null })
        expect(unpaid.paidDate).toBeNull()
        await db.deleteInvoice(userId, created.id)
      })

      // Invoices and Deadlines untick with {paidDate: null} alone, and Undo puts the
      // date back alone: the account stays, and counts again once the date is back.
      it("stamps the paid account, and keeps it across an untick with the date alone", async () => {
        const created = await db.createInvoice(userId, {
          clientId: "invoice-client", number: "into-account", yearMonth: "2027-01", amount: 1000, vat: 220,
        })
        const paid = await db.updateInvoice(userId, created.id, { paidDate: new Date("2027-02-05"), paidAccountId: "acc-a" })
        expect(paid).toMatchObject({ paidAccountId: "acc-a", number: "into-account", amount: 1000 })

        const unticked = await db.updateInvoice(userId, created.id, { paidDate: null })
        expect(unticked).toMatchObject({ paidDate: null, paidAccountId: "acc-a" })
        const reticked = await db.updateInvoice(userId, created.id, { paidDate: new Date("2027-02-06") })
        expect(reticked.paidAccountId).toBe("acc-a")
        expect((await db.getInvoices(userId)).find((i) => i.id === created.id)?.paidAccountId).toBe("acc-a")

        const cleared = await db.updateInvoice(userId, created.id, { paidDate: null, paidAccountId: null })
        expect(cleared.paidAccountId).toBeNull()
        await db.deleteInvoice(userId, created.id)
      })

      it("stores the first month of an invoice covering several, and sets and clears it", async () => {
        const created = await db.createInvoice(userId, {
          clientId: "invoice-client",
          number: "period",
          fromMonth: "2027-01",
          yearMonth: "2027-03",
          amount: 3000,
          vat: 660,
        })
        expect(created).toMatchObject({ fromMonth: "2027-01", yearMonth: "2027-03" })
        const fetched = (await db.getInvoices(userId)).find((i) => i.id === created.id)
        expect(fetched?.fromMonth).toBe("2027-01")

        // A paid stamp leaves the period alone.
        const paid = await db.updateInvoice(userId, created.id, { paidDate: new Date("2027-04-05") })
        expect(paid).toMatchObject({ fromMonth: "2027-01", yearMonth: "2027-03" })

        const moved = await db.updateInvoice(userId, created.id, { fromMonth: "2027-02", yearMonth: "2027-04" })
        expect(moved).toMatchObject({ fromMonth: "2027-02", yearMonth: "2027-04", amount: 3000 })

        const single = await db.updateInvoice(userId, created.id, { fromMonth: null })
        expect(single).toMatchObject({ fromMonth: null, yearMonth: "2027-04" })
        await db.deleteInvoice(userId, created.id)
      })

      it("reads an invoice written before invoices named their customer through its contract", async () => {
        const engagement = await newEngagement()
        const id = await seedLegacyInvoice(engagement.id, "vecchia")
        const legacy = (await db.getInvoices(userId)).find((i) => i.id === id)
        expect(legacy).toMatchObject({
          clientId: null, engagementId: engagement.id, fromMonth: null, amount: 1000, vat: 220, paidAccountId: null,
        })
        expect(invoiceClientId(legacy!, await db.getEngagements(userId))).toBe("invoice-client")
        await db.deleteInvoice(userId, id)
        await db.deleteEngagement(userId, engagement.id)
      })

      it("deleting a contract without hours keeps its invoices on the client", async () => {
        const engagement = await newEngagement()
        const id = await seedLegacyInvoice(engagement.id, "orfana")
        await db.deleteEngagement(userId, engagement.id)
        const kept = (await db.getInvoices(userId)).find((i) => i.id === id)
        expect(kept).toMatchObject({ clientId: engagement.clientId, engagementId: null, amount: 1000, vat: 220 })
        expect(invoiceClientId(kept!, await db.getEngagements(userId))).toBe(engagement.clientId)
        await db.deleteInvoice(userId, id)
      })

      it("deleting the client deletes its invoices, recorded on it or on its contracts", async () => {
        const doomed = await db.createClient(userId, { name: "Invoice cascade doomed" })
        const spared = await db.createClient(userId, { name: "Invoice cascade spared" })

        const doomedEng = await newEngagement(doomed.id)
        const sparedEng = await newEngagement(spared.id)

        // Recorded on a contract that was deleted since: it names the client now.
        const gone = await newEngagement(doomed.id)
        const rePointed = await seedLegacyInvoice(gone.id, "d-r")
        await db.deleteEngagement(userId, gone.id)

        const [legacy, onClient, sparedLegacy, sparedOnClient] = await Promise.all([
          seedLegacyInvoice(doomedEng.id, "d-a"),
          db.createInvoice(userId, { clientId: doomed.id, number: "d-b", yearMonth: "2027-02", amount: 2000, vat: 440 }),
          seedLegacyInvoice(sparedEng.id, "s-a"),
          db.createInvoice(userId, { clientId: spared.id, number: "s-b", yearMonth: "2027-01", amount: 3000, vat: 660 }),
        ])

        await db.deleteClient(userId, doomed.id)

        const remaining = (await db.getInvoices(userId)).map((i) => i.id)
        expect(remaining).not.toContain(legacy)
        expect(remaining).not.toContain(onClient.id)
        expect(remaining).not.toContain(rePointed)
        expect(remaining).toEqual(expect.arrayContaining([sparedLegacy, sparedOnClient.id]))

        await db.deleteClient(userId, spared.id)
      })
    })


    // ── Company Deadlines ──────────────────────────────────────────────────

    describe("company deadlines", () => {
      it("CRUD roundtrip", async () => {
        const created = await db.createCompanyDeadline(userId, {
          title: "Parcella commercialista Q3",
          date: new Date("2026-10-20"),
          kind: "admin",
          amount: 1200,
          notes: "bonifico",
        })
        expect(created.id).toBeTruthy()
        expect(created.title).toBe("Parcella commercialista Q3")
        expect(created.kind).toBe("admin")
        expect(created.amount).toBe(1200)
        // Nothing is done the moment you write it down.
        expect(created.isDone).toBe(false)

        const ticked = await db.updateCompanyDeadline(userId, created.id, { isDone: true })
        expect(ticked.isDone).toBe(true)

        await db.deleteCompanyDeadline(userId, created.id)
        const remaining = await db.getCompanyDeadlines(userId)
        expect(remaining.find((d) => d.id === created.id)).toBeUndefined()
      })

      it("lists deadlines for user only", async () => {
        await db.createCompanyDeadline(userId, {
          title: "Rinnovo polizza",
          date: new Date("2026-11-01"),
          kind: "contract",
        })
        const list = await db.getCompanyDeadlines(userId)
        expect(list.length).toBeGreaterThanOrEqual(1)
        expect(list.every((d) => d.userId === userId)).toBe(true)
      })

      // Both adapters must agree on order, or the calendar renders differently
      // depending on which backend is wired in.
      it("returns deadlines oldest first", async () => {
        const late = await db.createCompanyDeadline(userId, {
          title: "Ordering late",
          date: new Date("2027-05-01"),
          kind: "other",
        })
        const early = await db.createCompanyDeadline(userId, {
          title: "Ordering early",
          date: new Date("2027-01-01"),
          kind: "other",
        })
        const list = await db.getCompanyDeadlines(userId)
        const positions = [early.id, late.id].map((id) => list.findIndex((d) => d.id === id))
        expect(positions[0]).toBeLessThan(positions[1])
      })

      it("keeps an omitted amount and notes null", async () => {
        const created = await db.createCompanyDeadline(userId, {
          title: "Nessun importo",
          date: new Date("2026-12-05"),
          kind: "other",
        })
        expect(created.amount).toBeNull()
        expect(created.notes).toBeNull()
      })
    })

    // ── Allocations ────────────────────────────────────────────────────────

    describe("allocations", () => {
      let engagementId: string

      beforeAll(async () => {
        const client = await db.createClient(userId, { name: "Allocation Client" })
        const eng = await db.createEngagement(userId, {
          clientId: client.id,
          dailyRate: 80,
          vatApplicable: false,
          defaultDaysPerMonth: 10,
        })
        engagementId = eng.id
      })

      it("CRUD roundtrip", async () => {
        const created = await db.createAllocation(userId, {
          engagementId,
          yearMonth: "2026-08",
          days: 12,
        })
        expect(created.engagementId).toBe(engagementId)
        expect(created.yearMonth).toBe("2026-08")
        expect(created.days).toBe(12)

        const updated = await db.updateAllocation(userId, created.id, { days: 5 })
        expect(updated.days).toBe(5)

        await db.deleteAllocation(userId, created.id)
        const allocations = await db.getAllocations(userId)
        expect(allocations.find((a) => a.id === created.id)).toBeUndefined()
      })

      it("lists allocations for user", async () => {
        await db.createAllocation(userId, { engagementId, yearMonth: "2026-09", days: 8 })
        const allocations = await db.getAllocations(userId)
        expect(allocations.length).toBeGreaterThanOrEqual(1)
        expect(allocations.every((a) => a.userId === userId)).toBe(true)
      })

      // A stored 0 means "this month is deliberately empty", which is different from
      // having no record at all ("fall back to the contract's default"). If the adapter
      // dropped a zero, an unplanned month would silently bill the default instead.
      it("round-trips an explicit zero", async () => {
        const created = await db.createAllocation(userId, {
          engagementId,
          yearMonth: "2026-10",
          days: 0,
        })
        expect(created.days).toBe(0)

        const allocations = await db.getAllocations(userId)
        const stored = allocations.find((a) => a.id === created.id)
        expect(stored).toBeDefined()
        expect(stored!.days).toBe(0)
      })
    })

    // ── Delete cascades ────────────────────────────────────────────────────
    //
    // Nothing in the UI can reach an allocation whose contract is gone, or a
    // contract whose client is gone — but the projection still reads them and
    // still bills their days. Orphans are invisible revenue, so the delete has
    // to take its dependents along.

    describe("invoice files", () => {
      const text = (s: string) => new Blob([s])
      const read = async (f: Parameters<FilesAdapter["download"]>[0]) => (await files.download(f)).text()

      it.each([
        ["IT01_00001.xml", "xml", "<a/>"],
        ["IT01_00001.xml.p7m", "p7m", "signed"],
        ["EU-1234.pdf", "pdf", "%PDF-1.4"],
      ])("stores %s as a %s and reads the same bytes back", async (name, kind, body) => {
        const f = await files.upload(userId, text(body), name)
        expect(f).toMatchObject({ name, kind, size: body.length })
        expect(f.path).toMatch(new RegExp(`^users/${userId}/company-files/[\\w-]+\\.${kind === "p7m" ? "xml\\.p7m" : kind}$`))
        expect(f.uploadedAt).toBeInstanceOf(Date)
        expect(await read(f)).toBe(body)
        await files.remove(f.path)
      })

      it("keeps two files with the same name apart", async () => {
        const [a, b] = await Promise.all([files.upload(userId, text("one"), "x.xml"), files.upload(userId, text("two"), "x.xml")])
        expect(a.path).not.toBe(b.path)
        expect([await read(a), await read(b)]).toEqual(["one", "two"])
        await Promise.all([files.remove(a.path), files.remove(b.path)])
      })

      it("removes the object, and removing it again is not an error", async () => {
        const f = await files.upload(userId, text("<a/>"), "gone.xml")
        await files.remove(f.path)
        await expect(files.download(f)).rejects.toThrow()
        await expect(files.remove(f.path)).resolves.toBeUndefined()
      })

      it("refuses another type, and more than 10 MB, before storing anything", async () => {
        await expect(files.upload(userId, text("x"), "invoice.docx")).rejects.toThrow(
          "invoice.docx can't be attached: use the XML, the signed .p7m, or a PDF.",
        )
        await expect(files.upload(userId, new Blob([new Uint8Array(10 * 1024 * 1024 + 1)]), "big.pdf")).rejects.toThrow(
          "big.pdf is over the 10 MB limit.",
        )
      })

      it("keeps the file on an expense and an invoice, and null on one without", async () => {
        const f = await files.upload(userId, text("<a/>"), "cost.xml")
        const plain = await db.createCompanyExpense(userId, { description: "No file", category: "other", amount: 10, date: new Date() })
        expect(plain.file).toBeNull()
        const cost = await db.updateCompanyExpense(userId, plain.id, { file: f })
        expect(cost.file).toEqual(f)
        expect((await db.getCompanyExpenses(userId)).find((e) => e.id === plain.id)?.file).toEqual(f)
        expect((await db.updateCompanyExpense(userId, plain.id, { description: "Renamed" })).file).toEqual(f)
        expect((await db.updateCompanyExpense(userId, plain.id, { file: null })).file).toBeNull()
        await db.deleteCompanyExpense(userId, plain.id)
        await files.remove(f.path)

        const client = await db.createClient(userId, { name: "File Client" })
        const g = await files.upload(userId, text("<b/>"), "inv.xml")
        const inv = await db.createInvoice(userId, { clientId: client.id, number: "F1", yearMonth: "2027-01", amount: 100, vat: 22, file: g })
        expect(inv.file).toEqual(g)
        expect((await db.getInvoices(userId)).find((i) => i.id === inv.id)?.file).toEqual(g)
        expect((await db.updateInvoice(userId, inv.id, { number: "F2" })).file).toEqual(g)
        await db.deleteInvoice(userId, inv.id)
        await expect(files.download(g)).rejects.toThrow()
        await db.deleteClient(userId, client.id)
      })

      it("replace: the record names the new object and the old one is gone", async () => {
        const old = await files.upload(userId, text("<old/>"), "old.xml")
        const cost = await db.createCompanyExpense(userId, { description: "Replaced", category: "other", amount: 10, date: new Date(), file: old })
        const next = await files.upload(userId, text("<new/>"), "new.xml")
        // The order the form uses: write the pointer, then delete the old object.
        expect((await db.updateCompanyExpense(userId, cost.id, { file: next })).file).toEqual(next)
        await files.remove(old.path)
        await expect(files.download(old)).rejects.toThrow()
        expect(await read(next)).toBe("<new/>")
        await db.deleteCompanyExpense(userId, cost.id)
      })

      it("deleting a cost deletes its file", async () => {
        const f = await files.upload(userId, text("<a/>"), "cost.xml")
        const cost = await db.createCompanyExpense(userId, { description: "With file", category: "other", amount: 10, date: new Date(), file: f })
        await db.deleteCompanyExpense(userId, cost.id)
        await expect(files.download(f)).rejects.toThrow()
      })

      it("deleting a client deletes the files of its invoices", async () => {
        const client = await db.createClient(userId, { name: "Doomed File Client" })
        const f = await files.upload(userId, text("<a/>"), "inv.xml")
        await db.createInvoice(userId, { clientId: client.id, number: "F9", yearMonth: "2027-01", amount: 100, vat: 22, file: f })
        await db.deleteClient(userId, client.id)
        await expect(files.download(f)).rejects.toThrow()
      })
    })

    describe("delete cascades", () => {
      it("deleting an engagement deletes its allocations, and only its own", async () => {
        const client = await db.createClient(userId, { name: "Cascade Engagement" })
        const [doomed, spared] = await Promise.all([
          db.createEngagement(userId, {
            clientId: client.id,
            dailyRate: 100,
            vatApplicable: false,
            defaultDaysPerMonth: 10,
          }),
          db.createEngagement(userId, {
            clientId: client.id,
            dailyRate: 200,
            vatApplicable: false,
            defaultDaysPerMonth: 5,
          }),
        ])
        const doomedAlloc = await db.createAllocation(userId, {
          engagementId: doomed.id,
          yearMonth: "2027-01",
          days: 9,
        })
        const sparedAlloc = await db.createAllocation(userId, {
          engagementId: spared.id,
          yearMonth: "2027-01",
          days: 4,
        })

        await db.deleteEngagement(userId, doomed.id)

        const allocations = await db.getAllocations(userId)
        expect(allocations.find((a) => a.id === doomedAlloc.id)).toBeUndefined()
        expect(allocations.find((a) => a.id === sparedAlloc.id)).toBeDefined()

        const engagements = await db.getEngagements(userId)
        expect(engagements.find((e) => e.id === spared.id)).toBeDefined()
      })

      it("deleting a client deletes its engagements, opportunities and allocations", async () => {
        const [doomed, spared] = await Promise.all([
          db.createClient(userId, { name: "Cascade Client" }),
          db.createClient(userId, { name: "Bystander Client" }),
        ])

        const doomedEng = await db.createEngagement(userId, {
          clientId: doomed.id,
          dailyRate: 100,
          vatApplicable: false,
          defaultDaysPerMonth: 10,
        })
        const doomedAlloc = await db.createAllocation(userId, {
          engagementId: doomedEng.id,
          yearMonth: "2027-02",
          days: 7,
        })
        const doomedOpp = await db.createOpportunity(userId, {
          clientId: doomed.id,
          title: "Goes with the client",
          stage: "proposal",
          probability: 50,
          dailyRate: 100,
          estimatedDaysPerMonth: 10,
          estimatedDurationMonths: 6,
          vatApplicable: false,
        })

        const sparedEng = await db.createEngagement(userId, {
          clientId: spared.id,
          dailyRate: 100,
          vatApplicable: false,
          defaultDaysPerMonth: 10,
        })
        const sparedAlloc = await db.createAllocation(userId, {
          engagementId: sparedEng.id,
          yearMonth: "2027-02",
          days: 3,
        })
        const sparedOpp = await db.createOpportunity(userId, {
          clientId: spared.id,
          title: "Stays put",
          stage: "lead",
          probability: 20,
          dailyRate: 100,
          estimatedDaysPerMonth: 10,
          estimatedDurationMonths: 6,
          vatApplicable: false,
        })

        await db.deleteClient(userId, doomed.id)

        const [engagements, opportunities, allocations] = await Promise.all([
          db.getEngagements(userId),
          db.getOpportunities(userId),
          db.getAllocations(userId),
        ])

        expect(engagements.find((e) => e.id === doomedEng.id)).toBeUndefined()
        expect(opportunities.find((o) => o.id === doomedOpp.id)).toBeUndefined()
        expect(allocations.find((a) => a.id === doomedAlloc.id)).toBeUndefined()

        expect(engagements.find((e) => e.id === sparedEng.id)).toBeDefined()
        expect(opportunities.find((o) => o.id === sparedOpp.id)).toBeDefined()
        expect(allocations.find((a) => a.id === sparedAlloc.id)).toBeDefined()
      })

      // Cross-user cascades are not exercised here: `otherUserId` is a uid the
      // client is not authenticated as, so on Firebase the cascade's own reads
      // are refused by the rules before any delete is attempted. Firestore
      // rules cover that boundary; mock.test.ts covers the in-memory guard.
    })

    describe("user data isolation", () => {
      it("user B cannot read user A's clients, opportunities or engagements", async () => {
        const client = await db.createClient(userId, { name: "Private Client" })
        await db.createOpportunity(userId, {
          clientId: client.id,
          title: "Private deal",
          stage: "lead",
          probability: 20,
          dailyRate: 100,
          estimatedDaysPerMonth: 10,
          estimatedDurationMonths: 6,
          vatApplicable: false,
        })
        await db.createEngagement(userId, { clientId: client.id, dailyRate: 100, vatApplicable: false, defaultDaysPerMonth: 10 })
        expect((await db.getClients(userId)).length).toBeGreaterThan(0)
        expect(await db.getClients(otherUserId)).toHaveLength(0)
        expect(await db.getOpportunities(otherUserId)).toHaveLength(0)
        expect(await db.getEngagements(otherUserId)).toHaveLength(0)
      })

      it("user B cannot read user A's cash book or API keys", async () => {
        await db.createCompanyAccount(userId, { name: "Private Bank", openingBalance: 100, openingDate: new Date("2026-01-01") })
        expect((await db.getCompanyAccounts(userId)).length).toBeGreaterThan(0)
        expect(await db.getCompanyAccounts(otherUserId)).toHaveLength(0)
        expect(await db.getCompanyMovements(otherUserId)).toHaveLength(0)
        expect(await db.getCompanyExpenses(otherUserId)).toHaveLength(0)
      })
    })

    describeRentContract(() => ({ db, userId, otherUserId }))
  })
}
