import { fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { visibleNavGroups } from "@/lib/nav"

const route = vi.hoisted(() => ({ path: "/settings" }))
vi.mock("next/navigation", () => ({ usePathname: () => route.path }))
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    user: { id: "u1", email: "marta@nordwind.example", displayName: "Marta Keller", photoURL: null },
    loading: false,
    signOut: vi.fn(),
  }),
}))

import { AppSidebar } from "../app-sidebar"
import { MobileNav } from "../mobile-nav"

// Whatever the deployment shows first (Pipeline unless a module is switched off).
const first = visibleNavGroups()[0].items[0]
const scroller = (el: HTMLElement) => el.closest(".overflow-y-auto")

afterEach(() => {
  route.path = "/settings"
})

describe("the sidebar", () => {
  it("pins Settings and the user below the links that scroll", () => {
    render(<AppSidebar />)
    const nav = screen.getByRole("navigation", { name: "Main" })
    const links = scroller(within(nav).getByRole("link", { name: first.label }))!
    expect(links).not.toBeNull()
    expect(links).not.toContainElement(within(nav).getByRole("link", { name: "Settings" }))
    expect(links).not.toContainElement(screen.getByRole("button", { name: /Marta Keller/ }))
  })

  it("labels each group and marks the current page, a nested route too", () => {
    render(<AppSidebar />)
    for (const group of visibleNavGroups()) expect(screen.getByText(group.label)).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute("aria-current", "page")
    expect(screen.getByRole("link", { name: first.label })).not.toHaveAttribute("aria-current")
  })

  it("marks the section of a detail page", () => {
    route.path = `${first.href}/a1`
    render(<AppSidebar />)
    expect(screen.getByRole("link", { name: first.label })).toHaveAttribute("aria-current", "page")
  })

  it("keeps every link named when collapsed to icons", () => {
    render(<AppSidebar />)
    fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }))
    expect(screen.getByRole("link", { name: first.label })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Settings" })).toBeInTheDocument()
    expect(screen.getByText("Alter Ego")).toHaveClass("sr-only")
    expect(screen.getByRole("button", { name: "Expand sidebar" })).toBeInTheDocument()
    // The user menu keeps its name, not just the initials on the avatar.
    expect(screen.getByRole("button", { name: /Marta Keller/ })).toBeInTheDocument()
  })

  it("leaves room above the first link for its focus ring, which the scroller would clip", () => {
    render(<AppSidebar />)
    fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }))
    expect(scroller(screen.getByRole("link", { name: first.label }))).toHaveClass("pt-0.5")
  })
})

describe("the phone's top bar and nav sheet", () => {
  it("shows the brand, and keeps Settings and Sign out on screen below the links", () => {
    render(<MobileNav />)
    expect(screen.getByText("Alter Ego")).not.toHaveClass("sr-only")
    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }))
    const sheet = screen.getByRole("dialog", { name: "Alter Ego" })
    const links = scroller(within(sheet).getByRole("link", { name: first.label }))!
    expect(links).not.toBeNull()
    expect(links).not.toContainElement(within(sheet).getByRole("link", { name: "Settings" }))
    expect(links).not.toContainElement(within(sheet).getByRole("button", { name: "Sign out" }))
    expect(within(sheet).getByRole("link", { name: "Settings" })).toHaveAttribute("aria-current", "page")
  })
})
