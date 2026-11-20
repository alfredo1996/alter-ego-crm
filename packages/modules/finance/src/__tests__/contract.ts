/**
 * Finance's data contract: every case a database must honour for the finance package to work on it.
 * It lives in the package so the cases and the adapters move together; a host app runs it against
 * its own composed adapter (the mock, the client SDK through the emulator), and
 * describeFinanceAdminContract against the server-side surface (the Admin SDK).
 * apps/web/.../adapter-contract.ts is the wrapper that supplies the adapter.
 *
 * Preconditions on a Firebase host: root /categories is seeded with `defaultCategories` from
 * "@alter-ego/finance/lib/categories" before the run (the mock seeds itself), and the host's
 * rules splice finance.rules (collections and `isValid*` validators) at the users level and
 * finance-root.rules (the root `match /categories` read rule) at the top level (see
 * scripts/build-firestore-rules.mjs). Without them the category, categorization-rule,
 * uncategorized-filter and split-report cases fail.
 */
import { describe, it, expect, beforeAll } from "vitest"

import { decodeLoanNote } from "../lib/mortgage"

import type { FinanceAdapter } from "../adapter"
import type { Transaction, TransactionFilters } from "../types"

export interface FinanceContractDeps {
  db: FinanceAdapter
  userId: string
  otherUserId: string
  /** Firebase only: the daily balance snapshots v0.9.0 and older stored, still in production. */
  legacyBalanceSnapshots?: { seed: () => Promise<void>; count: () => Promise<number> }
  /** Firebase only: stores a net-worth snapshot dated `date` (a local day) worth `netWorth`. */
  seedNetWorthSnapshot?: (date: Date, netWorth: number) => Promise<void>
}

