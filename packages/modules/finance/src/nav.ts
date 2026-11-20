import {
  LayoutDashboard,
  Wallet,
  ArrowLeftRight,
  Tags,
  BarChart3,
  PiggyBank,
  CalendarClock,
  Target,
} from "lucide-react"

import type { LucideIcon } from "lucide-react"

export interface FinanceNavItem {
  label: string
  href: string
  icon: LucideIcon
}

export interface FinanceNavGroup {
  label: string
  items: FinanceNavItem[]
}

/** Finance's sidebar group. The host decides which groups show and gates routes by the same table. */
export const FINANCE_NAV: FinanceNavGroup = {
  label: "Personal Finance",
  items: [
    { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
    { label: "Accounts", href: "/accounts", icon: Wallet },
    { label: "Transactions", href: "/transactions", icon: ArrowLeftRight },
    { label: "Categories", href: "/categories", icon: Tags },
    { label: "Budgets", href: "/budgets", icon: PiggyBank },
    { label: "Goals", href: "/goals", icon: Target },
    { label: "Recurring", href: "/recurring", icon: CalendarClock },
    { label: "Reports", href: "/reports", icon: BarChart3 },
  ],
}
