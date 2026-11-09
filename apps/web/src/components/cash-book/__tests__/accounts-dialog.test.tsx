import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { AccountsDialog } from "../accounts-dialog"

import type { CompanyAccount } from "@/types"

vi.mock("@/lib/backend", () => ({ getBackend: () => ({ db: {} }) }))

const stamp = { userId: "u1", createdAt: new Date(2026, 0, 1), updatedAt: new Date(2026, 0, 1) }
const account = (id: string, name: string): CompanyAccount => ({
  id, name, openingBalance: 1000, openingDate: new Date(2026, 0, 1), statementBalance: null, statementDate: null, importRef: null, ...stamp,
})

const scrollIntoView = Element.prototype.scrollIntoView
afterEach(() => {
  Element.prototype.scrollIntoView = scrollIntoView
})

describe("AccountsDialog", () => {
  it("brings the Edit form into view once, not again on every render, and Cancel leaves the list in place", async () => {
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AccountsDialog userId="u1" open onOpenChange={vi.fn()} accounts={[account("a1", "Main Bank"), account("a2", "Cash Box")]} inUse={() => false} />
      </QueryClientProvider>,
    )
    // Adding scrolls nowhere: the form is already where you look.
    expect(scroll).not.toHaveBeenCalled()
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0])
    expect(screen.getByRole("heading", { name: "Edit Main Bank" })).toBeInTheDocument()
    expect(scroll).toHaveBeenCalledTimes(1)
    // A re-render (Delete's confirm opening) left the dialog where the owner had scrolled it.
    const remove = screen.getByRole("button", { name: "Delete Cash Box" })
    fireEvent.click(remove)
    expect(scroll).toHaveBeenCalledTimes(1)
    // Cancel hands focus back to that Delete, up in the list, not to the form's first field below.
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
    await waitFor(() => expect(document.activeElement).toBe(remove))
  })
})