/** `get` is read in a hook, once the host's own setup has run. */
export function describeFinanceContract(get: () => FinanceContractDeps) {
  describe("finance", () => {
    let db: FinanceAdapter
    let userId: string
    let otherUserId: string
    let legacyBalanceSnapshots: FinanceContractDeps["legacyBalanceSnapshots"]
    let seedNetWorthSnapshot: FinanceContractDeps["seedNetWorthSnapshot"]

    beforeAll(() => {
      ;({ db, userId, otherUserId, legacyBalanceSnapshots, seedNetWorthSnapshot } = get())
    })

    // ── Accounts ──────────────────────────────────────────────────────────────

    describe("accounts", () => {
      it("creates an account with correct shape", async () => {
        const account = await db.createAccount(userId, {
          name: "Contract Checking",
          type: "checking",
          currency: "USD",
          balance: 1000,
        })
        expect(account.id).toBeTruthy()
        expect(account.userId).toBe(userId)
        expect(account.name).toBe("Contract Checking")
        expect(account.type).toBe("checking")
        expect(account.balance).toBe(1000)
        expect(account.isArchived).toBe(false)
      })

      it("lists accounts for user only", async () => {
        const accounts = await db.getAccounts(userId)
        expect(accounts.length).toBeGreaterThanOrEqual(1)
        expect(accounts.every((a) => a.userId === userId)).toBe(true)
      })

      it("updates account merges fields", async () => {
        const created = await db.createAccount(userId, {
          name: "To Update",
          type: "savings",
          currency: "USD",
          balance: 500,
        })
        const updated = await db.updateAccount(userId, created.id, { name: "Updated Name", balance: 750 })
        expect(updated.name).toBe("Updated Name")
        expect(updated.balance).toBe(750)
        expect(updated.type).toBe("savings")
      })

      it("deletes account", async () => {
        const created = await db.createAccount(userId, {
          name: "To Delete",
          type: "cash",
          currency: "USD",
          balance: 0,
        })
        await db.deleteAccount(userId, created.id)
        const result = await db.getAccount(userId, created.id)
        expect(result).toBeNull()
      })

      // Closing an account (#219): Archive is the close, Delete is for an empty account.

      it("refuses to delete an account that still has a transaction, incoming transfers included", async () => {
        const bank = await db.createAccount(userId, { name: "Bank", type: "checking", currency: "EUR", balance: 100 })
        const closing = await db.createAccount(userId, { name: "Closing", type: "savings", currency: "EUR", balance: 0 })
        const transfer = await db.createTransaction(userId, {
          accountId: bank.id,
          type: "transfer",
          amount: 40,
          currency: "EUR",
          categoryId: null,
          description: "Into the one being closed",
          date: new Date(),
          transferToAccountId: closing.id,
        })
        await expect(db.deleteAccount(userId, closing.id)).rejects.toThrow(/transaction/)
        expect(await db.getAccount(userId, closing.id)).not.toBeNull()

        await db.deleteTransaction(userId, transfer.id)
        await db.deleteAccount(userId, closing.id)
        expect(await db.getAccount(userId, closing.id)).toBeNull()
        await db.deleteAccount(userId, bank.id)
      })

      it("archives only at balance zero", async () => {
        const full = await db.createAccount(userId, { name: "Still Full", type: "cash", currency: "EUR", balance: 12.5 })
        await expect(db.updateAccount(userId, full.id, { isArchived: true })).rejects.toThrow(/balance/)
        expect((await db.getAccount(userId, full.id))?.isArchived).toBe(false)

        const empty = await db.createAccount(userId, { name: "Empty", type: "cash", currency: "EUR", balance: 0 })
        const archived = await db.updateAccount(userId, empty.id, { isArchived: true })
        expect(archived.isArchived).toBe(true)
        // Unarchiving never needs a balance check.
        expect((await db.updateAccount(userId, empty.id, { isArchived: false })).isArchived).toBe(false)
        await db.deleteAccount(userId, full.id)
        await db.deleteAccount(userId, empty.id)
      })

      it("archives an account whose transactions net to zero with a floating-point remainder (#314)", async () => {
        const acc = await db.createAccount(userId, { name: "Cent Zero", type: "cash", currency: "EUR", balance: 0 })
        for (const [type, amount] of [["income", 0.1], ["income", 0.2], ["expense", 0.3]] as const) {
          await db.createTransaction(userId, {
            accountId: acc.id,
            type,
            amount,
            currency: "EUR",
            categoryId: null,
            description: "Cent",
            date: new Date(),
          })
        }
        expect((await db.updateAccount(userId, acc.id, { isArchived: true })).isArchived).toBe(true)
      })

      it("leaves archived accounts out of the dashboard totals and cards", async () => {
        const open = await db.createAccount(userId, { name: "Open", type: "checking", currency: "EUR", balance: 300 })
        const closed = await db.createAccount(userId, { name: "Closed", type: "checking", currency: "EUR", balance: 0 })
        await db.updateAccount(userId, closed.id, { isArchived: true })
        // An archived account can still carry a balance written before the rule, or by an import.
        await db.updateAccount(userId, closed.id, { balance: 50 })

        const dash = await db.getDashboardData(userId)
        expect(dash.accountBalances.map((a) => a.accountId)).toContain(open.id)
        expect(dash.accountBalances.map((a) => a.accountId)).not.toContain(closed.id)
        const openOnly = dash.accountBalances.reduce((s, a) => s + a.balance, 0)
        expect(dash.netWorth).toBe(openOnly)
        expect(dash.totalAssets - dash.totalLiabilities).toBe(dash.netWorth)
        await db.deleteAccount(userId, open.id)
        await db.deleteAccount(userId, closed.id)
      })
    })

    // ── Transactions ──────────────────────────────────────────────────────────

    describe("transactions", () => {
      it("creates a transaction with tagIds as empty array", async () => {
        const account = await db.createAccount(userId, {
          name: "Tx Account",
          type: "checking",
          currency: "USD",
          balance: 2000,
        })
        const tx = await db.createTransaction(userId, {
          accountId: account.id,
          type: "expense",
          amount: 50,
          currency: "USD",
          description: "Coffee",
          date: new Date("2026-01-15"),
        })
        expect(tx.id).toBeTruthy()
        expect(tx.userId).toBe(userId)
        expect(Array.isArray(tx.tagIds)).toBe(true)
        expect(tx.amount).toBe(50)
        expect(tx.type).toBe("expense")
      })

      it("filters transactions by accountId", async () => {
        const account = await db.createAccount(userId, {
          name: "Filter Account",
          type: "savings",
          currency: "USD",
          balance: 0,
        })
        await db.createTransaction(userId, {
          accountId: account.id,
          type: "income",
          amount: 100,
          currency: "USD",
          description: "Salary",
          date: new Date("2026-01-20"),
        })
        const filtered = await db.getTransactions(userId, { accountId: account.id })
        expect(filtered.data.length).toBeGreaterThanOrEqual(1)
        expect(filtered.data.every((t) => t.accountId === account.id)).toBe(true)
      })

      it("filters transactions by type", async () => {
        const account = await db.createAccount(userId, {
          name: "Type Filter Account",
          type: "checking",
          currency: "USD",
          balance: 0,
        })
        await db.createTransaction(userId, {
          accountId: account.id,
          type: "income",
          amount: 200,
          currency: "USD",
          description: "Income tx",
          date: new Date("2026-01-25"),
        })
        await db.createTransaction(userId, {
          accountId: account.id,
          type: "expense",
          amount: 30,
          currency: "USD",
          description: "Expense tx",
          date: new Date("2026-01-25"),
        })
        const incomeOnly = await db.getTransactions(userId, { accountId: account.id, type: "income" })
        expect(incomeOnly.data.every((t) => t.type === "income")).toBe(true)
      })
    })

    // ── Import hashes (dedup) ─────────────────────────────────────────────────

    describe("getImportHashes", () => {
      it("returns the non-null importHashes stored for the user", async () => {
        const account = await db.createAccount(userId, {
          name: "Import Hash Account",
          type: "checking",
          currency: "USD",
          balance: 0,
        })
        await db.createTransaction(userId, {
          accountId: account.id,
          type: "expense",
          amount: 9,
          currency: "USD",
          description: "Hashed row",
          date: new Date("2026-05-01"),
          importHash: "contract-hash-xyz",
        })
        await db.createTransaction(userId, {
          accountId: account.id,
          type: "expense",
          amount: 3,
          currency: "USD",
          description: "No hash row",
          date: new Date("2026-05-02"),
        })

        const hashes = await db.getImportHashes(userId)
        expect(hashes).toContain("contract-hash-xyz")
        // never includes null/undefined entries
        expect(hashes.every((h) => typeof h === "string" && h.length > 0)).toBe(true)
      })
    })

    // ── Categories ────────────────────────────────────────────────────────────

    describe("categories", () => {
      it("returns at least one default category", async () => {
        const cats = await db.getCategories(userId)
        expect(cats.length).toBeGreaterThan(0)
        expect(cats.some((c) => c.isDefault)).toBe(true)
      })

      it("deleteAllCategories removes custom categories but keeps defaults", async () => {
        await db.createCategory(userId, {
          name: "Custom Cat",
          group: "personal",
          icon: "Star",
          color: "#123456",
        })
        expect((await db.getCategories(userId)).some((c) => !c.isDefault)).toBe(true)

        await db.deleteAllCategories(userId)

        const after = await db.getCategories(userId)
        expect(after.some((c) => !c.isDefault)).toBe(false)
        expect(after.some((c) => c.isDefault)).toBe(true)
      })

      it("a built-in edited as the user's own copy: same id, listed once, Reset restores it", async () => {
        // Restaurants: its icon (UtensilsCrossed) is the hard case for the create rule.
        const original = (await db.getCategories(userId)).find((c) => c.isDefault && c.name === "Restaurants")!
        const edited = await db.updateCategory(userId, original.id, { name: "Home Sweet Home", color: "#010203" })
        expect(edited).toMatchObject({ id: original.id, name: "Home Sweet Home", color: "#010203", group: original.group })

        const mine = (await db.getCategories(userId)).filter((c) => c.id === original.id)
        expect(mine.map((c) => c.name)).toEqual(["Home Sweet Home"])
        expect(mine[0].isDefault).toBe(true)
        expect(mine[0].userId).toBe(userId) // the copy is the user's: Reset applies to it
        expect((await db.getCategory(userId, original.id))?.name).toBe("Home Sweet Home")

        await db.deleteCategory(userId, original.id)
        const reset = (await db.getCategories(userId)).filter((c) => c.id === original.id)
        expect(reset.map((c) => c.name)).toEqual([original.name])
      })
    })

    // ── Budgets ───────────────────────────────────────────────────────────────

    describe("budgets", () => {
      it("CRUD roundtrip", async () => {
        const created = await db.createBudget(userId, {
          name: "Groceries Budget",
          amount: 500,
          currency: "USD",
          period: "monthly",
        })
        expect(created.name).toBe("Groceries Budget")
        expect(created.amount).toBe(500)

        const updated = await db.updateBudget(userId, created.id, { amount: 600 })
        expect(updated.amount).toBe(600)

        await db.deleteBudget(userId, created.id)
        const result = await db.getBudget(userId, created.id)
        expect(result).toBeNull()
      })
    })

    // ── Savings Goals ─────────────────────────────────────────────────────────

    describe("savings goals", () => {
      it("CRUD roundtrip with defaults (currentAmount=0, isCompleted=false)", async () => {
        const created = await db.createSavingsGoal(userId, {
          name: "Vacation Fund",
          targetAmount: 3000,
          currency: "USD",
        })
        expect(created.name).toBe("Vacation Fund")
        expect(created.currentAmount).toBe(0)
        expect(created.isCompleted).toBe(false)
        expect(created.icon).toBe("🎯")
        expect(created.color).toBe("#6366f1")

        const updated = await db.updateSavingsGoal(userId, created.id, { currentAmount: 500 })
        expect(updated.currentAmount).toBe(500)

        await db.deleteSavingsGoal(userId, created.id)
        const result = await db.getSavingsGoal(userId, created.id)
        expect(result).toBeNull()
      })
    })

    // ── Recurring Transactions ────────────────────────────────────────────────

    describe("recurring transactions", () => {
      it("CRUD roundtrip", async () => {
        const account = await db.createAccount(userId, {
          name: "Recurring Account",
          type: "checking",
          currency: "USD",
          balance: 0,
        })
        const created = await db.createRecurringTransaction(userId, {
          accountId: account.id,
          type: "expense",
          amount: 12.99,
          currency: "USD",
          description: "Streaming Service",
          frequency: "monthly",
          startDate: new Date("2026-01-01"),
        })
        expect(created.description).toBe("Streaming Service")
        expect(created.frequency).toBe("monthly")
        expect(created.isActive).toBe(true)
        expect(created.interval).toBe(1)

        const updated = await db.updateRecurringTransaction(userId, created.id, { amount: 15.99 })
        expect(updated.amount).toBe(15.99)

        await db.deleteRecurringTransaction(userId, created.id)
        const result = await db.getRecurringTransaction(userId, created.id)
        expect(result).toBeNull()
      })

      it("generateDue with loanMeta writes principal/interest into notes", async () => {
        const account = await db.createAccount(userId, {
          name: "Loan Account",
          type: "loan",
          currency: "USD",
          balance: 0,
        })
        await db.createRecurringTransaction(userId, {
          accountId: account.id,
          type: "expense",
          amount: 0,
          currency: "USD",
          description: "Mortgage",
          frequency: "monthly",
          startDate: new Date("2026-01-01"),
          loanMeta: {
            loanAmount: 200000,
            annualRate: 5,
            termMonths: 360,
            paymentStartMonth: 1,
          },
        })
        const txs = await db.generateDue(userId, new Date("2026-01-31"))
        expect(txs.length).toBeGreaterThanOrEqual(1)
        const loanTx = txs.find((t) => t.description === "Mortgage")
        expect(loanTx).toBeDefined()
        const meta = decodeLoanNote(loanTx!.notes)
        expect(meta).not.toBeNull()
        expect(meta!.paymentNumber).toBe(1)
        expect(meta!.principal).toBeGreaterThan(0)
        expect(meta!.interest).toBeGreaterThan(0)
      })

      it("generateDue creates transactions and is idempotent on second call", async () => {
        const account = await db.createAccount(userId, {
          name: "Due Account",
          type: "checking",
          currency: "USD",
          balance: 0,
        })
        await db.createRecurringTransaction(userId, {
          accountId: account.id,
          type: "expense",
          amount: 5,
          currency: "USD",
          description: "Daily Coffee",
          frequency: "daily",
          startDate: new Date("2026-01-01"),
        })

        const upTo = new Date("2026-01-03")
        const firstRun = await db.generateDue(userId, upTo)
        expect(firstRun.length).toBeGreaterThanOrEqual(1)

        // Second call with same date must not create duplicates
        const secondRun = await db.generateDue(userId, upTo)
        expect(secondRun.length).toBe(0)
      })
    })

    // ── Tags ──────────────────────────────────────────────────────────────────

    describe("tags", () => {
      it("CRUD roundtrip", async () => {
        const created = await db.createTag(userId, { name: "vacation", color: "#ff0000" })
        expect(created.name).toBe("vacation")
        expect(created.color).toBe("#ff0000")

        const tags = await db.getTags(userId)
        expect(tags.some((t) => t.id === created.id)).toBe(true)

        await db.deleteTag(userId, created.id)
        const after = await db.getTags(userId)
        expect(after.some((t) => t.id === created.id)).toBe(false)
      })
    })

    // ── Categorization Rules ──────────────────────────────────────────────────

    describe("categorization rules", () => {
      it("CRUD + applyCategorization matches, no-match, respects isActive", async () => {
        // Get a real category id
        const cats = await db.getCategories(userId)
        const cat = cats.find((c) => c.isDefault)!

        const rule = await db.createCategorizationRule(userId, {
          pattern: "netflix",
          categoryId: cat.id,
        })
        expect(rule.pattern).toBe("netflix")
        expect(rule.isActive).toBe(true)

        // Match
        const matched = await db.applyCategorization(userId, "NETFLIX Monthly")
        expect(matched).toBe(cat.id)

        // No match
        const noMatch = await db.applyCategorization(userId, "Random description")
        expect(noMatch).toBeNull()

        // Deactivate and verify no match
        await db.updateCategorizationRule(userId, rule.id, { isActive: false })
        const deactivated = await db.applyCategorization(userId, "NETFLIX Monthly")
        expect(deactivated).toBeNull()

        await db.deleteCategorizationRule(userId, rule.id)
        const rules = await db.getCategorizationRules(userId)
        expect(rules.some((r) => r.id === rule.id)).toBe(false)
      })
    })

    // ── Transfers ────────────────────────────────────────────────────────────

    describe("transfers", () => {
      it("creates linked pair for transfer transactions", async () => {
        const accountA = await db.createAccount(userId, {
          name: "Transfer Source",
          type: "checking",
          currency: "USD",
          balance: 1000,
        })
        const accountB = await db.createAccount(userId, {
          name: "Transfer Dest",
          type: "savings",
          currency: "USD",
          balance: 0,
        })
        const source = await db.createTransaction(userId, {
          accountId: accountA.id,
          type: "transfer",
          amount: 200,
          currency: "USD",
          description: "Move to savings",
          date: new Date("2026-02-01"),
          transferToAccountId: accountB.id,
        })
        expect(source.transferToAccountId).toBe(accountB.id)
        expect(source.accountId).toBe(accountA.id)

        // Single-row: no linked pair, just one transaction
        const all = await db.getTransactions(userId)
        const transfers = all.data.filter((t) => t.type === "transfer")
        expect(transfers).toHaveLength(1)
      })

      it("refuses a transfer with no destination, leaving the source balance intact", async () => {
        // Without the destination, balanceEffects debits the source and credits
        // nothing: the amount leaves net worth and, because reports only count
        // income and expense, never shows up anywhere. Every adapter must refuse.
        const account = await db.createAccount(userId, {
          name: "Orphan Transfer Src",
          type: "checking",
          currency: "USD",
          balance: 1000,
        })
        await expect(
          db.createTransaction(userId, {
            accountId: account.id,
            type: "transfer",
            amount: 200,
            currency: "USD",
            description: "Nowhere",
            date: new Date("2026-02-01"),
          })
        ).rejects.toThrow()

        expect((await db.getAccount(userId, account.id))!.balance).toBe(1000)
      })

      it("refuses a transfer to its own source account", async () => {
        const account = await db.createAccount(userId, {
          name: "Self Transfer",
          type: "checking",
          currency: "USD",
          balance: 500,
        })
        await expect(
          db.createTransaction(userId, {
            accountId: account.id,
            type: "transfer",
            amount: 50,
            currency: "USD",
            description: "To myself",
            date: new Date("2026-02-01"),
            transferToAccountId: account.id,
          })
        ).rejects.toThrow()

        expect((await db.getAccount(userId, account.id))!.balance).toBe(500)
      })

      it("refuses an edit that turns a valid transaction into a destinationless transfer", async () => {
        const account = await db.createAccount(userId, {
          name: "Edit To Orphan",
          type: "checking",
          currency: "USD",
          balance: 800,
        })
        const expense = await db.createTransaction(userId, {
          accountId: account.id,
          type: "expense",
          amount: 100,
          currency: "USD",
          description: "Groceries",
          date: new Date("2026-02-01"),
        })
        expect((await db.getAccount(userId, account.id))!.balance).toBe(700)

        await expect(
          db.updateTransaction(userId, expense.id, { type: "transfer" })
        ).rejects.toThrow()

        // The rejected edit must not have moved the balance either.
        expect((await db.getAccount(userId, account.id))!.balance).toBe(700)
      })

      it("transfer appears in both source and destination account queries", async () => {
        const accountA = await db.createAccount(userId, {
          name: "Xfer Visible Src",
          type: "checking",
          currency: "USD",
          balance: 500,
        })
        const accountB = await db.createAccount(userId, {
          name: "Xfer Visible Dst",
          type: "savings",
          currency: "USD",
          balance: 0,
        })
        await db.createTransaction(userId, {
          accountId: accountA.id,
          type: "transfer",
          amount: 100,
          currency: "USD",
          description: "Visible both sides",
          date: new Date("2026-02-02"),
          transferToAccountId: accountB.id,
        })

        const srcTxs = await db.getTransactions(userId, { accountId: accountA.id })
        const dstTxs = await db.getTransactions(userId, { accountId: accountB.id })
        expect(srcTxs.data).toHaveLength(1)
        expect(dstTxs.data).toHaveLength(1)
        // Same transaction in both queries
        expect(srcTxs.data[0].id).toBe(dstTxs.data[0].id)
      })
    })

    // ── Filters ─────────────────────────────────────────────────────────────

    describe("getLastActivity", () => {
      it("gives each account its newest date, counts an incoming transfer, and null for none", async () => {
        const mk = (name: string) => db.createAccount(userId, { name, type: "checking", currency: "USD", balance: 0 })
        const [a, b, c] = [await mk("Last A"), await mk("Last B"), await mk("Last C")]
        const tx = (accountId: string, date: string, extra: object = {}) =>
          db.createTransaction(userId, { accountId, type: "expense", amount: 1, currency: "USD", description: "x", date: new Date(date), ...extra })
        await tx(a.id, "2026-03-01")
        await tx(a.id, "2026-03-09")
        await tx(b.id, "2026-03-02")
        // A transfer from A to B on 03-20: it is B's newest, and A's too.
        await tx(a.id, "2026-03-20", { type: "transfer", transferToAccountId: b.id })
        await tx(a.id, "2026-03-05")
        // A stray destination left on an expense (the form keeps it) is not B's activity.
        await tx(a.id, "2026-03-25", { transferToAccountId: b.id })

        const last = await db.getLastActivity(userId, [a.id, b.id, c.id])
        expect(last).toEqual({
          [a.id]: new Date("2026-03-25"),
          [b.id]: new Date("2026-03-20"),
          [c.id]: null,
        })
      })
    })

    describe("transaction filters", () => {
      it("filters uncategorized transactions", async () => {
        const account = await db.createAccount(userId, {
          name: "Filter Uncat Account",
          type: "checking",
          currency: "USD",
          balance: 0,
        })
        await db.createTransaction(userId, {
          accountId: account.id,
          type: "expense",
          amount: 10,
          currency: "USD",
          description: "No category",
          date: new Date("2026-02-10"),
        })
        const cats = await db.getCategories(userId)
        await db.createTransaction(userId, {
          accountId: account.id,
          type: "expense",
          amount: 20,
          currency: "USD",
          description: "Has category",
          date: new Date("2026-02-10"),
          categoryId: cats[0].id,
        })
        const result = await db.getTransactions(userId, { accountId: account.id, uncategorized: true })
        expect(result.data.every((t) => t.categoryId === null)).toBe(true)
        expect(result.data.length).toBeGreaterThanOrEqual(1)
      })

      // A split carries its categories on the splits, so the transaction is filed
      // even with a null categoryId — it must not surface as "still to categorize".
      it("does not count a split transaction as uncategorized", async () => {
        const account = await db.createAccount(userId, {
          name: "Filter Split Uncat Account",
          type: "checking",
          currency: "USD",
          balance: 0,
        })
        const cats = await db.getCategories(userId)
        await db.createTransaction(userId, {
          accountId: account.id,
          type: "expense",
          amount: 100,
          currency: "USD",
          description: "Split, filed on its parts",
          date: new Date("2026-02-11"),
          categoryId: null,
          splits: [
            { id: "s1", categoryId: cats[0].id, amount: 60 },
            { id: "s2", categoryId: cats[1].id, amount: 40 },
          ],
        })
        await db.createTransaction(userId, {
          accountId: account.id,
          type: "expense",
          amount: 15,
          currency: "USD",
          description: "Genuinely unfiled",
          date: new Date("2026-02-11"),
        })

        const result = await db.getTransactions(userId, { accountId: account.id, uncategorized: true })
        expect(result.data.map((t) => t.description)).toEqual(["Genuinely unfiled"])
      })

      it("bounds the amount with minAmount and maxAmount", async () => {
        const account = await db.createAccount(userId, {
          name: "Filter Amount Account",
          type: "checking",
          currency: "USD",
          balance: 0,
        })
        for (const amount of [5, 50, 500]) {
          await db.createTransaction(userId, {
            accountId: account.id,
            type: "expense",
            amount,
            currency: "USD",
            description: `Spesa ${amount}`,
            date: new Date("2026-02-12"),
          })
        }

        const over = await db.getTransactions(userId, { accountId: account.id, minAmount: 50 })
        expect(over.data.map((t) => t.amount).sort((a, b) => a - b)).toEqual([50, 500])

        const under = await db.getTransactions(userId, { accountId: account.id, maxAmount: 50 })
        expect(under.data.map((t) => t.amount).sort((a, b) => a - b)).toEqual([5, 50])

        // Both bounds are inclusive, so an exact match lands in the window.
        const exact = await db.getTransactions(userId, {
          accountId: account.id,
          minAmount: 50,
          maxAmount: 50,
        })
        expect(exact.data.map((t) => t.amount)).toEqual([50])
      })

      it("filters transactions with notes (hasNote)", async () => {
        const account = await db.createAccount(userId, {
          name: "Filter HasNote Account",
          type: "checking",
          currency: "USD",
          balance: 0,
        })
        await db.createTransaction(userId, {
          accountId: account.id,
          type: "expense",
          amount: 15,
          currency: "USD",
          description: "With note",
          date: new Date("2026-02-11"),
          notes: "some note",
        })
        await db.createTransaction(userId, {
          accountId: account.id,
          type: "expense",
          amount: 25,
          currency: "USD",
          description: "Without note",
          date: new Date("2026-02-11"),
        })
        const result = await db.getTransactions(userId, { accountId: account.id, hasNote: true })
        expect(result.data.every((t) => !!t.notes)).toBe(true)
        expect(result.data.length).toBeGreaterThanOrEqual(1)
      })

      it("filters transactions by tagIds", async () => {
        const account = await db.createAccount(userId, {
          name: "Filter Tags Account",
          type: "checking",
          currency: "USD",
          balance: 0,
        })
        const tag = await db.createTag(userId, { name: "filter-test", color: "#00ff00" })
        await db.createTransaction(userId, {
          accountId: account.id,
          type: "expense",
          amount: 30,
          currency: "USD",
          description: "Tagged",
          date: new Date("2026-02-12"),
          tagIds: [tag.id],
        })
        await db.createTransaction(userId, {
          accountId: account.id,
          type: "expense",
          amount: 40,
          currency: "USD",
          description: "Untagged",
          date: new Date("2026-02-12"),
        })
        const result = await db.getTransactions(userId, { accountId: account.id, tagIds: [tag.id] })
        expect(result.data.every((t) => t.tagIds.includes(tag.id))).toBe(true)
        expect(result.data.length).toBeGreaterThanOrEqual(1)
      })

      it("search matches notes field", async () => {
        const account = await db.createAccount(userId, {
          name: "Search Notes Account",
          type: "checking",
          currency: "USD",
          balance: 0,
        })
        await db.createTransaction(userId, {
          accountId: account.id,
          type: "expense",
          amount: 50,
          currency: "USD",
          description: "Plain expense",
          date: new Date("2026-02-13"),
          notes: "unique-search-term-xyz",
        })
        const result = await db.getTransactions(userId, { search: "unique-search-term-xyz" })
        expect(result.data.length).toBeGreaterThanOrEqual(1)
        expect(result.data[0].notes).toContain("unique-search-term-xyz")
      })
    })

    // ── Dashboard ───────────────────────────────────────────────────────────

    describe("dashboard data", () => {
      it("returns totalAssets, totalLiabilities, and netWorth", async () => {
        const dashboard = await db.getDashboardData(userId)
        expect(typeof dashboard.totalAssets).toBe("number")
        expect(typeof dashboard.totalLiabilities).toBe("number")
        expect(dashboard.netWorth).toBe(dashboard.totalAssets - dashboard.totalLiabilities)
      })

      it("counts 'other' account type as asset", async () => {
        await db.createAccount(userId, {
          name: "Other Asset",
          type: "other",
          currency: "USD",
          balance: 999,
        })
        const dashboard = await db.getDashboardData(userId)
        expect(dashboard.totalAssets).toBeGreaterThanOrEqual(999)
      })

      it("totals follow the balance sign, not the account kind", async () => {
        const before = await db.getDashboardData(userId)
        const card = await db.createAccount(userId, { name: "Overpaid Card", type: "credit_card", currency: "USD", balance: 40 })
        const overdrawn = await db.createAccount(userId, { name: "Overdrawn", type: "checking", currency: "USD", balance: -200 })
        const after = await db.getDashboardData(userId)
        expect(after.totalAssets - before.totalAssets).toBeCloseTo(40, 2)
        expect(after.totalLiabilities - before.totalLiabilities).toBeCloseTo(200, 2)
        expect(after.netWorth - before.netWorth).toBeCloseTo(-160, 2)
        await db.deleteAccount(userId, card.id)
        await db.deleteAccount(userId, overdrawn.id)
      })

      it("monthlySummary is an array", async () => {
        const dashboard = await db.getDashboardData(userId)
        expect(Array.isArray(dashboard.monthlySummary)).toBe(true)
      })

      it("recentTransactions lists a row older than the two-month summary window", async () => {
        const account = await db.createAccount(userId, {
          name: "Dormant Account",
          type: "checking",
          currency: "USD",
          balance: 0,
        })
        await db.createTransaction(userId, {
          accountId: account.id,
          type: "expense",
          amount: 7,
          currency: "USD",
          description: "Old but recent",
          date: new Date(new Date().getFullYear() - 2, 0, 15),
        })
        const dashboard = await db.getDashboardData(userId)
        expect(dashboard.recentTransactions.length).toBeLessThanOrEqual(10)
        const total = (await db.getTransactions(userId, { limit: 1 })).total
        if (total <= 10) {
          expect(dashboard.recentTransactions.some((t) => t.description === "Old but recent")).toBe(true)
        }
      })
    })

    // ── Reports ─────────────────────────────────────────────────────────────

    describe("report data", () => {
      it("returns categorySpending and monthlySummary", async () => {
        const report = await db.getReportData(userId, {
          from: new Date("2026-01-01"),
          to: new Date("2026-12-31"),
        })
        expect(Array.isArray(report.categorySpending)).toBe(true)
        expect(Array.isArray(report.monthlySummary)).toBe(true)
        expect(typeof report.totalIncome).toBe("number")
        expect(typeof report.totalExpenses).toBe("number")
      })
    })

    // ── Net Worth Snapshots ───────────────────────────────────────────────────

    describe("net worth snapshots", () => {
      it("takeSnapshot returns correct shape", async () => {
        const snapshot = await db.takeSnapshot(userId)
        expect(snapshot.id).toBeTruthy()
        expect(snapshot.userId).toBe(userId)
        expect(typeof snapshot.totalAssets).toBe("number")
        expect(typeof snapshot.totalLiabilities).toBe("number")
        expect(snapshot.netWorth).toBe(snapshot.totalAssets - snapshot.totalLiabilities)
      })

      it("takeSnapshot is idempotent on same day", async () => {
        const first = await db.takeSnapshot(userId)
        const second = await db.takeSnapshot(userId)
        expect(second.id).toBe(first.id)
      })

      it("getNetWorthAt returns the newest snapshot on or before the date, and null with none", async () => {
        const today = await db.takeSnapshot(userId)
        const yesterday = new Date()
        yesterday.setDate(yesterday.getDate() - 1)
        const found = await db.getNetWorthAt(userId, new Date())
        expect(found?.id).toBe(today.id)
        expect(found?.netWorth).toBe(today.netWorth)
        // This user's first snapshot is today's: nothing sits on or before yesterday.
        expect(await db.getNetWorthAt(userId, yesterday)).toBeNull()
      })

      it("getNetWorthAt takes the newest snapshot on or before the day, never a later one", async () => {
        if (!seedNetWorthSnapshot) return
        // March 2020, long before anything else this user holds; 1 April is the "next month" decoy.
        await seedNetWorthSnapshot(new Date(2020, 2, 10), 10)
        await seedNetWorthSnapshot(new Date(2020, 2, 20), 20)
        await seedNetWorthSnapshot(new Date(2020, 2, 31), 31)
        await seedNetWorthSnapshot(new Date(2020, 3, 1), 41)
        expect((await db.getNetWorthAt(userId, new Date(2020, 2, 31)))?.netWorth).toBe(31)
        expect((await db.getNetWorthAt(userId, new Date(2020, 2, 31, 23, 30)))?.netWorth).toBe(31)
        expect((await db.getNetWorthAt(userId, new Date(2020, 2, 25)))?.netWorth).toBe(20)
        expect((await db.getNetWorthAt(userId, new Date(2020, 2, 19)))?.netWorth).toBe(10)
        expect((await db.getNetWorthAt(userId, new Date(2020, 3, 1)))?.netWorth).toBe(41)
        expect(await db.getNetWorthAt(userId, new Date(2020, 2, 9))).toBeNull()
      })

      it("getNetWorthHistory returns snapshots sorted ascending", async () => {
        const history = await db.getNetWorthHistory(userId, 12)
        expect(Array.isArray(history)).toBe(true)
        for (let i = 1; i < history.length; i++) {
          expect(history[i].date.getTime()).toBeGreaterThanOrEqual(history[i - 1].date.getTime())
        }
      })
    })

    // ── Unique Descriptions ───────────────────────────────────────────────

    describe("unique descriptions", () => {
      it("returns deduplicated sorted descriptions", async () => {
        const account = await db.createAccount(userId, {
          name: "Desc Test Account",
          type: "checking",
          currency: "USD",
          balance: 0,
        })
        await db.createTransaction(userId, {
          accountId: account.id,
          type: "expense",
          amount: 10,
          currency: "USD",
          description: "Zara",
          date: new Date("2026-03-01"),
        })
        await db.createTransaction(userId, {
          accountId: account.id,
          type: "expense",
          amount: 20,
          currency: "USD",
          description: "Apple",
          date: new Date("2026-03-02"),
        })
        await db.createTransaction(userId, {
          accountId: account.id,
          type: "expense",
          amount: 5,
          currency: "USD",
          description: "Zara",
          date: new Date("2026-03-03"),
        })
        const descs = await db.getUniqueDescriptions(userId)
        expect(descs).toContain("Apple")
        expect(descs).toContain("Zara")
        // Should be sorted
        const zaraIdx = descs.indexOf("Zara")
        const appleIdx = descs.indexOf("Apple")
        expect(appleIdx).toBeLessThan(zaraIdx)
        // No duplicates
        expect(descs.filter((d: string) => d === "Zara").length).toBe(1)
      })
    })

    // ── Merchant Normalization ──────────────────────────────────────────────

    describe("merchant normalization", () => {
      it("stores rawDescription when provided", async () => {
        const account = await db.createAccount(userId, {
          name: "Merchant Test Account",
          type: "checking",
          currency: "USD",
          balance: 0,
        })
        const tx = await db.createTransaction(userId, {
          accountId: account.id,
          type: "expense",
          amount: 10,
          currency: "USD",
          description: "Starbucks",
          rawDescription: "STARBUCKS STORE #12345 CA 90210",
          date: new Date("2026-03-01"),
        })
        expect(tx.rawDescription).toBe("STARBUCKS STORE #12345 CA 90210")
        expect(tx.description).toBe("Starbucks")
      })

      it("search matches rawDescription", async () => {
        const result = await db.getTransactions(userId, { search: "STARBUCKS STORE #12345" })
        expect(result.data.length).toBeGreaterThanOrEqual(1)
        expect(result.data[0].rawDescription).toContain("STARBUCKS STORE #12345")
      })

      it("renormalizeTransactions updates descriptions", async () => {
        const account = await db.createAccount(userId, {
          name: "Renorm Test Account",
          type: "checking",
          currency: "USD",
          balance: 0,
        })
        await db.createTransaction(userId, {
          accountId: account.id,
          type: "expense",
          amount: 20,
          currency: "USD",
          description: "old name",
          rawDescription: "AMZN MKTP US*ABCDEF",
          date: new Date("2026-03-02"),
        })
        const count = await db.renormalizeTransactions(userId)
        expect(count).toBeGreaterThanOrEqual(1)

        // Verify the description was updated
        const txs = await db.getTransactions(userId, { search: "AMZN MKTP" })
        const updated = txs.data.find((t) => t.rawDescription === "AMZN MKTP US*ABCDEF")
        expect(updated).toBeTruthy()
        expect(updated!.description).toBe("Amazon")
      })
    })

    // ── Split Transactions ────────────────────────────────────────────────

    describe("split transactions", () => {
      it("creates a transaction with splits and stores them", async () => {
        const account = await db.createAccount(userId, {
          name: "Split Test Account",
          type: "checking",
          currency: "USD",
          balance: 1000,
        })
        const cats = await db.getCategories(userId)
        const catA = cats[0]
        const catB = cats[1]

        const tx = await db.createTransaction(userId, {
          accountId: account.id,
          type: "expense",
          amount: 100,
          currency: "USD",
          description: "Walmart split",
          date: new Date("2026-03-01"),
          categoryId: null,
          splits: [
            { id: "s1", categoryId: catA.id, amount: 60 },
            { id: "s2", categoryId: catB.id, amount: 40 },
          ],
        })

        expect(tx.splits.length).toBe(2)
        expect(tx.splits.map((s) => s.amount).sort((a, b) => a - b)).toEqual([40, 60])
      })

      it("updates transaction replacing splits", async () => {
        const account = await db.createAccount(userId, {
          name: "Split Update Account",
          type: "checking",
          currency: "USD",
          balance: 500,
        })
        const cats = await db.getCategories(userId)

        const tx = await db.createTransaction(userId, {
          accountId: account.id,
          type: "expense",
          amount: 80,
          currency: "USD",
          description: "Split to update",
          date: new Date("2026-03-02"),
          categoryId: null,
          splits: [
            { id: "s1", categoryId: cats[0].id, amount: 50 },
            { id: "s2", categoryId: cats[1].id, amount: 30 },
          ],
        })

        const updated = await db.updateTransaction(userId, tx.id, {
          splits: [
            { id: "s3", categoryId: cats[2].id, amount: 80 },
          ],
        })

        expect(updated.splits.length).toBe(1)
        expect(updated.splits[0].amount).toBe(80)
      })

      it("dashboard categorySpending reflects splits", async () => {
        const account = await db.createAccount(userId, {
          name: "Dashboard Split Account",
          type: "checking",
          currency: "USD",
          balance: 2000,
        })
        const cats = await db.getCategories(userId)
        const catA = cats[0]
        const catB = cats[1]

        // Create a split transaction dated this month
        const now = new Date()
        await db.createTransaction(userId, {
          accountId: account.id,
          type: "expense",
          amount: 200,
          currency: "USD",
          description: "Split dashboard test",
          date: now,
          categoryId: null,
          splits: [
            { id: "ds1", categoryId: catA.id, amount: 120 },
            { id: "ds2", categoryId: catB.id, amount: 80 },
          ],
        })

        const dashboard = await db.getDashboardData(userId)
        const catASpending = dashboard.categorySpending.find((c) => c.categoryId === catA.id)
        const catBSpending = dashboard.categorySpending.find((c) => c.categoryId === catB.id)

        // These categories should have at least the split amounts
        expect(catASpending).toBeDefined()
        expect(catASpending!.amount).toBeGreaterThanOrEqual(120)
        expect(catBSpending).toBeDefined()
        expect(catBSpending!.amount).toBeGreaterThanOrEqual(80)
      })
    })

    // ── Recalculate Balances ────────────────────────────────────────────────

    describe("inline balance maintenance (no recalc)", () => {
      it("keeps account balances correct through create/transfer/delete without recalculateBalances", async () => {
        const a = await db.createAccount(userId, {
          name: "Inline A", type: "checking", currency: "USD", balance: 100,
        })
        const b = await db.createAccount(userId, {
          name: "Inline B", type: "savings", currency: "USD", balance: 0,
        })

        // income +50 → A = 150
        const income = await db.createTransaction(userId, {
          accountId: a.id, type: "income", amount: 50, currency: "USD",
          description: "pay", date: new Date("2026-06-01"),
        })
        expect((await db.getAccount(userId, a.id))!.balance).toBe(150)

        // expense -20 → A = 130
        const expense = await db.createTransaction(userId, {
          accountId: a.id, type: "expense", amount: 20, currency: "USD",
          description: "buy", date: new Date("2026-06-02"),
        })
        expect((await db.getAccount(userId, a.id))!.balance).toBe(130)

        // transfer 30 A→B → A = 100, B = 30
        const transfer = await db.createTransaction(userId, {
          accountId: a.id, type: "transfer", amount: 30, currency: "USD",
          description: "move", date: new Date("2026-06-03"), transferToAccountId: b.id,
        })
        expect((await db.getAccount(userId, a.id))!.balance).toBe(100)
        expect((await db.getAccount(userId, b.id))!.balance).toBe(30)

        // delete the transfer → A = 130, B = 0
        await db.deleteTransaction(userId, transfer.id)
        expect((await db.getAccount(userId, a.id))!.balance).toBe(130)
        expect((await db.getAccount(userId, b.id))!.balance).toBe(0)

        // delete income and expense → A back to its opening balance (100)
        await db.deleteTransaction(userId, income.id)
        await db.deleteTransaction(userId, expense.id)
        expect((await db.getAccount(userId, a.id))!.balance).toBe(100)
      })

      it("keeps balances correct when a transaction is edited (amount / account / type) without recalc", async () => {
        const a = await db.createAccount(userId, {
          name: "Edit A", type: "checking", currency: "USD", balance: 100,
        })
        const b = await db.createAccount(userId, {
          name: "Edit B", type: "checking", currency: "USD", balance: 0,
        })

        const tx = await db.createTransaction(userId, {
          accountId: a.id, type: "income", amount: 50, currency: "USD",
          description: "pay", date: new Date("2026-07-01"),
        })
        expect((await db.getAccount(userId, a.id))!.balance).toBe(150)

        // amount 50 → 80 → A = 180
        await db.updateTransaction(userId, tx.id, { amount: 80 })
        expect((await db.getAccount(userId, a.id))!.balance).toBe(180)

        // move to B → A back to 100, B = 80
        await db.updateTransaction(userId, tx.id, { accountId: b.id })
        expect((await db.getAccount(userId, a.id))!.balance).toBe(100)
        expect((await db.getAccount(userId, b.id))!.balance).toBe(80)

        // income → expense on B → B = 0 - 80 = -80
        await db.updateTransaction(userId, tx.id, { type: "expense" })
        expect((await db.getAccount(userId, b.id))!.balance).toBe(-80)
      })
    })

    describe("recalculateBalances", () => {
      it("builds on the opening balance instead of discarding it", async () => {
        // Account created with a non-zero opening balance.
        const account = await db.createAccount(userId, {
          name: "Opening Balance Account",
          type: "checking",
          currency: "USD",
          balance: 100,
        })
        expect(account.openingBalance).toBe(100)

        await db.createTransaction(userId, {
          accountId: account.id,
          type: "income",
          amount: 50,
          currency: "USD",
          description: "Extra income",
          date: new Date("2026-06-01"),
        })

        await db.recalculateBalances(userId)

        const updated = await db.getAccount(userId, account.id)
        // openingBalance (100) + income (50) = 150 — NOT 50 (the pure-sum bug)
        expect(updated!.balance).toBe(150)
        expect(updated!.openingBalance).toBe(100)
      })

      it("recomputes account balances from income and expense transactions", async () => {
        const checking = await db.createAccount(userId, {
          name: "Recalc Checking",
          type: "checking",
          currency: "USD",
          balance: 0,
        })

        // Income
        await db.createTransaction(userId, {
          accountId: checking.id,
          type: "income",
          amount: 1000,
          currency: "USD",
          description: "Salary",
          date: new Date("2026-04-01"),
        })

        // Two expenses
        await db.createTransaction(userId, {
          accountId: checking.id,
          type: "expense",
          amount: 250,
          currency: "USD",
          description: "Groceries",
          date: new Date("2026-04-02"),
        })
        await db.createTransaction(userId, {
          accountId: checking.id,
          type: "expense",
          amount: 150,
          currency: "USD",
          description: "Utilities",
          date: new Date("2026-04-03"),
        })

        // Recalculate balances
        await db.recalculateBalances(userId)

        const updated = await db.getAccount(userId, checking.id)
        // +1000 income, -250 expense, -150 expense = 600
        expect(updated!.balance).toBe(600)
      })

      it("transfer debits source and credits destination", async () => {
        const src = await db.createAccount(userId, {
          name: "Recalc Transfer Src",
          type: "checking",
          currency: "USD",
          balance: 0,
        })
        const dst = await db.createAccount(userId, {
          name: "Recalc Transfer Dst",
          type: "savings",
          currency: "USD",
          balance: 0,
        })

        // Seed income so source has funds
        await db.createTransaction(userId, {
          accountId: src.id,
          type: "income",
          amount: 500,
          currency: "USD",
          description: "Seed income",
          date: new Date("2026-04-10"),
        })

        // Transfer 200 from src to dst
        await db.createTransaction(userId, {
          accountId: src.id,
          type: "transfer",
          amount: 200,
          currency: "USD",
          description: "Move to savings",
          date: new Date("2026-04-11"),
          transferToAccountId: dst.id,
        })

        await db.recalculateBalances(userId)

        const updatedSrc = await db.getAccount(userId, src.id)
        const updatedDst = await db.getAccount(userId, dst.id)

        // Single-row transfer: src gets -200, dst gets +200
        // src: +500 income, -200 transfer = 300
        // dst: +200 from transfer = 200
        expect(updatedSrc!.balance).toBe(300)
        expect(updatedDst!.balance).toBe(200)
      })

      it("rebuilds current balance as openingBalance + transactions", async () => {
        // Opening balance of 99999 must be preserved, not discarded.
        const account = await db.createAccount(userId, {
          name: "Opening + Txns Account",
          type: "checking",
          currency: "USD",
          balance: 99999,
        })

        await db.createTransaction(userId, {
          accountId: account.id,
          type: "income",
          amount: 100,
          currency: "USD",
          description: "Only income",
          date: new Date("2026-04-15"),
        })

        await db.recalculateBalances(userId)

        const updated = await db.getAccount(userId, account.id)
        // openingBalance (99999) + income (100) = 100099
        expect(updated!.balance).toBe(100099)
        expect(updated!.openingBalance).toBe(99999)
      })
    })

    // ── Pagination Edge Cases ────────────────────────────────────────────────

    describe("getTransactions pagination", () => {
      let paginationAccountId: string

      beforeAll(async () => {
        const account = await db.createAccount(userId, {
          name: "Pagination Account",
          type: "checking",
          currency: "USD",
          balance: 0,
        })
        paginationAccountId = account.id

        // Create 5 transactions: 3 expenses, 2 incomes
        await db.createTransaction(userId, {
          accountId: account.id,
          type: "expense",
          amount: 10,
          currency: "USD",
          description: "Page tx 1",
          date: new Date("2026-05-01"),
        })
        await db.createTransaction(userId, {
          accountId: account.id,
          type: "expense",
          amount: 20,
          currency: "USD",
          description: "Page tx 2",
          date: new Date("2026-05-02"),
        })
        await db.createTransaction(userId, {
          accountId: account.id,
          type: "income",
          amount: 30,
          currency: "USD",
          description: "Page tx 3",
          date: new Date("2026-05-03"),
        })
        await db.createTransaction(userId, {
          accountId: account.id,
          type: "expense",
          amount: 40,
          currency: "USD",
          description: "Page tx 4",
          date: new Date("2026-05-04"),
        })
        await db.createTransaction(userId, {
          accountId: account.id,
          type: "income",
          amount: 50,
          currency: "USD",
          description: "Page tx 5",
          date: new Date("2026-05-05"),
        })
      })

      it("limit: 2, offset: 0 returns first 2 items and correct total", async () => {
        const result = await db.getTransactions(userId, {
          accountId: paginationAccountId,
          limit: 2,
          offset: 0,
        })
        expect(result.data.length).toBe(2)
        expect(result.total).toBe(5)
        expect(result.limit).toBe(2)
        expect(result.offset).toBe(0)
      })

      it("limit: 2, offset: 2 returns next page", async () => {
        const firstPage = await db.getTransactions(userId, {
          accountId: paginationAccountId,
          limit: 2,
          offset: 0,
        })
        const secondPage = await db.getTransactions(userId, {
          accountId: paginationAccountId,
          limit: 2,
          offset: 2,
        })
        expect(secondPage.data.length).toBe(2)
        expect(secondPage.total).toBe(5)
        expect(secondPage.offset).toBe(2)

        // Pages should contain different transactions
        const firstIds = firstPage.data.map((t) => t.id)
        const secondIds = secondPage.data.map((t) => t.id)
        expect(firstIds.every((id) => !secondIds.includes(id))).toBe(true)
      })

      it("offset > total returns empty data with correct total", async () => {
        const result = await db.getTransactions(userId, {
          accountId: paginationAccountId,
          limit: 10,
          offset: 100,
        })
        expect(result.data.length).toBe(0)
        expect(result.total).toBe(5)
      })

      it("no limit returns all items", async () => {
        const result = await db.getTransactions(userId, {
          accountId: paginationAccountId,
        })
        expect(result.data.length).toBe(5)
        expect(result.total).toBe(5)
      })

      it("limit without other filters pages the whole ledger and counts it all", async () => {
        const all = await db.getTransactions(userId)
        const page = await db.getTransactions(userId, { limit: 2, offset: 0 })
        expect(page.data.length).toBe(Math.min(2, all.total))
        expect(page.total).toBe(all.total)
        // Same-date rows may swap places between the two reads; the dates are the newest either way.
        expect(page.data.map((t) => t.date.getTime())).toEqual(all.data.slice(0, 2).map((t) => t.date.getTime()))
      })

      it("same-date rows never repeat or go missing across pages", async () => {
        const account = await db.createAccount(userId, {
          name: "Same Day Account",
          type: "checking",
          currency: "USD",
          balance: 0,
        })
        for (let i = 0; i < 5; i++) {
          await db.createTransaction(userId, {
            accountId: account.id,
            type: "expense",
            amount: i + 1,
            currency: "USD",
            description: `Same day ${i}`,
            date: new Date("2026-06-06"),
          })
        }
        const seen: string[] = []
        for (let offset = 0; offset < 5; offset += 2) {
          const page = await db.getTransactions(userId, { accountId: account.id, limit: 2, offset })
          expect(page.total).toBe(5)
          seen.push(...page.data.map((t) => t.id))
        }
        expect(new Set(seen).size).toBe(5)
      })

      it("an incoming transfer is paged under the destination account", async () => {
        const dest = await db.createAccount(userId, {
          name: "Transfer Dest",
          type: "savings",
          currency: "USD",
          balance: 0,
        })
        await db.createTransaction(userId, {
          accountId: paginationAccountId,
          type: "transfer",
          transferToAccountId: dest.id,
          amount: 12,
          currency: "USD",
          description: "Into dest",
          date: new Date("2026-05-06"),
        })
        const page = await db.getTransactions(userId, { accountId: dest.id, limit: 10, offset: 0 })
        expect(page.total).toBe(1)
        expect(page.data[0].description).toBe("Into dest")
      })

      it("pagination works with filters (type: expense + limit: 1)", async () => {
        const result = await db.getTransactions(userId, {
          accountId: paginationAccountId,
          type: "expense",
          limit: 1,
        })
        expect(result.data.length).toBe(1)
        expect(result.total).toBe(3) // 3 expenses total
        expect(result.data[0].type).toBe("expense")
      })
    })

    // ── User Data Isolation ─────────────────────────────────────────────────

    describe("user data isolation", () => {
      it("user B cannot read user A's account", async () => {
        const account = await db.createAccount(userId, {
          name: "Private Account",
          type: "checking",
          currency: "USD",
          balance: 5000,
        })
        const result = await db.getAccount(otherUserId, account.id)
        expect(result).toBeNull()
      })

      it("user B cannot read user A's transaction", async () => {
        const account = await db.createAccount(userId, {
          name: "Isolation Tx Account",
          type: "checking",
          currency: "USD",
          balance: 0,
        })
        const tx = await db.createTransaction(userId, {
          accountId: account.id,
          type: "expense",
          amount: 100,
          currency: "USD",
          description: "Secret purchase",
          date: new Date("2026-03-01"),
        })
        const result = await db.getTransaction(otherUserId, tx.id)
        expect(result).toBeNull()
      })

      it("user B cannot read user A's budget", async () => {
        const budget = await db.createBudget(userId, {
          name: "Private Budget",
          amount: 300,
          currency: "USD",
          period: "monthly",
        })
        const result = await db.getBudget(otherUserId, budget.id)
        expect(result).toBeNull()
      })

      it("user B cannot read user A's savings goal", async () => {
        const goal = await db.createSavingsGoal(userId, {
          name: "Private Goal",
          targetAmount: 1000,
          currency: "USD",
        })
        const result = await db.getSavingsGoal(otherUserId, goal.id)
        expect(result).toBeNull()
      })

      it("user B sees empty list for user A's accounts", async () => {
        // User A has accounts from earlier tests
        const userAAccounts = await db.getAccounts(userId)
        expect(userAAccounts.length).toBeGreaterThan(0)

        const userBAccounts = await db.getAccounts(otherUserId)
        expect(userBAccounts.length).toBe(0)
      })

      it("user B sees empty transactions for user A's data", async () => {
        const userBTransactions = await db.getTransactions(otherUserId)
        expect(userBTransactions.data.length).toBe(0)
      })
    })

    // ── Start from zero ────────────────────────────────────────────────────
    // Last on purpose: it empties the accounts the earlier suites build on.

    describe("deleteAllAccountData", () => {
      it("deletes accounts, transactions, recurring, net worth history and legacy balance snapshots, and nothing else", async () => {
        const account = await db.createAccount(userId, {
          name: "Wipe Me",
          type: "checking",
          currency: "USD",
          balance: 100,
        })
        await db.createTransaction(userId, {
          accountId: account.id,
          type: "expense",
          amount: 10,
          currency: "USD",
          description: "Wiped",
          date: new Date("2026-06-01"),
        })
        await db.createRecurringTransaction(userId, {
          accountId: account.id,
          type: "expense",
          amount: 5,
          currency: "USD",
          description: "Wiped monthly",
          frequency: "monthly",
          startDate: new Date("2026-01-01"),
        })
        await db.takeSnapshot(userId)
        await legacyBalanceSnapshots?.seed()
        const budget = await db.createBudget(userId, {
          name: "Survives the wipe",
          amount: 100,
          currency: "USD",
          period: "monthly",
        })

        await db.deleteAllAccountData(userId)

        expect(await db.getAccounts(userId)).toHaveLength(0)
        expect((await db.getTransactions(userId)).total).toBe(0)
        expect(await db.getRecurringTransactions(userId)).toHaveLength(0)
        expect(await db.getNetWorthHistory(userId, 1200)).toHaveLength(0)
        if (legacyBalanceSnapshots) expect(await legacyBalanceSnapshots.count()).toBe(0)
        expect((await db.getBudgets(userId)).some((b) => b.id === budget.id)).toBe(true)
      })
    })

  })
}

