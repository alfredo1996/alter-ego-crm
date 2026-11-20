
import { isoDate } from "@alter-ego/kernel/dates"

import { money, toolError, userIdOf, type FinanceMcpOptions } from "./context"
import {
  ok,
  resolveAccount,
  resolveCategory,
  round2,
  ToolInputError,
} from "./helpers"
import { ARCHIVE_REFUSAL, assertArchivable, assertLedgerValid, closedTarget } from "../lib/account-ledger"
import { accountKind } from "../lib/net-worth"
import { z } from "../lib/zod"

import type { Account, Category, Currency, Transaction, TransactionType } from "../types"
import type { McpServer } from "@modelcontextprotocol/server"

/**
 * Write tools for personal transactions: expenses, income and transfers.
 *
 * Account balances are NOT maintained here — `createTransaction` /
 * `updateTransaction` / `deleteTransaction` already apply `balanceEffects`
 * atomically, including both sides of a transfer and the reverse-then-reapply
 * on edit. These tools resolve names to ids, enforce the invariants nothing
 * below them enforces, and hand off.
 *
 * That last part is load-bearing: MCP runs through the Admin SDK, which
 * bypasses Firestore rules entirely. Whatever is not checked here is not
 * checked at all.
 */

// ─── Preview, then confirm ───────────────────────────────────────────────────
// Read tools hand third-party text (bank descriptions, notes) to the model, so
// an edit or delete never writes on the first call: it returns what would
// change, and only a repeat with confirm: true writes (#351).

const confirmInput = z.boolean().optional()

const CONFIRM_RULE =
  "Preview, then confirm: called without confirm it changes nothing and returns exactly what would change. " +
  "Show that preview to the owner and ask; only once they agree call again, the same arguments, with confirm: true."

async function previewOrApply(
  confirm: boolean | undefined,
  change: {
    action: string
    before: Record<string, unknown>
    after: Record<string, unknown> | null
    write: () => Promise<unknown>
    payload: () => Record<string, unknown>
    id: string
  }
): Promise<{ payload: Record<string, unknown>; documentIds: string[] }> {
  if (confirm) {
    await change.write()
    return { payload: change.payload(), documentIds: [change.id] }
  }
  const show = (v: unknown) => (v === null || v === undefined ? "none" : typeof v === "string" ? `"${v}"` : String(v))
  const changes = change.after
    ? Object.keys(change.after)
        .filter((k) => change.before[k] !== change.after![k])
        .map((k) => `${k} ${show(change.before[k])} → ${show(change.after![k])}`)
    : []
  // A delete moves money; an edit only when it touches what a balance is built from.
  const moves = !change.after || changes.some((c) => /^(type|amount|account|toAccount) /.test(c))
  const listed = change.after ? ` Changes: ${changes.join(", ") || "none, it already reads so"}.` : ""
  return {
    payload: {
      preview: true,
      summary:
        `Preview, nothing changed yet: ${change.action}.${listed} ${moves ? "Account balances are adjusted when it is applied." : "No balance moves."} ` +
        "Show this to the owner and ask; if they agree, call again with the same arguments and confirm: true.",
      before: change.before,
      after: change.after,
      ...(change.after ? { changes } : {}),
    },
    documentIds: [],
  }
}

/** Names the HTTP-layer scope gate requires the write scope for. */
export const FINANCE_WRITE_TOOLS = new Set([
  "add_transaction",
  "update_transaction",
  "delete_transaction",
  "create_account",
  "archive_account",
])

const dateInput = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD (e.g. 2026-08-23)")

/** Parses "YYYY-MM-DD" to local midnight — stored dates are local, not UTC. */
function parseDate(input: string): Date {
  const [year, month, day] = input.split("-").map(Number)
  const date = new Date(year, month - 1, day)
  if (date.getMonth() !== month - 1 || date.getDate() !== day) {
    throw new ToolInputError(`Invalid date: "${input}" does not exist.`)
  }
  return date
}

