"use client"

import { BrandMark } from "@alter-ego/ui/page/brand-mark"
import { Avatar, AvatarFallback, AvatarImage } from "@alter-ego/ui/ui/avatar"
import { Button } from "@alter-ego/ui/ui/button"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@alter-ego/ui/ui/sheet"
import { Menu, LogOut } from "lucide-react"
import { usePathname } from "next/navigation"
import { useState } from "react"

import { NAV_GROUP_LABEL, NavLink, getInitials, useNavGroups } from "@/components/app-sidebar"
import { useAuth } from "@/hooks/use-auth"
import { BOTTOM_ITEMS, isOnRoute } from "@/lib/nav"

export function MobileNav() {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()
  const { user, loading, signOut } = useAuth()
  const navGroups = useNavGroups()
  const close = () => setOpen(false)

  return (
    <div className="sticky top-0 z-40 flex h-14 items-center gap-1 border-b bg-background px-1.5 md:hidden">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon-lg">
            <Menu className="size-5" />
            <span className="sr-only">Open navigation</span>
          </Button>
        </SheetTrigger>
        {/* A column: the links scroll between a fixed header and footer, so Settings and
            Sign out stay on screen however long the nav gets (a 667 px phone). */}
        <SheetContent side="left" className="flex w-[280px] flex-col gap-0 bg-sidebar p-0">
          <SheetHeader className="flex h-14 shrink-0 flex-row items-center space-y-0 px-5 text-left">
            <SheetTitle>
              <BrandMark withName />
            </SheetTitle>
          </SheetHeader>

          <nav aria-label="Main" className="flex min-h-0 flex-1 flex-col">
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-3 pb-3">
              {navGroups.map((group) => (
                <div key={group.label} className="flex flex-col gap-1">
                  <p className={NAV_GROUP_LABEL}>{group.label}</p>
                  {group.items.map((item) => (
                    <NavLink key={item.href} item={item} active={isOnRoute(pathname, item.href)} onClick={close} />
                  ))}
                </div>
              ))}
            </div>
            {/* Settings is pinned, same as the sidebar: without it the page has no route in from a phone. */}
            <div className="flex shrink-0 flex-col gap-1 border-t border-sidebar-border px-3 pt-3">
              {BOTTOM_ITEMS.map((item) => (
                <NavLink key={item.href} item={item} active={pathname === item.href} onClick={close} />
              ))}
            </div>
          </nav>

          {!loading && user && (
            <div className="flex shrink-0 flex-col gap-1 px-3 pt-1 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
              <div className="flex items-center gap-3 px-2 py-1.5">
                <Avatar className="h-8 w-8">
                  <AvatarImage
                    src={user.photoURL ?? undefined}
                    alt={user.displayName ?? "User"}
                  />
                  <AvatarFallback className="text-xs font-semibold text-subtle-foreground">
                    {getInitials(user.displayName)}
                  </AvatarFallback>
                </Avatar>
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-medium text-sidebar-foreground">
                    {user.displayName ?? "User"}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {user.email}
                  </span>
                </div>
              </div>
              <Button
                variant="ghost"
                className="w-full justify-start gap-3 px-2 font-normal text-subtle-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                onClick={() => {
                  signOut()
                  close()
                }}
              >
                <LogOut className="h-4 w-4" />
                Sign out
              </Button>
            </div>
          )}
        </SheetContent>
      </Sheet>

      <BrandMark withName className="flex-1" />
    </div>
  )
}
