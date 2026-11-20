import { defineModule } from "@alter-ego/kernel/module"

export const consulting = defineModule({
  id: "consulting",
  label: "Consulting",
  summary: "Pipeline, clients and contracts, collaborators, tasks, the Plan, deadlines and the solution catalog.",
  requires: [],
  tools: [
    "list_clients", "get_client", "get_pipeline", "get_revenue", "list_deadlines", "get_plan", "get_quarters", "get_capacity",
    "list_tasks", "list_time", "get_hours_left", "list_meetings", "log_allocation", "move_opportunity", "create_opportunity", "create_client",
    "block_capacity", "convert_to_engagement", "create_contract", "update_engagement", "amend_contract", "add_note", "add_task",
    "complete_task", "update_task", "delete_task", "add_deadline", "complete_deadline", "schedule_follow_up", "log_time",
    "log_meeting", "update_meeting", "add_collaborator", "update_collaborator", "assign_collaborator", "unassign_collaborator",
    "list_solutions", "get_solution", "create_solution", "update_solution", "log_work",
  ],
})
