/**
 * The navigation table — the single source of truth for both what the sidebar
 * renders and which routes are reachable.
 *
 * Keeping these together is deliberate: a plugin switched off that only hides
 * links leaves the route reachable by typing the URL. `isRouteEnabled` reads the
 * same table the nav does, so what a deployment leaves out can never disagree
 * with what the guard enforces.
 */

import { FINANCE_NAV } from "@alter-ego/finance/nav"
import {
  BookOpen,
  CalendarCheck,
  CalendarClock,
  CalendarRange,
  FileSignature,
  FileText,
  House,
  Library,
  Receipt,
  Settings,
  SquareKanban,
  Target,
  UserRound,
  Users,
} from "lucide-react"

import { isModuleOn, type ModuleId } from "@/modules"

import type { LucideIcon } from "lucide-react"

export interface NavItem {
  label: string
  href: string
  icon: LucideIcon
}

export interface NavGroup {
  label: string
  /** The plugin this group is: switched off, its links and routes are gone. */
  module?: ModuleId
  items: NavItem[]
}

export const NAV_GROUPS: NavGroup[] = [
  // Personal Finance leads, so `/` opens its Dashboard when it is on (homeRoute reads the first visible group).
  { ...FINANCE_NAV, module: "finance" },
  {
    label: "Consulting",
    module: "consulting",
    items: [
      { label: "Pipeline", href: "/pipeline", icon: Target },
      { label: "Clients", href: "/clients", icon: Users },
      { label: "Contracts", href: "/contracts", icon: FileSignature },
      { label: "Collaborators", href: "/collaborators", icon: UserRound },
      { label: "Solutions", href: "/solutions", icon: Library },
      { label: "Tasks", href: "/tasks", icon: SquareKanban },
      { label: "Plan", href: "/plan", icon: CalendarRange },
      { label: "Deadlines", href: "/deadlines", icon: CalendarClock },
    ],
  },
  {
    label: "Accounting",
    module: "accounting",
    items: [
      { label: "Invoices", href: "/invoices", icon: FileText },
      { label: "Cash Book", href: "/cash-book", icon: BookOpen },
      { label: "Costs", href: "/costs", icon: Receipt },
      { label: "Month End", href: "/month-end", icon: CalendarCheck },
    ],
  },
  { label: "Rent", module: "rent", items: [{ label: "Rent", href: "/rent", icon: House }] },
]

/** The item's own page or one under it (a client's page lights Clients). */
export function isOnRoute(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href + "/")
}

function isGroupEnabled(group: NavGroup): boolean {
  return !group.module || isModuleOn(group.module)
}

/**
 * Pinned below the groups rather than inside one. Both the sidebar and the
 * mobile sheet render it: for a while only the sidebar did, which left the
 * settings page unreachable from a phone.
 */
export const BOTTOM_ITEMS: NavItem[] = [{ label: "Settings", href: "/settings", icon: Settings }]

/** Nav groups to render: the plugins that are on. */
export function visibleNavGroups(): NavGroup[] {
  return NAV_GROUPS.filter(isGroupEnabled)
}

/** The label of the visible group that holds this page, or null (Settings, an unknown route). */
export function groupOf(pathname: string): string | null {
  return visibleNavGroups().find((g) => g.items.some((i) => isOnRoute(pathname, i.href)))?.label ?? null
}

/**
 * Whether a route may be opened. Routes the nav doesn't declare are allowed through
 * so Next's own 404 handles them — this gates the nav table, not the whole router.
 */
export function isRouteEnabled(pathname: string): boolean {
  for (const group of NAV_GROUPS) {
    if (group.items.some((item) => isOnRoute(pathname, item.href))) return isGroupEnabled(group)
  }

  return true
}

/**
 * First route the deployment can actually open — the redirect target for a
 * blocked route and for `/`. Derived from the table rather than hardcoded, so it
 * follows the nav as pages are added and removed.
 */
export function homeRoute(): string {
  return visibleNavGroups()[0]?.items[0]?.href ?? "/settings"
}
