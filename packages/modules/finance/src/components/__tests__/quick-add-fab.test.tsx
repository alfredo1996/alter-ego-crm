import { render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

const route = vi.hoisted(() => ({ path: "/dashboard" }))
vi.mock("next/navigation", () => ({ usePathname: () => route.path }))
vi.mock("../transactions/new-transaction-dialog", () => ({ NewTransactionDialog: () => null }))

import { QuickAddFab } from "../quick-add-fab"

afterEach(() => {
  route.path = "/dashboard"
})

describe("QuickAddFab", () => {
  it("sits in the mobile top bar and is gone from md up, where the page's header carries it", () => {
    render(<QuickAddFab />)
    const cls = screen.getByRole("button", { name: "New Transaction" }).className
    expect(cls).toMatch(/top-1\.5 .*h-11/)
    expect(cls).toContain("md:hidden")
    expect(cls).not.toContain("env(safe-area-inset-bottom)")
  })

  it("stays off /transactions, which has its own New Transaction", () => {
    route.path = "/transactions"
    render(<QuickAddFab />)
    expect(screen.queryByRole("button", { name: "New Transaction" })).toBeNull()
  })

  it("still shows on an account's page", () => {
    route.path = "/accounts/a1"
    render(<QuickAddFab />)
    expect(screen.getByRole("button", { name: "New Transaction" })).toBeInTheDocument()
  })
})
