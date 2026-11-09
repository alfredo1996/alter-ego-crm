import { defineModule } from "@alter-ego/kernel/module"

export const invoicing = defineModule({
  id: "invoicing",
  label: "Invoicing",
  summary: "Invoices and credit notes, unbilled hours, invoice files.",
  requires: ["crm"],
  listed: true,
  tools: ["list_invoices", "get_unbilled", "create_invoice", "mark_invoice_paid", "update_invoice", "delete_invoice", "attach_file", "remove_file", "get_file"],
})
