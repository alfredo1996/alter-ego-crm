import { defineModule } from "@alter-ego/kernel/module"

export const rent = defineModule({
  id: "rent",
  label: "Rent",
  summary: "Tenants and yearly leases.",
  requires: ["books"],
  listed: true,
  // The handlers are tools.ts; a test pins the two lists together.
  tools: ["get_rent", "get_tenant", "create_tenant", "update_tenant", "create_lease", "update_lease"],
})
