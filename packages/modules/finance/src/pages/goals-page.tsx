import { redirect } from "next/navigation"

import { SavingsGoalsShell } from "../components/savings-goals/savings-goals-shell"
import { features } from "../lib/features"

export function GoalsPage() {
  if (!features.savingsGoals) redirect("/dashboard")
  return <SavingsGoalsShell />
}
