import { defineModule } from "@alter-ego/kernel/module"

export const accounting = defineModule({
  id: "accounting",
  label: "Accounting",
  summary: "Invoices and their files, the cash book, costs, the runway and Month End.",
  // ponytail: Accounting needs Consulting because an invoice cannot be saved without a client. The
  // milestone "Standalone Accounting" lifts it; until then a deployment lists both.
  requires: ["consulting"],
  tools: [
    "get_cash_book", "get_month_end", "add_movement", "add_expense", "record_loan", "check_balance", "update_movement",
    "delete_movement", "update_expense", "delete_expense", "update_loan", "delete_loan",
    "list_invoices", "get_unbilled", "create_invoice", "mark_invoice_paid", "update_invoice", "delete_invoice", "attach_file", "create_upload_url", "complete_upload", "remove_file", "get_file",
  ],
})
