
import { isoDate } from "@alter-ego/kernel/dates"

import { mixedNote, money, moneyIn, monthInput, toolError, userIdOf, type FinanceMcpOptions } from "./context"
import {
  normalizeMonth,
  ok,
  resolveAccount,
  resolveCategory,
  resolveDateWindow,
  round2,
  ToolInputError,
} from "./helpers"
import { byUrgency, getBudgetStatus, loadBudgetsWithSpending, periodStartFor } from "../lib/budgets"
import { loanBuckets } from "../lib/loan-buckets"
import { accountKind, netWorthTotals } from "../lib/net-worth"
import { z } from "../lib/zod"

import type { CategoryGroup, Tag, Transaction, TransactionStatus, TransactionType } from "../types"
import type { McpServer } from "@modelcontextprotocol/server"

/**
 * Read-only MCP tools for the personal finance side (accounts, transactions,
 * budgets, spending). Every number comes from the same engine the web UI uses —
 * `getReportData` for spending, `budgetsWithSpending` for budgets — so chat and
 * UI cannot disagree.
 *
 * The matching writes live in `finance-write.ts`; this file stays read-only so
 * the two halves can be reasoned about (and scope-gated) separately.
 */

/**
 * Same surface as monthInput, but list_transactions actually honours the day.
 * Named apart so the difference is visible at the call site rather than implied.
 */
const dayOrMonthInput = z
  .string()
  .regex(/^\d{4}-\d{2}(-\d{2})?$/, "Use YYYY-MM-DD or YYYY-MM")

/** Last day of the month, at end-of-day — the inclusive upper bound of a window. */
function monthEnd(yearMonth: string): Date {
  const year = Number(yearMonth.slice(0, 4))
  const month = Number(yearMonth.slice(5, 7))
  return new Date(year, month, 0, 23, 59, 59, 999)
}

function monthStart(yearMonth: string): Date {
  return new Date(Number(yearMonth.slice(0, 4)), Number(yearMonth.slice(5, 7)) - 1, 1)
}

/**
 * Resolves the [from, to] month window shared by the window-taking tools.
 * `to` defaults to `from`, so a single month is one argument.
 */
function resolveWindow(input: { from: string; to?: string }): {
  from: string
  to: string
  range: { from: Date; to: Date }
} {
  const from = normalizeMonth(input.from)
  const to = input.to ? normalizeMonth(input.to) : from
  if (to < from) {
    throw new ToolInputError(`Invalid range: "${from}" is after "${to}".`)
  }
  return { from, to, range: { from: monthStart(from), to: monthEnd(to) } }
}

// ponytail: exact name or id only; add resolveCategory's prefix/substring tiers if tag names get long.
function resolveTag(tags: Tag[], query: string): Tag {
  const q = query.trim().toLowerCase()
  const tag = tags.find((t) => t.id === query || t.name.toLowerCase() === q)
  if (tag) return tag
  throw new ToolInputError(
    `No tag matches "${query}". Tags: ${tags.map((t) => t.name).join(", ") || "none"}.`
  )
}

function transactionCard(
  tx: Transaction,
  categoryName: (id: string | null) => string | null,
  accountName: (id: string) => string | null,
  tagName: (id: string) => string | null
) {
  return {
    id: tx.id,
    date: isoDate(tx.date),
    description: tx.description,
    amount: tx.amount,
    currency: tx.currency,
    type: tx.type,
    category: categoryName(tx.categoryId),
    account: accountName(tx.accountId),
    status: tx.status,
    // Split transactions carry no single category — flagged so a null category
    // above doesn't read as "uncategorised".
    isSplit: tx.splits.length > 0,
    // Imports put the detail here (Money Manager's Descrizione), so without it
    // many rows are unreadable.
    notes: tx.notes,
    tags: tx.tagIds.map(tagName).filter((name): name is string => name !== null),
    // Balance adjustments and internal moves: listed, but left out of every total.
    excludeFromReports: tx.excludeFromReports,
  }
}