/**
 * What the server-side adapter (the Admin SDK) implements of finance: it bypasses the rules and has no
 * delete-account, import or snapshot paths, so it cannot run describeFinanceContract.
 */
export type FinanceAdminDb = Pick<
  FinanceAdapter,
  "createAccount" | "getAccount" | "createTransaction" | "updateTransaction" | "deleteTransaction" | "getTransaction"
> & {
  // No paging: the server reads the whole page it asks for.
  getTransactions(userId: string, filters?: TransactionFilters): Promise<{ data: Transaction[]; total: number }>
}

/**
 * The Admin surface bypasses firestore.rules, so the guards a transfer needs hold here or nowhere.
 * `get` is read in each case; the host cleans its data between cases.
 */
export function describeFinanceAdminContract(get: () => { db: FinanceAdminDb; userId: string }) {
  describe("finance (server-side)", () => {
    async function twoAccounts(openingA = 100) {
      const { db, userId } = get()
      const a = await db.createAccount(userId, { name: "Server A", type: "checking", currency: "USD", balance: openingA })
      const b = await db.createAccount(userId, { name: "Server B", type: "savings", currency: "USD", balance: 0 })
      const balance = async (id: string) => (await db.getAccount(userId, id))!.balance
      return { db, userId, a, b, balance }
    }
    const move = (accountId: string, extra: object = {}) => ({
      accountId, type: "transfer" as const, amount: 30, currency: "USD" as const, description: "move", date: new Date("2026-06-02"), ...extra,
    })

    it("getTransactions includes incoming transfers (#95)", async () => {
      const { db, userId, a, b } = await twoAccounts()
      await db.createTransaction(userId, move(a.id, { transferToAccountId: b.id }))

      const bTxs = await db.getTransactions(userId, { accountId: b.id })
      expect(bTxs.data).toHaveLength(1)
      expect(bTxs.data[0].transferToAccountId).toBe(b.id)
      expect((await db.getTransactions(userId, { accountId: a.id })).data).toHaveLength(1)
    })

    it("create / update / delete maintain balances atomically (#92)", async () => {
      const { db, userId, a, b, balance } = await twoAccounts()
      const income = await db.createTransaction(userId, {
        accountId: a.id, type: "income", amount: 50, currency: "USD", description: "pay", date: new Date("2026-06-01"),
      })
      expect(await balance(a.id)).toBe(150)

      const transfer = await db.createTransaction(userId, move(a.id, { transferToAccountId: b.id }))
      expect([await balance(a.id), await balance(b.id)]).toEqual([120, 30])

      await db.updateTransaction(userId, income.id, { amount: 80 })
      expect(await balance(a.id)).toBe(150)

      await db.deleteTransaction(userId, transfer.id)
      expect([await balance(a.id), await balance(b.id)]).toEqual([180, 0])
    })

    it("refuses a destinationless or self-directed transfer, balance untouched", async () => {
      const { db, userId, a, balance } = await twoAccounts()
      await expect(db.createTransaction(userId, move(a.id))).rejects.toThrow(/destination/i)
      await expect(db.createTransaction(userId, move(a.id, { transferToAccountId: a.id }))).rejects.toThrow(
        /same source and destination/i
      )
      expect(await balance(a.id)).toBe(100)
    })

    it("refuses an edit into a destinationless transfer without writing the doc", async () => {
      const { db, userId, a, balance } = await twoAccounts()
      const expense = await db.createTransaction(userId, {
        accountId: a.id, type: "expense", amount: 40, currency: "USD", description: "spend", date: new Date("2026-06-01"),
      })
      expect(await balance(a.id)).toBe(60)

      await expect(db.updateTransaction(userId, expense.id, { type: "transfer" })).rejects.toThrow(/destination/i)
      expect((await db.getTransaction(userId, expense.id))!.type).toBe("expense")
      expect(await balance(a.id)).toBe(60)
    })
  })
}