type ToolResult = ReturnType<typeof ok>

/**
 * Runs a write tool and records the outcome in mcp_audit — an LLM is writing
 * real financial data, so every attempt leaves a trace. A failed audit write
 * never fails the tool.
 */
async function audited(
  db: FinanceMcpOptions["db"],
  ctx: { http?: { authInfo?: { clientId?: string; extra?: Record<string, unknown> } } },
  tool: string,
  params: unknown,
  run: (userId: string) => Promise<{ payload: unknown; documentIds?: string[] }>,
  preview = false
): Promise<ToolResult> {
  const userId = userIdOf(ctx)
  const oauthClient = ctx.http?.authInfo?.clientId ?? "unknown"
  try {
    const { payload, documentIds } = await run(userId)
    void db().addAuditEntry(userId, { tool, params, result: "ok", documentIds, clientId: oauthClient, ...(preview && { preview: true }) }).catch(
      (e) => console.error("mcp_audit write failed:", e)
    )
    return ok(payload)
  } catch (e) {
    const failed = toolError(e)
    const errorMessage = e instanceof ToolInputError ? e.message : String(e)
    void db().addAuditEntry(userId, { tool, params, result: "error", errorMessage, clientId: oauthClient, ...(preview && { preview: true }) }).catch(
      (err) => console.error("mcp_audit write failed:", err)
    )
    return failed
  }
}

/**
 * A closed account takes no new money: it is out of every total and picker, so
 * the money would vanish from view. resolveAccount still matches it (reads and
 * archive_account reopen need that), so the write tools call this after it.
 */
function assertOpenAccount(account: Account, own: (string | null)[] = []): Account {
  if (closedTarget([account], [account.id], own)) {
    throw new ToolInputError(
      `Account "${account.name}" is closed. Reopen it first with archive_account (archived false).`
    )
  }
  return account
}

/**
 * The account a write targets. With exactly one open account the argument is
 * optional — with several it is required rather than guessed, because guessing
 * wrong moves money in the wrong ledger.
 */
function pickAccount(accounts: Account[], query: string | undefined, label: string): Account {
  if (query) return assertOpenAccount(resolveAccount(accounts, query))

  const open = accounts.filter((a) => !a.isArchived)
  if (open.length === 1) return open[0]
  if (open.length === 0) {
    throw new ToolInputError("No open account. Create one with create_account or in the web app.")
  }
  throw new ToolInputError(
    `Several accounts are open, specify ${label}: ${open.map((a) => a.name).join(", ")}.`
  )
}

/**
 * The currency a new account should default to. Same rule as pickAccount: infer
 * only when there is one possible answer, otherwise make the caller say it —
 * guessing here would denominate a wallet in the wrong money.
 */
function pickCurrency(accounts: Account[]): Currency {
  const distinct = [...new Set(accounts.map((a) => a.currency))]
  if (distinct.length === 1) return distinct[0]
  if (distinct.length === 0) {
    throw new ToolInputError("No existing account to infer the currency from: specify `currency`.")
  }
  throw new ToolInputError(
    `Existing accounts use several currencies (${distinct.join(", ")}): specify \`currency\`.`
  )
}

/**
 * The ledger invariant, plus the positive-amount rule the Zod schema states but
 * this tool's own schema must restate. `assertLedgerValid` is shared with the
 * adapters, so the transfer rule is enforced identically here, in the web form
 * and in the REST API — this call exists to turn it into a readable
 * tool error before the adapter throws a raw one.
 */
function assertValid(tx: {
  type: TransactionType
  accountId: string
  transferToAccountId: string | null
  amount: number
}) {
  if (tx.type === "transfer" && !tx.transferToAccountId) {
    throw new ToolInputError(
      "A transfer needs a destination account (`toAccount`), otherwise the amount would vanish."
    )
  }
  if (tx.type === "transfer" && tx.transferToAccountId === tx.accountId) {
    throw new ToolInputError("The source and destination accounts are the same.")
  }
  assertLedgerValid(tx)
  if (!(tx.amount > 0)) {
    throw new ToolInputError("The amount must be positive — the type carries the sign.")
  }
}

