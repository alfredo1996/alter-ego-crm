import { defineModule } from "@alter-ego/kernel/module"

export const books = defineModule({
  id: "books",
  label: "Books",
  summary: "Cash book, costs, the runway and Month End.",
  requires: [],
  listed: true,
  tools: [
    "get_cash_book", "get_month_end", "add_movement", "add_expense", "record_loan", "check_balance", "update_movement",
    "delete_movement", "update_expense", "delete_expense", "update_loan", "delete_loan",
  ],
})
