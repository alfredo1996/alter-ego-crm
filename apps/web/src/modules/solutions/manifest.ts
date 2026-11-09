import { defineModule } from "@alter-ego/kernel/module"

export const solutions = defineModule({
  id: "solutions",
  label: "Solutions",
  summary: "The solution catalog and its data model graph.",
  requires: ["crm"],
  listed: true,
  tools: ["list_solutions", "get_solution", "create_solution", "update_solution"],
})
