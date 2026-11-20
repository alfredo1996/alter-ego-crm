import { redirect } from "next/navigation"

import { BudgetsShell } from "../components/budgets/budgets-shell"
import { features } from "../lib/features"

export function BudgetsPage() {
  if (!features.budgets) redirect("/dashboard")
  return <BudgetsShell />
}
