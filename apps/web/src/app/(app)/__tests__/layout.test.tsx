import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

vi.mock("@/components/auth/auth-guard", () => ({ AuthGuard: ({ children }: { children: React.ReactNode }) => children }))
vi.mock("@/components/route-guard", () => ({ RouteGuard: ({ children }: { children: React.ReactNode }) => children }))
vi.mock("@/components/app-sidebar", () => ({ AppSidebar: () => null }))
vi.mock("@/components/mobile-nav", () => ({ MobileNav: () => null }))

import AppLayout from "../layout"

describe("app layout", () => {
  it("puts every page in one centred column, 1120px at most", () => {
    render(<AppLayout>page</AppLayout>)
    expect(screen.getByText("page")).toHaveClass("mx-auto", "w-full", "max-w-[1120px]")
  })

  it("leaves no bottom padding for a floating button: the app has none", () => {
    render(<AppLayout>page</AppLayout>)
    expect(screen.getByRole("main").className).not.toMatch(/pb-24/)
  })
})
