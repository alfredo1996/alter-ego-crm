import { defineModule } from "@alter-ego/kernel/module"

export const crm = defineModule({
  id: "crm",
  label: "CRM",
  summary: "Pipeline, clients and contracts, collaborators, tasks, the Plan and deadlines.",
  requires: [],
  listed: true,
  tools: [
    "list_clients", "get_client", "get_pipeline", "get_revenue", "list_deadlines", "get_plan", "get_quarters", "get_capacity",
    "list_tasks", "list_time", "list_meetings", "log_allocation", "move_opportunity", "create_opportunity", "create_client",
    "block_capacity", "convert_to_engagement", "create_contract", "update_engagement", "amend_contract", "add_note", "add_task",
    "complete_task", "update_task", "delete_task", "add_deadline", "complete_deadline", "schedule_follow_up", "log_time",
    "log_meeting", "update_meeting", "add_collaborator", "update_collaborator", "assign_collaborator", "unassign_collaborator",
  ],
})
