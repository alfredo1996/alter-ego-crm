import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

vi.mock("@/components/auth/auth-guard", () => ({ AuthGuard: ({ children }: { children: React.ReactNode }) => children }))
vi.mock("@/components/route-guard", () => ({ RouteGuard: ({ children }: { children: React.ReactNode }) => children }))
vi.mock("@/components/app-sidebar", () => ({ AppSidebar: () => <nav aria-label="Main" /> }))
vi.mock("@/components/mobile-nav", () => ({ MobileNav: () => <header aria-label="Mobile" /> }))
const nav = vi.hoisted(() => ({ search: "" }))
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(nav.search) }))

import AppLayout from "../layout"

describe("app layout", () => {
  it("shows the sidebar and the phone's bar", () => {
    nav.search = ""
    render(<AppLayout>page</AppLayout>)
    expect(screen.getByRole("navigation", { name: "Main" })).toBeInTheDocument()
    expect(screen.getByLabelText("Mobile")).toBeInTheDocument()
  })

  it("hides both while ?present=1, and keeps the page", () => {
    nav.search = "?present=1"
    render(<AppLayout>page</AppLayout>)
    expect(screen.queryByRole("navigation", { name: "Main" })).not.toBeInTheDocument()
    expect(screen.queryByLabelText("Mobile")).not.toBeInTheDocument()
    expect(screen.getByText("page")).toBeInTheDocument()
  })

  it("puts every page in one centred column, 1120px at most", () => {
    nav.search = ""
    render(<AppLayout>page</AppLayout>)
    expect(screen.getByText("page")).toHaveClass("mx-auto", "w-full", "max-w-[1120px]")
  })

  it("leaves no bottom padding for a floating button: the app has none", () => {
    render(<AppLayout>page</AppLayout>)
    expect(screen.getByRole("main").className).not.toMatch(/pb-24/)
  })
})
