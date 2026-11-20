import { fireEvent, render, screen, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { AccountList } from "../account-list"

import type { Account } from "../../../types"

const eur = (n: number) => `€${n.toFixed(2)}`

function acct(p: Partial<Account> & Pick<Account, "name" | "type">): Account {
  return {
    id: p.name.toLowerCase().replace(/\W+/g, "-"), userId: "u", currency: "EUR", balance: 100, openingBalance: 0,
    icon: null, color: "#3b82f6", isArchived: false, kind: null, createdAt: new Date(), updatedAt: new Date(), ...p,
  }
}

function renderList(accounts: Account[]) {
  return render(
    <AccountList accounts={accounts} format={eur} defaultCurrency="EUR" onEdit={vi.fn()} onDelete={vi.fn()} onArchive={vi.fn()} />,
  )
}

const tabs = () => within(screen.getByRole("tablist", { name: "Account type" })).getAllByRole("tab").map((t) => t.textContent)

describe("a float residue reads as zero (#314)", () => {
  it("shows €0.00, no minus sign and no You owe pill", () => {
    renderList([acct({ name: "Residue", type: "checking", balance: -2.78e-17 })])
    expect(document.body).toHaveTextContent("€0.00")
    expect(document.body).not.toHaveTextContent("−")
    expect(screen.queryByText("You owe")).toBeNull()
  })
})

describe("AccountList", () => {
  const accounts = [
    acct({ name: "Main Checking", type: "checking", balance: 3683.84 }),
    acct({ name: "Rainy Day Savings", type: "savings" }),
    acct({ name: "Travel Card", type: "credit_card", balance: -511.96 }),
    acct({ name: "Crypto Pot", type: "Crypto Wallet" }),
    acct({ name: "Old Account", type: "cash", balance: 0, isArchived: true }),
  ]

  it("makes tabs from the types present, a custom type under Other, and Archived last", () => {
    renderList(accounts)
    expect(tabs()).toEqual(["All 4", "Bank 2", "Cards 1", "Other 1", "Archived 1"])
    // The custom-type account renders (it used to fall through every group).
    expect(screen.getByRole("link", { name: "Crypto Pot" })).toHaveAttribute("href", "/accounts/crypto-pot")
  })

  it("keeps an archived account out of every tab but its own", () => {
    renderList(accounts)
    expect(screen.queryByText("Old Account")).toBeNull()
    fireEvent.mouseDown(screen.getByRole("tab", { name: /Archived/ }), { button: 0 })
    expect(screen.getByRole("link", { name: "Old Account" })).toBeInTheDocument()
    expect(screen.queryByText("Main Checking")).toBeNull()
    expect(screen.getByText("Archived", { selector: "span" })).toBeInTheDocument()
  })

  it("filters by a type tab", () => {
    renderList(accounts)
    fireEvent.mouseDown(screen.getByRole("tab", { name: /Cards/ }), { button: 0 })
    expect(screen.getAllByRole("link").map((l) => l.textContent)).toEqual(["Travel Card"])
  })

  it("names the account once as text; its Actions button carries the name as a label", () => {
    renderList(accounts)
    expect(screen.getAllByText("Main Checking")).toHaveLength(1)
    expect(screen.getByRole("button", { name: "Actions for Main Checking" })).toBeInTheDocument()
  })

  it("says what is true of the balance: a minus sign and 'You owe', an asset line otherwise", () => {
    renderList(accounts)
    const card = screen.getByRole("article", { name: "Travel Card" })
    expect(card).toHaveTextContent("−€511.96")
    expect(within(card).getByText("You owe")).toBeInTheDocument()
    expect(within(card).getByText("Liability")).toBeInTheDocument()
    expect(within(screen.getByRole("article", { name: "Main Checking" })).getByText("Asset")).toBeInTheDocument()
  })

  it("does not say 'You owe' on an overpaid card, and says 'owed to you' on a lent-out loan", () => {
    renderList([acct({ name: "Paid Card", type: "credit_card", balance: 40 }), acct({ name: "Lent", type: "loan", kind: "asset", balance: 350 })])
    expect(screen.queryByText("You owe")).toBeNull()
    expect(within(screen.getByRole("article", { name: "Paid Card" })).getByText("Liability · owed to you")).toBeInTheDocument()
    expect(within(screen.getByRole("article", { name: "Lent" })).getByText("Asset · owed to you")).toBeInTheDocument()
  })

  it("shows the currency only when it is not the default", () => {
    renderList([acct({ name: "Dollars", type: "cash", currency: "USD" }), acct({ name: "Euros", type: "cash" })])
    expect(within(screen.getByRole("article", { name: "Dollars" })).getByText("USD")).toBeInTheDocument()
    expect(within(screen.getByRole("article", { name: "Euros" })).queryByText("EUR")).toBeNull()
  })

  it("draws the cards first, keeps the line's room, and fills the date in when it lands", () => {
    const list = (lastActivity?: Record<string, Date | null>) => (
      <AccountList accounts={accounts} lastActivity={lastActivity} format={eur} defaultCurrency="EUR" onEdit={vi.fn()} onDelete={vi.fn()} onArchive={vi.fn()} />
    )
    const { rerender } = render(list())
    expect(screen.getByRole("link", { name: "Main Checking" })).toBeInTheDocument()
    expect(screen.queryByText(/Last activity|No activity yet/)).toBeNull()
    const slot = () => screen.getByRole("article", { name: "Main Checking" }).querySelector("span.min-h-5")
    expect(slot()).not.toBeNull()
    rerender(list({ "main-checking": new Date(new Date().getFullYear(), 9, 13), "rainy-day-savings": null }))
    expect(within(screen.getByRole("article", { name: "Main Checking" })).getByText("Last activity 13 Oct")).toBeInTheDocument()
    expect(within(screen.getByRole("article", { name: "Rainy Day Savings" })).getByText("No activity yet")).toBeInTheDocument()
  })

  it("shows the year when the last activity is not this year", () => {
    render(<AccountList accounts={accounts} lastActivity={{ "main-checking": new Date(2024, 9, 13) }} format={eur} defaultCurrency="EUR" onEdit={vi.fn()} onDelete={vi.fn()} onArchive={vi.fn()} />)
    expect(within(screen.getByRole("article", { name: "Main Checking" })).getByText("Last activity 13 Oct 2024")).toBeInTheDocument()
  })

  it("falls back to All when the tab you were on empties out", () => {
    const { rerender } = renderList(accounts)
    fireEvent.mouseDown(screen.getByRole("tab", { name: /Archived/ }), { button: 0 })
    rerender(<AccountList accounts={accounts.map((a) => ({ ...a, isArchived: false }))} format={eur} defaultCurrency="EUR" onEdit={vi.fn()} onDelete={vi.fn()} onArchive={vi.fn()} />)
    expect(screen.getByRole("tab", { name: /All/ })).toHaveAttribute("aria-selected", "true")
  })
})
