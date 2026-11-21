import { defineModule } from "@alter-ego/kernel/module"

export const finance = defineModule({
  id: "finance",
  label: "Personal Finance",
  summary: "Accounts, transactions, budgets, goals, recurring payments and reports, apart from the company's books.",
  // Finance stands alone: it reads nothing of the company's, and nothing of the company's reads it.
  requires: [],
  // The handlers are in @alter-ego/finance/mcp; the registry test pins the two lists together.
  tools: [
    "list_categories", "list_accounts", "list_tags", "list_transactions", "get_spending", "get_budget_status",
    "add_transaction", "update_transaction", "delete_transaction", "create_account", "archive_account",
  ],
})