/**
 * A same-day transaction with the same account, amount and description already
 * exists. This is the failure that actually happens: a retried tool call, or
 * the user mentioning the same expense twice in one conversation. Refusing by
 * default and naming the existing row beats silently doubling the rent.
 */
function findDuplicate(
  existing: Transaction[],
  candidate: { accountId: string; amount: number; description: string; date: Date }
): Transaction | undefined {
  const day = isoDate(candidate.date)
  const description = candidate.description.trim().toLowerCase()
  return existing.find(
    (t) =>
      t.accountId === candidate.accountId &&
      t.amount === candidate.amount &&
      isoDate(t.date) === day &&
      t.description.trim().toLowerCase() === description
  )
}

function card(tx: Transaction, accounts: Account[], categories: Category[]) {
  const accountName = (id: string | null) => accounts.find((a) => a.id === id)?.name ?? null
  return {
    id: tx.id,
    type: tx.type,
    amount: tx.amount,
    currency: tx.currency,
    description: tx.description,
    date: isoDate(tx.date),
    account: accountName(tx.accountId),
    toAccount: accountName(tx.transferToAccountId),
    category: tx.categoryId ? (categories.find((c) => c.id === tx.categoryId)?.name ?? null) : null,
  }
}

export function registerFinanceWriteTools(server: McpServer, { db }: FinanceMcpOptions) {
  server.registerTool(
    "add_transaction",
    {
      title: "New Transaction",
      description:
        "Records a PERSONAL expense, income or transfer on the owner's own accounts: 'spent 12 euros on lunch' → type expense, " +
        "amount 12; 'salary 3000' → type income; «sposto 500 dal conto al libretto» → type " +
        "transfer with toAccount. Amount is always positive — the type carries the sign. Date " +
        "defaults to today; convert relative dates to YYYY-MM-DD yourself. Currency comes from the " +
        "account. Refuses a same-day duplicate (same account, amount and description) unless force " +
        "is set, so a retried call cannot double-post. Never for the company (SRL): its costs and bank " +
        "movements are add_expense and add_movement, when the company tools are installed, so a company " +
        "cost never lands in the personal ledger.",
      inputSchema: z.object({
        type: z.enum(["expense", "income", "transfer"]),
        amount: z.number().positive().finite(),
        description: z.string().min(1).max(500),
        date: dateInput.optional(),
        account: z.string().min(1).optional(),
        toAccount: z.string().min(1).optional(),
        category: z.string().min(1).optional(),
        notes: z.string().max(1000).optional(),
        force: z.boolean().optional(),
      }),
    },
    async (input, ctx) =>
      audited(db, ctx, "add_transaction", input, async (userId) => {
        const [accounts, categories] = await Promise.all([
          db().getAccounts(userId),
          db().getCategories(userId),
        ])

        const account = pickAccount(accounts, input.account, "the account")
        const toAccount =
          input.type === "transfer" && input.toAccount
            ? assertOpenAccount(resolveAccount(accounts, input.toAccount))
            : null
        if (input.toAccount && input.type !== "transfer") {
          throw new ToolInputError("`toAccount` only applies to transfers.")
        }
        const category = input.category ? resolveCategory(categories, input.category) : null
        const date = input.date ? parseDate(input.date) : new Date()

        assertValid({
          type: input.type,
          accountId: account.id,
          transferToAccountId: toAccount?.id ?? null,
          amount: input.amount,
        })

        if (!input.force) {
          const { data } = await db().getTransactions(userId, {
            dateFrom: new Date(date.getFullYear(), date.getMonth(), date.getDate()),
            dateTo: new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999),
          })
          const duplicate = findDuplicate(data, {
            accountId: account.id,
            amount: input.amount,
            description: input.description,
            date,
          })
          if (duplicate) {
            throw new ToolInputError(
              `An identical transaction already exists on ${isoDate(duplicate.date)}: "${duplicate.description}" ` +
                `${money(duplicate.amount, duplicate.currency)} on ${account.name} (id ${duplicate.id}). ` +
                "Pass force: true if it really is a second one."
            )
          }
        }

        const created = await db().createTransaction(userId, {
          accountId: account.id,
          type: input.type,
          amount: input.amount,
          currency: account.currency,
          categoryId: category?.id ?? null,
          description: input.description.trim(),
          date,
          notes: input.notes ?? null,
          transferToAccountId: toAccount?.id ?? null,
        })

        const verb =
          input.type === "expense" ? "Expense" : input.type === "income" ? "Income" : "Transfer"
        return {
          payload: {
            summary:
              `${verb} of ${money(created.amount, created.currency)} recorded on ${account.name}` +
              (toAccount ? ` → ${toAccount.name}` : "") +
              (category ? ` (${category.name})` : "") +
              `, ${isoDate(created.date)}.`,
            transaction: card(created, accounts, categories),
          },
          documentIds: [created.id],
        }
      })
  )

  server.registerTool(
    "update_transaction",
    {
      title: "Edit Transaction",
      description:
        "Corrects an existing PERSONAL transaction by id — 'that expense was 25, not 20' or 'file it " +
        "under travel'. Pass only the fields that change; the rest stay as they are. Account " +
        "balances are adjusted automatically, including both sides when a transfer's destination " +
        "moves. Use list_transactions first to get the id. Never for the company (SRL): its Cash Book entries are " +
        "update_movement, update_expense, update_loan and update_invoice, when the company tools are installed. " +
        CONFIRM_RULE,
      inputSchema: z.object({
        confirm: confirmInput,
        id: z.string().min(1),
        type: z.enum(["expense", "income", "transfer"]).optional(),
        amount: z.number().positive().finite().optional(),
        description: z.string().min(1).max(500).optional(),
        date: dateInput.optional(),
        account: z.string().min(1).optional(),
        toAccount: z.string().min(1).optional(),
        category: z.string().min(1).optional(),
        notes: z.string().max(1000).optional(),
      }),
    },
    async (input, ctx) =>
      audited(db, ctx, "update_transaction", input, async (userId) => {
        const existing = await db().getTransaction(userId, input.id)
        if (!existing) {
          throw new ToolInputError(
            `No transaction with id "${input.id}". Use list_transactions to find it.`
          )
        }

        const [accounts, categories] = await Promise.all([
          db().getAccounts(userId),
          db().getCategories(userId),
        ])
        // Either of the transaction's own accounts stays pickable in both fields,
        // as in the app's edit form (#219); only moving money onto another closed
        // account is refused.
        const own = [existing.accountId, existing.transferToAccountId]
        const open = (a: Account) => assertOpenAccount(a, own)
        const account = input.account ? open(resolveAccount(accounts, input.account)) : null
        const toAccount = input.toAccount ? open(resolveAccount(accounts, input.toAccount)) : null
        const category = input.category ? resolveCategory(categories, input.category) : null

        // Validate the merged result, not just the fields that changed —
        // switching an expense to a transfer without naming a destination is
        // exactly the state a create would refuse.
        const type = input.type ?? existing.type
        const accountId = account?.id ?? existing.accountId
        const transferToAccountId =
          toAccount?.id ?? (input.type && input.type !== "transfer" ? null : existing.transferToAccountId)
        assertValid({
          type,
          accountId,
          transferToAccountId,
          amount: input.amount ?? existing.amount,
        })

        const patch = {
          ...(input.type !== undefined && { type: input.type }),
          ...(input.amount !== undefined && { amount: input.amount }),
          ...(input.description !== undefined && { description: input.description.trim() }),
          ...(input.date !== undefined && { date: parseDate(input.date) }),
          ...(account && { accountId: account.id, currency: account.currency }),
          ...(input.notes !== undefined && { notes: input.notes }),
          ...(category && { categoryId: category.id }),
          // Only written when the merged transfer destination actually moves,
          // so an unrelated edit never clears the other side of a transfer.
          ...(transferToAccountId !== existing.transferToAccountId && { transferToAccountId }),
        }
        const nameOf = (id: string | null | undefined) => accounts.find((a) => a.id === id)?.name ?? null
        const view = (t: { type: string; amount: number; description: string; date: Date; accountId: string; transferToAccountId?: string | null; notes?: string | null; categoryId?: string | null }) => ({
          type: t.type,
          amount: t.amount,
          description: t.description,
          date: isoDate(t.date),
          account: nameOf(t.accountId),
          toAccount: nameOf(t.transferToAccountId),
          category: categories.find((c) => c.id === t.categoryId)?.name ?? null,
          notes: t.notes ?? null,
        })
        const next = { ...existing, ...patch }
        let updated: Transaction | undefined
        return previewOrApply(input.confirm, {
          action: `Edit "${existing.description}" ${money(existing.amount, existing.currency)}, ${isoDate(existing.date)}`,
          id: existing.id,
          before: view(existing),
          after: view(next as Transaction),
          write: async () => {
            updated = await db().updateTransaction(userId, input.id, patch)
          },
          payload: () => ({
            summary: `Transaction updated: "${updated!.description}" ${money(updated!.amount, updated!.currency)}, ${isoDate(updated!.date)}.`,
            transaction: card(updated!, accounts, categories),
          }),
        })
      }, !input.confirm)
  )

  server.registerTool(
    "delete_transaction",
    {
      title: "Delete Transaction",
      description:
        "Deletes a PERSONAL transaction by id — for a genuine mistake such as the same expense entered " +
        "twice. The account balance is restored, both sides for a transfer. Irreversible: use " +
        "list_transactions first and confirm with the user that it is the right transaction. Never for the " +
        "company (SRL): its Cash Book entries are delete_movement, delete_expense, delete_loan and delete_invoice, " +
        "when the company tools are installed. " +
        CONFIRM_RULE,
      inputSchema: z.object({ id: z.string().min(1), confirm: confirmInput }),
    },
    async (input, ctx) =>
      audited(db, ctx, "delete_transaction", input, async (userId) => {
        const existing = await db().getTransaction(userId, input.id)
        if (!existing) {
          throw new ToolInputError(
            `No transaction with id "${input.id}". Use list_transactions to find it.`
          )
        }
        const accounts = await db().getAccounts(userId)
        const accountName = accounts.find((a) => a.id === existing.accountId)?.name ?? "an unknown account"

        const what = `"${existing.description}" ${money(existing.amount, existing.currency)} on ${accountName}, ${isoDate(existing.date)}`
        return previewOrApply(input.confirm, {
          action: `Delete ${what}`,
          id: existing.id,
          before: {
            id: existing.id,
            type: existing.type,
            description: existing.description,
            amount: existing.amount,
            account: accountName,
            toAccount: accounts.find((a) => a.id === existing.transferToAccountId)?.name ?? null,
            date: isoDate(existing.date),
          },
          after: null,
          write: () => db().deleteTransaction(userId, input.id),
          payload: () => ({
            summary: `Deleted: ${what}. Balance restored.`,
            deleted: { id: existing.id, description: existing.description, amount: existing.amount },
          }),
        })
      }, !input.confirm)
  )

  server.registerTool(
    "create_account",
    {
      title: "New Account",
      description:
        "Opens a new PERSONAL wallet, bank account, card or loan of the owner's (a company (SRL) bank account is " +
        "added in the Cash Book, when the company tools are installed, never here). balance is the starting " +
        "balance BEFORE any " +
        "transaction — it becomes the opening balance every later transaction builds on, so pass what " +
        "the account holds today and record transactions from here on. Kind only sets how a balance " +
        "above 0 reads (yours, or owed to you); net worth follows the balance sign. Leave it out and " +
        "the type decides. Fails on a duplicate name.",
      inputSchema: z.object({
        name: z.string().min(1).max(100),
        type: z.enum(["checking", "savings", "credit_card", "cash", "investment", "loan", "other"]),
        balance: z.number().finite().optional(),
        kind: z.enum(["asset", "liability"]).optional(),
        currency: z.enum(["USD", "EUR", "GBP", "JPY", "CAD", "AUD", "CHF", "MXN", "BRL", "ARS"]).optional(),
      }),
    },
    async (input, ctx) =>
      audited(db, ctx, "create_account", input, async (userId) => {
        const accounts = await db().getAccounts(userId)
        const name = input.name.trim()
        const duplicate = accounts.find((a) => a.name.toLowerCase() === name.toLowerCase())
        if (duplicate) {
          throw new ToolInputError(
            `An account "${duplicate.name}"${duplicate.isArchived ? " (archived)" : ""} already exists.`
          )
        }

        const created = await db().createAccount(userId, {
          name,
          type: input.type,
          kind: input.kind ?? null,
          currency: input.currency ?? pickCurrency(accounts),
          balance: input.balance ?? 0,
        })
        return {
          payload: {
            summary:
              `Account "${created.name}" (${created.type}) created with an opening balance of ` +
              `${money(created.balance, created.currency)}.`,
            account: {
              id: created.id,
              name: created.name,
              type: created.type,
              kind: accountKind(created),
              currency: created.currency,
              balance: created.balance,
            },
          },
          documentIds: [created.id],
        }
      })
  )
  server.registerTool(
    "archive_account",
    {
      title: "Close or Reopen Account",
      description:
        "Closes (archives) or reopens one of the owner's PERSONAL accounts, as Archive does in the app: «chiudi il " +
        "conto Revolut», «archivia la carta», «riapri il conto». A closed account leaves the totals, net worth " +
        "and the account pickers, and keeps its history. It can be closed only at a balance of 0: otherwise " +
        "nothing is changed and the reply gives the balance to move out first. Reopening is always allowed. " +
        "Never deletes an account.",
      inputSchema: z.object({
        account: z.string().min(1).describe("Account name or id; closed accounts match too, to be reopened"),
        archived: z.boolean().describe("true closes the account, false reopens it"),
      }),
    },
    async (input, ctx) =>
      audited(db, ctx, "archive_account", input, async (userId) => {
        const target = resolveAccount(await db().getAccounts(userId), input.account)
        const refusal = (a: { name: string; balance: number; currency: Currency }) =>
          new ToolInputError(`"${a.name}" is at ${money(a.balance, a.currency)}: move the balance out before closing it.`)
        try {
          assertArchivable(target, { isArchived: input.archived })
        } catch {
          throw refusal(target)
        }
        let updated
        try {
          updated = await db().updateAccount(userId, target.id, { isArchived: input.archived })
        } catch (e) {
          // A transaction landed after the check above: the adapter's own guard refused. Say so with the new balance.
          if (e instanceof Error && e.message === ARCHIVE_REFUSAL) {
            throw refusal(resolveAccount(await db().getAccounts(userId), target.id))
          }
          throw e
        }
        return {
          payload: {
            summary:
              `Account "${updated.name}" (${updated.type}) ${updated.isArchived ? "closed" : "reopened"}, ` +
              `balance ${money(updated.balance, updated.currency)}.`,
            account: {
              id: updated.id,
              name: updated.name,
              type: updated.type,
              balance: round2(updated.balance),
              currency: updated.currency,
              isArchived: updated.isArchived,
            },
          },
          documentIds: [updated.id],
        }
      })
  )
}
