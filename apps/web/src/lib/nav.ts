/**
 * The navigation table — the single source of truth for both what the sidebar
 * renders and which routes are reachable.
 *
 * Keeping these together is deliberate: a module switched off that only hides
 * links leaves the route reachable by typing the URL. `isRouteEnabled` reads the
 * same table the nav does, so what a deployment switches off can never disagree
 * with what the guard enforces.
 */

import {
  BookOpen,
  CalendarCheck,
  CalendarClock,
  CalendarRange,
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
  /** The module whose page this is: switched off, the link and the route are gone. */
  module?: ModuleId
}

export interface NavGroup {
  label: string
  items: NavItem[]
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: "Company",
    items: [
      { label: "Pipeline", href: "/pipeline", icon: Target, module: "crm" },
      { label: "Clients", href: "/clients", icon: Users, module: "crm" },
      { label: "Collaborators", href: "/collaborators", icon: UserRound, module: "crm" },
      { label: "Solutions", href: "/solutions", icon: Library, module: "solutions" },
      { label: "Invoices", href: "/invoices", icon: FileText, module: "invoicing" },
      { label: "Cash Book", href: "/cash-book", icon: BookOpen, module: "books" },
      { label: "Rent", href: "/rent", icon: House, module: "rent" },
      { label: "Month End", href: "/month-end", icon: CalendarCheck, module: "books" },
      { label: "Tasks", href: "/tasks", icon: SquareKanban, module: "crm" },
      { label: "Plan", href: "/plan", icon: CalendarRange, module: "crm" },
      { label: "Deadlines", href: "/deadlines", icon: CalendarClock, module: "crm" },
      { label: "Costs", href: "/costs", icon: Receipt, module: "books" },
    ],
  },
]

/** The item's own page or one under it (a client's page lights Clients). */
export function isOnRoute(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href + "/")
}

function isItemEnabled(item: NavItem): boolean {
  return !item.module || isModuleOn(item.module)
}

/**
 * Pinned below the groups rather than inside one. Both the sidebar and the
 * mobile sheet render it: for a while only the sidebar did, which left the
 * settings page unreachable from a phone.
 */
export const BOTTOM_ITEMS: NavItem[] = [{ label: "Settings", href: "/settings", icon: Settings }]

/** Nav groups to render, with the items of a module switched off and empty groups dropped. */
export function visibleNavGroups(): NavGroup[] {
  return NAV_GROUPS.map((group) => ({ ...group, items: group.items.filter(isItemEnabled) })).filter(
    (group) => group.items.length > 0,
  )
}

/**
 * Whether a route may be opened. Routes the nav doesn't declare are allowed through
 * so Next's own 404 handles them — this gates the nav table, not the whole router.
 */
export function isRouteEnabled(pathname: string): boolean {
  for (const group of NAV_GROUPS) {
    for (const item of group.items) {
      if (!isOnRoute(pathname, item.href)) continue
      return isItemEnabled(item)
    }
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
