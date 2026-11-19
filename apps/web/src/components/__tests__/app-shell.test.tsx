import { fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { visibleNavGroups } from "@/lib/nav"

const route = vi.hoisted(() => ({ path: "/settings", oneGroup: false }))
// groupOf reads the real table; only what the components render is cut to one group.
vi.mock("@/lib/nav", async (importOriginal) => {
  const nav = await importOriginal<typeof Nav>()
  return { ...nav, visibleNavGroups: () => (route.oneGroup ? nav.visibleNavGroups().slice(0, 1) : nav.visibleNavGroups()) }
})
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

import type * as Nav from "@/lib/nav"

// Whatever the deployment shows first (Pipeline unless a module is switched off).
const first = visibleNavGroups()[0].items[0]
// Group names and pages come from the table, so the suite holds with a module switched off.
const [g1, g2] = visibleNavGroups()
const [a1, a2] = [g1.items[0], g1.items.at(-1)!]
const [b1, b2] = g2 ? [g2.items[0], g2.items.at(-1)!] : [a1, a2]
const itTwo = it.skipIf(!g2)
const scroller = (el: HTMLElement) => el.closest(".overflow-y-auto")

afterEach(() => {
  route.path = "/settings"
  route.oneGroup = false
})

const heading = (name: string) => screen.getByRole("button", { name })
const has = (name: string) => screen.queryByRole("link", { name }) !== null

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

describe.each([
  ["the sidebar", () => <AppSidebar />, () => {}],
  [
    "the phone's nav sheet",
    () => <MobileNav />,
    () => fireEvent.click(screen.getByRole("button", { name: "Open navigation" })),
  ],
])("the groups of %s", (_name, ui, open) => {
  const show = () => {
    const view = render(ui())
    open()
    return view
  }

  itTwo("opens only the group of the current page, the other one a closed heading", () => {
    route.path = `${a1.href}/abc`
    show()
    expect(heading(g1.label)).toHaveAttribute("aria-expanded", "true")
    expect(heading(g2.label)).toHaveAttribute("aria-expanded", "false")
    expect([has(a1.label), has(a2.label), has(b1.label), has(b2.label)]).toEqual([true, true, false, false])
  })

  itTwo("opens a heading in place and closes the group that was open", () => {
    route.path = a1.href
    show()
    fireEvent.click(heading(g2.label))
    expect(heading(g2.label)).toHaveAttribute("aria-expanded", "true")
    expect(heading(g1.label)).toHaveAttribute("aria-expanded", "false")
    expect([has(b1.label), has(b2.label), has(a1.label)]).toEqual([true, true, false])
  })

  itTwo("closes the open group when its own heading is pressed", () => {
    route.path = a1.href
    show()
    fireEvent.click(heading(g1.label))
    expect([heading(g1.label), heading(g2.label)].map((b) => b.getAttribute("aria-expanded"))).toEqual(["false", "false"])
  })

  itTwo("goes back to the page's group when the page changes", () => {
    route.path = a1.href
    const { rerender } = show()
    fireEvent.click(heading(g2.label))
    route.path = a2.href
    rerender(ui())
    expect(heading(g1.label)).toHaveAttribute("aria-expanded", "true")
    route.path = b1.href
    rerender(ui())
    expect(heading(g2.label)).toHaveAttribute("aria-expanded", "true")
  })

  itTwo("reopens the page's own group when you come back to the page where a heading was pressed", () => {
    route.path = a1.href
    const { rerender } = show()
    fireEvent.click(heading(g2.label))
    route.path = b1.href
    rerender(ui())
    route.path = a1.href
    rerender(ui())
    expect([heading(g1.label), heading(g2.label)].map((b) => b.getAttribute("aria-expanded"))).toEqual(["true", "false"])
  })

  itTwo("keeps the group you came from open on Settings, and the first one on a fresh load", () => {
    route.path = b1.href
    const { rerender, unmount } = show()
    route.path = "/settings"
    rerender(ui())
    expect(heading(g2.label)).toHaveAttribute("aria-expanded", "true")
    unmount()
    show()
    expect(heading(g1.label)).toHaveAttribute("aria-expanded", "true")
  })

  it("leaves the plain label and no button when one group is left", () => {
    route.oneGroup = true
    show()
    expect(screen.getByText(g1.label)).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: g1.label })).toBeNull()
    expect(has(a1.label)).toBe(true)
  })
})

describe("the group headings by device", () => {
  itTwo("show every link, with no heading, when the sidebar is collapsed to icons", () => {
    route.path = a1.href
    render(<AppSidebar />)
    fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }))
    expect([has(a1.label), has(b1.label)]).toEqual([true, true])
    expect(screen.queryByRole("button", { name: g2.label })).toBeNull()
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