export function registerFinanceReadTools(server: McpServer, { db }: FinanceMcpOptions) {
  server.registerTool(
    "list_categories",
    {
      title: "List Categories",
      description:
        "Every category available for classifying a transaction, grouped. Call this before " +
        "add_transaction when unsure what a spend should be filed under — categories cannot be " +
        "created from here, so the name has to be one of these. Defaults shipped with the app and " +
        "the ones the user added are both listed; `isDefault` tells them apart.",
      inputSchema: z.object({
        group: z
          .enum([
            "income",
            "housing",
            "transportation",
            "food",
            "utilities",
            "healthcare",
            "personal",
            "entertainment",
            "education",
            "savings",
            "debt",
            "other",
          ])
          .optional(),
      }),
    },
    async (input, ctx) => {
      try {
        const userId = userIdOf(ctx)
        const categories = await db().getCategories(userId)
        const pool = input.group ? categories.filter((c) => c.group === input.group) : categories

        const rows = pool
          .map((c) => ({
            id: c.id,
            name: c.name,
            group: c.group,
            isDefault: c.isDefault,
            parentId: c.parentId,
          }))
          .sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name))

        const byGroup = rows.reduce<Record<string, number>>((acc, r) => {
          acc[r.group] = (acc[r.group] ?? 0) + 1
          return acc
        }, {})

        return ok({
          summary:
            `${rows.length} ${rows.length === 1 ? "category" : "categories"}` +
            (input.group ? ` in the ${input.group as CategoryGroup} group.` : "."),
          categories: rows,
          countByGroup: byGroup,
        })
      } catch (e) {
        return toolError(e)
      }
    }
  )

  server.registerTool(
    "list_accounts",
    {
      title: "List Accounts",
      description:
        "Lists the owner's PERSONAL accounts with their current balance, split into assets and liabilities, " +
        "plus the net worth those balances add up to. Use for 'how much do I have in my own accounts?' or to " +
        "find an account's exact name before filtering transactions by it. Archived accounts are hidden " +
        "unless includeArchived. A loan account (money lent to people, one transfer per loan with the person " +
        "in the description) also carries byPerson: what each person owes (balance above 0) or is owed " +
        "(below 0) «quanto mi deve Alice», with lent and repaid totals; read it instead of adding up " +
        "list_transactions. The company's (SRL) bank accounts are never listed here: they are in " +
        "get_cash_book, when the company tools are installed.",
      inputSchema: z.object({ includeArchived: z.boolean().optional() }),
    },
    async (input, ctx) => {
      try {
        const userId = userIdOf(ctx)
        const all = await db().getAccounts(userId)
        const accounts = input.includeArchived ? all : all.filter((a) => !a.isArchived)

        // Who owes what on each loan account, the same buckets as the account page.
        const people = new Map(
          await Promise.all(
            accounts
              .filter((a) => a.type === "loan")
              .map(async (a) => {
                const { data } = await db().getTransactions(userId, { accountId: a.id })
                return [a.id, loanBuckets(data, a.id)] as const
              }),
          ),
        )

        const rows = accounts.map((a) => {
          const buckets = people.get(a.id)
          return {
            id: a.id,
            name: a.name,
            type: a.type,
            kind: accountKind(a),
            balance: a.balance,
            currency: a.currency,
            isArchived: a.isArchived,
            ...(buckets && {
              byPerson: buckets
                .filter((b) => b.balance !== 0)
                .map((b) => ({ name: b.name, balance: b.balance, lent: b.lent, repaid: b.repaid })),
              settled: buckets.filter((b) => b.balance === 0).map((b) => b.name),
            }),
          }
        })
        // By the balance's sign, the same totals as the dashboard.
        const totals = netWorthTotals(rows)
        const assets = round2(totals.totalAssets)
        const liabilities = round2(totals.totalLiabilities)
        const owed = rows
          .filter((r) => r.byPerson?.length)
          .map((r) => {
            const toYou = round2(r.byPerson!.filter((b) => b.balance > 0).reduce((s, b) => s + b.balance, 0))
            const byYou = round2(r.byPerson!.filter((b) => b.balance < 0).reduce((s, b) => s - b.balance, 0))
            const m = (n: number) => money(n, r.currency)
            const names = (sign: 1 | -1) => r.byPerson!.filter((b) => Math.sign(b.balance) === sign).map((b) => b.name).join(", ")
            return (
              ` ${r.name}:` +
              (toYou > 0 ? ` ${names(1)} owe you ${m(toYou)}` : "") +
              (toYou > 0 && byYou > 0 ? ";" : "") +
              (byYou > 0 ? ` you owe ${names(-1)} ${m(byYou)}` : "") +
              "."
            )
          })
          .join("")

        // The totals add balances as they are, with no conversion: bare numbers when the accounts differ in currency.
        const fmt = (n: number) => moneyIn(n, rows.map((r) => r.currency))
        return ok({
          summary:
            `${rows.length} ${rows.length === 1 ? "account" : "accounts"}: assets ${fmt(assets)}, liabilities ${fmt(liabilities)}, net worth ${fmt(totals.netWorth)}.` +
            mixedNote(rows.map((r) => r.currency)) +
            owed,
          accounts: rows,
          assets,
          liabilities,
          netWorth: round2(totals.netWorth),
        })
      } catch (e) {
        return toolError(e)
      }
    }
  )

  server.registerTool(
    "list_tags",
    {
      title: "List Tags",
      description:
        "Every tag the user has created. Call this to find a tag's exact name before filtering " +
        "list_transactions by `tag`.",
      inputSchema: z.object({}),
    },
    async (_input, ctx) => {
      try {
        const tags = await db().getTags(userIdOf(ctx))
        const rows = tags
          .map((t) => ({ id: t.id, name: t.name, color: t.color }))
          .sort((a, b) => a.name.localeCompare(b.name))
        return ok({ summary: `${rows.length} ${rows.length === 1 ? "tag" : "tags"}.`, tags: rows })
      } catch (e) {
        return toolError(e)
      }
    }
  )

  server.registerTool(
    "list_transactions",
    {
      title: "List Transactions",
      description:
        "Lists the owner's PERSONAL transactions, most recent first, for 'what did I spend yesterday?' or 'how much did I " +
        "spend on Amazon?'. search is a case-insensitive substring of the description, the original " +
        "imported text or the notes. from/to are inclusive and take either a day (YYYY-MM-DD) or a whole " +
        "month (YYYY-MM) — the two mix, so from a day to a month works. category, account and tag " +
        "accept a name (list_tags lists the tags). minAmount/maxAmount bound the amount, which is " +
        "always positive whatever the type. uncategorized:true finds what still needs filing, " +
        "hasNote:true what carries a note; status narrows to pending, cleared or reconciled. " +
        "`spent` is the expense total over every match, not just the returned page, and leaves out " +
        "rows marked excludeFromReports, as the reports page does. Returns at most `limit` rows " +
        "(default 50, max 200) and always reports `total`, so a truncated answer is visible as one " +
        "— page through the rest with `offset`. Company (SRL) money is never here: it is get_cash_book, " +
        "when the company tools are installed.",
      inputSchema: z.object({
        from: dayOrMonthInput.optional(),
        to: dayOrMonthInput.optional(),
        category: z.string().min(1).optional(),
        account: z.string().min(1).optional(),
        type: z.enum(["income", "expense", "transfer"]).optional(),
        search: z.string().min(1).max(200).optional(),
        minAmount: z.number().min(0).finite().optional(),
        maxAmount: z.number().min(0).finite().optional(),
        uncategorized: z.boolean().optional(),
        tag: z.string().min(1).optional(),
        hasNote: z.boolean().optional(),
        status: z.enum(["pending", "cleared", "reconciled"]).optional(),
        limit: z.number().int().min(1).max(200).optional(),
        offset: z.number().int().min(0).optional(),
      }),
    },
    async (input, ctx) => {
      try {
        const userId = userIdOf(ctx)
        const limit = input.limit ?? 50

        const [categories, accounts, tags] = await Promise.all([
          db().getCategories(userId),
          db().getAccounts(userId),
          db().getTags(userId),
        ])
        if (input.uncategorized && input.category) {
          throw new ToolInputError(
            "`uncategorized` and `category` are mutually exclusive: pick either the uncategorized ones or one category."
          )
        }
        if (
          input.minAmount !== undefined &&
          input.maxAmount !== undefined &&
          input.minAmount > input.maxAmount
        ) {
          throw new ToolInputError(
            `Invalid amount range: minAmount ${input.minAmount} is greater than maxAmount ${input.maxAmount}.`
          )
        }

        const category = input.category ? resolveCategory(categories, input.category) : null
        const account = input.account ? resolveAccount(accounts, input.account) : null
        const tag = input.tag ? resolveTag(tags, input.tag) : null

        if (!input.from && input.to) {
          throw new ToolInputError("`to` needs `from` as well.")
        }
        // Day-aware, unlike the month windows the aggregating tools use: asking for
        // one day must not quietly answer for the whole month around it.
        const window = input.from ? resolveDateWindow({ from: input.from, to: input.to }) : null
        const offset = input.offset ?? 0

        // Every match, not one page: the spend total below has to cover all of them.
        const { data: matches, total } = await db().getTransactions(userId, {
          dateFrom: window?.from,
          dateTo: window?.to,
          categoryId: category?.id,
          accountId: account?.id,
          type: input.type as TransactionType | undefined,
          search: input.search,
          minAmount: input.minAmount,
          maxAmount: input.maxAmount,
          uncategorized: input.uncategorized,
          tagIds: tag ? [tag.id] : undefined,
          hasNote: input.hasNote,
          status: input.status as TransactionStatus | undefined,
        })
        const page = matches.slice(offset, offset + limit)

        const categoryName = new Map(categories.map((c) => [c.id, c.name]))
        const accountById = new Map(accounts.map((a) => [a.id, a.name]))
        const tagById = new Map(tags.map((t) => [t.id, t.name]))

        const rows = page.map((tx) =>
          transactionCard(
            tx,
            (id) => (id ? (categoryName.get(id) ?? null) : null),
            (id) => accountById.get(id) ?? null,
            (id) => tagById.get(id) ?? null
          )
        )
        const spending = matches.filter((t) => t.type === "expense" && !t.excludeFromReports)
        const spent = round2(spending.reduce((s, t) => s + t.amount, 0))
        const spentCurrencies = spending.map((t) => t.currency)

        return ok({
          summary:
            `${total} ${total === 1 ? "transaction" : "transactions"}` +
            (rows.length < total
              ? ` (${offset + 1}–${offset + rows.length})`
              : "") +
            (spent ? `, ${moneyIn(spent, spentCurrencies)} spent.${mixedNote(spentCurrencies)}` : "."),
          spent,
          transactions: rows,
          total,
          returned: rows.length,
          offset,
          // Absent when the page is the last one, so paging stops without a guess.
          nextOffset: offset + rows.length < total ? offset + rows.length : null,
        })
      } catch (e) {
        return toolError(e)
      }
    }
  )

  server.registerTool(
    "get_spending",
    {
      title: "Spending by Category or Month",
      description:
        "PERSONAL spending and income for a month window, grouped by category or by month: 'how much did I " +
        "spend in July?' (from 2026-07) or 'how did the quarter go?' (from 2026-04, to 2026-06). `to` " +
        "defaults to `from`. Same engine as the reports page, so the totals match it exactly; " +
        "transactions excluded from reports are excluded here too. The company's (SRL) month is get_cash_book, " +
        "when the company tools are installed.",
      inputSchema: z.object({
        from: monthInput,
        to: monthInput.optional(),
        groupBy: z.enum(["category", "month"]).optional(),
      }),
    },
    async (input, ctx) => {
      try {
        const { from, to, range } = resolveWindow(input)
        const groupBy = input.groupBy ?? "category"
        const userId = userIdOf(ctx)
        const [report, accounts] = await Promise.all([db().getReportData(userId, range), db().getAccounts(userId)])
        // The report adds amounts without converting. ponytail: the currencies are the accounts' (archived ones
        // included); a Money Manager import stores the file's currency, which can differ. Per-row currency would
        // mean a second read of the window.
        const currencies = accounts.map((a) => a.currency)
        const fmt = (n: number) => moneyIn(n, currencies)

        const rows =
          groupBy === "category"
            ? report.categorySpending.map((c) => ({
                key: c.categoryName,
                categoryId: c.categoryId,
                amount: round2(c.amount),
                percentage: round2(c.percentage),
              }))
            : report.monthlySummary.map((m) => ({
                key: m.month,
                income: round2(m.income),
                expenses: round2(m.expenses),
                net: round2(m.net),
              }))

        const window = from === to ? from : `${from} → ${to}`
        return ok({
          summary: `${window}: ${fmt(report.totalExpenses)} spent, ${fmt(report.totalIncome)} income, net savings ${fmt(report.netSavings)}.${mixedNote(currencies)}`,
          from,
          to,
          groupBy,
          rows,
          totalExpenses: round2(report.totalExpenses),
          totalIncome: round2(report.totalIncome),
          netSavings: round2(report.netSavings),
        })
      } catch (e) {
        return toolError(e)
      }
    }
  )

  server.registerTool(
    "get_budget_status",
    {
      title: "Budget Status",
      description:
        "Every personal budget for the period it is currently in, worst first: spent, remaining, percentage " +
        "used and a status ('danger' once spent reaches the effective amount, or at any spending when that amount is zero or less; 'warning' from 80%). Answers 'am I within budget?' or " +
        "'how much is left for groceries?'. Rollover from previous periods is included, so `remaining` " +
        "is against the effective amount, not the nominal one.",
      inputSchema: z.object({}),
    },
    async (_input, ctx) => {
      try {
        const userId = userIdOf(ctx)
        const now = new Date()
        const budgets = await db().getBudgets(userId)
        // The current period's transactions and the stored totals of the months before.
        const [spending, categories] = await Promise.all([
          loadBudgetsWithSpending(db(), userId, budgets, now),
          db().getCategories(userId),
        ])
        const categoryName = new Map(categories.map((c) => [c.id, c.name]))

        const rows = [...spending]
          .sort(byUrgency)
          .map((b) => ({
            id: b.id,
            name: b.name,
            category: b.categoryId ? (categoryName.get(b.categoryId) ?? null) : null,
            period: b.period,
            periodStart: isoDate(periodStartFor(b, now)),
            amount: b.amount,
            rolloverAmount: round2(b.rolloverAmount),
            effectiveAmount: round2(b.effectiveAmount),
            spent: round2(b.spent),
            remaining: round2(b.remaining),
            percentage: round2(b.percentage),
            status: getBudgetStatus(b),
            currency: b.currency,
          }))

        const over = rows.filter((r) => r.status === "danger")
        return ok({
          summary:
            `${rows.length} ${rows.length === 1 ? "budget" : "budgets"}` +
            (over.length
              ? `, ${over.length} over budget (${over.map((r) => r.name).join(", ")}).`
              : "."),
          budgets: rows,
        })
      } catch (e) {
        return toolError(e)
      }
    }
  )
}
