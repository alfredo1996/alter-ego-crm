"use client"

import { BrandMark } from "@alter-ego/ui/page/brand-mark"
import { Avatar, AvatarFallback, AvatarImage } from "@alter-ego/ui/ui/avatar"
import { Button } from "@alter-ego/ui/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@alter-ego/ui/ui/dropdown-menu"
import { Skeleton } from "@alter-ego/ui/ui/skeleton"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@alter-ego/ui/ui/tooltip"
import { cn } from "@alter-ego/ui/utils"
import {
  Settings,
  ChevronsLeft,
  ChevronsRight,
  LogOut,
} from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { forwardRef, useState } from "react"

import { useAuth } from "@/hooks/use-auth"
import { visibleNavGroups, BOTTOM_ITEMS, isOnRoute, type NavGroup, type NavItem } from "@/lib/nav"

import type { ComponentPropsWithoutRef } from "react"

export function useNavGroups(): NavGroup[] {
  return visibleNavGroups()
}

export function getInitials(name: string | null): string {
  if (!name) return "?"
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .toUpperCase()
    .slice(0, 2)
}

// Shared with the phone's nav sheet. Group labels are 11px eyebrows, spaced rather than ruled off.
export const NAV_GROUP_LABEL =
  "px-2 pt-2 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground"

interface NavLinkProps extends Omit<ComponentPropsWithoutRef<typeof Link>, "href"> {
  item: NavItem
  active: boolean
  collapsed?: boolean
}

/** A nav link: 36px (44 on touch), the current page in medium weight on the accent. */
export const NavLink = forwardRef<HTMLAnchorElement, NavLinkProps>(
  ({ item, active, collapsed = false, className, ...props }, ref) => {
    const Icon = item.icon
    return (
      <Link
        ref={ref}
        href={item.href}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex h-9 items-center gap-3 rounded-lg px-2 text-sm text-subtle-foreground transition-colors motion-reduce:transition-none pointer-coarse:min-h-11",
          "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          active && "bg-sidebar-accent font-medium text-sidebar-accent-foreground",
          collapsed && "justify-center px-0",
          className,
        )}
        {...props}
      >
        <Icon aria-hidden className="size-4 shrink-0" />
        {/* Collapsed, the name moves to a tooltip on screen and stays the link's name. */}
        <span className={cn(collapsed && "sr-only")}>{item.label}</span>
      </Link>
    )
  },
)
NavLink.displayName = "NavLink"

export function AppSidebar() {
  const [collapsed, setCollapsed] = useState(false)
  const pathname = usePathname()
  const { user, loading, signOut } = useAuth()
  const navGroups = useNavGroups()

  const link = (item: NavItem, active: boolean) =>
    collapsed ? (
      <Tooltip key={item.href}>
        <TooltipTrigger asChild>
          <NavLink item={item} active={active} collapsed />
        </TooltipTrigger>
        <TooltipContent side="right">{item.label}</TooltipContent>
      </Tooltip>
    ) : (
      <NavLink key={item.href} item={item} active={active} />
    )

  return (
    <TooltipProvider delayDuration={0}>
      <aside
        className={cn(
          "sticky top-0 hidden h-screen flex-col border-r border-sidebar-border bg-sidebar md:flex",
          "transition-[width] duration-300 motion-reduce:transition-none",
          collapsed ? "w-[60px]" : "w-[240px]"
        )}
      >
        <div className={cn("flex shrink-0 items-center pt-6 pb-6", collapsed ? "justify-center" : "px-5")}>
          <BrandMark withName={!collapsed} />
        </div>

        {/* The links scroll; Settings and the user stay pinned below them, so a short
            screen never pushes them out of sight. */}
        <nav aria-label="Main" className="flex min-h-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-3 pt-0.5 pb-3">
            {navGroups.map((group) => (
              <div key={group.label} className="flex flex-col gap-1">
                {!collapsed && <p className={NAV_GROUP_LABEL}>{group.label}</p>}
                {group.items.map((item) => link(item, isOnRoute(pathname, item.href)))}
              </div>
            ))}
          </div>
          <div className="flex shrink-0 flex-col gap-1 border-t border-sidebar-border px-3 pt-3">
            {BOTTOM_ITEMS.map((item) => link(item, pathname === item.href))}
          </div>
        </nav>

        <div className="flex shrink-0 flex-col gap-1 px-3 pt-1 pb-3">
          {/* The user menu, with the collapse toggle beside it (under it when collapsed). */}
          <div className={cn("flex items-center gap-1", collapsed && "flex-col")}>
            {loading ? (
              <div className="flex min-w-0 flex-1 items-center gap-3 px-2 py-1.5">
                <Skeleton className="h-8 w-8 rounded-full" />
                {!collapsed && <Skeleton className="h-4 w-24" />}
              </div>
            ) : user ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className={cn(
                      "flex min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-1.5 text-left text-sm text-sidebar-foreground transition-colors motion-reduce:transition-none",
                      "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      collapsed && "w-9 flex-none justify-center px-0"
                    )}
                  >
                    <Avatar className="h-8 w-8">
                      <AvatarImage
                        src={user.photoURL ?? undefined}
                        alt={user.displayName ?? "User"}
                      />
                      <AvatarFallback className="text-xs font-semibold text-subtle-foreground">
                        {getInitials(user.displayName)}
                      </AvatarFallback>
                    </Avatar>
                    {/* Collapsed, the name stays the button's name for a screen reader, as on NavLink. */}
                    <span className={cn("flex min-w-0 flex-col", collapsed && "sr-only")}>
                      <span className="truncate font-medium">
                        {user.displayName ?? user.email}
                      </span>
                      {user.displayName && (
                        <span className="truncate text-xs text-muted-foreground">{user.email}</span>
                      )}
                    </span>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent side="top" align="start" className="w-56">
                  <DropdownMenuLabel className="font-normal">
                    <div className="flex flex-col space-y-1">
                      <p className="text-sm font-medium">
                        {user.displayName ?? "User"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {user.email}
                      </p>
                    </div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <Link href="/settings">
                      <Settings className="h-4 w-4" />
                      Settings
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => signOut()}>
                    <LogOut className="h-4 w-4" />
                    Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="shrink-0 text-subtle-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                  onClick={() => setCollapsed((prev) => !prev)}
                >
                  {collapsed ? (
                    <ChevronsRight className="h-4 w-4" />
                  ) : (
                    <ChevronsLeft className="h-4 w-4" />
                  )}
                  <span className="sr-only">
                    {collapsed ? "Expand sidebar" : "Collapse sidebar"}
                  </span>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">
                {collapsed ? "Expand" : "Collapse"}
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
      </aside>

    </TooltipProvider>
  )
}
