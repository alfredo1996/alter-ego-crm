/**
 * The contract dialogs (Edit, Amend, Delete; useContractActions, on a client's page, whose contract
 * cards open them) decide on the hours and the invoices, which chat may have just written:
 * each click fetches them anew, past a cached copy, and opens its dialog only then.
 * Meanwhile the button says it is busy; a failed fetch says so in the card; and only the
 * last click opens anything. Amend Contract is a button on the card, Edit and Delete sit
 * behind its More menu.
 */
import { isoDate } from "@alter-ego/kernel/dates"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { addMonths, format } from "date-fns"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ClientPage } from "@/components/crm/client-page"

const reads = vi.hoisted(() => ({
  calls: {} as Record<string, number>,
  /** The arguments of each method's last call. */
  args: {} as Record<string, unknown[]>,
  /** getTimecards answers after the page's own read: each call takes the next, "hold" waits for release(). */
  timecards: [] as ("ok" | "fail" | "hold")[],
  held: [] as (() => void)[],
}))
beforeEach(() => {
  reads.calls = {}
  reads.args = {}
  reads.timecards = []
  reads.held = []
})

const now = new Date()
const DATA: Record<string, unknown> = {
  getClients: [
    {
      id: "c1", userId: "u1", name: "Lumon", vatNumber: null, email: null, contactName: null,
      contactPhone: null, notes: null, isActive: true, createdAt: now, updatedAt: now,
    },
  ],
  getEngagements: [
    {
      id: "e1", userId: "u1", clientId: "c1", name: "Migration", opportunityId: null, dailyRate: 700,
      vatApplicable: false, contractedDays: 80, defaultDaysPerMonth: 10, startMonth: null,
      endMonth: null, endDate: null, isActive: true, notes: null, createdAt: now, updatedAt: now,
    },
  ],
}

vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { id: "u1" } }) }))
vi.mock("@/lib/backend", () => ({
  getBackend: () => ({
    db: new Proxy(
      {},
      {
        get: (_db, method) => (...args: unknown[]) => {
          const name = String(method)
          reads.calls[name] = (reads.calls[name] ?? 0) + 1
          reads.args[name] = args
          // The page's own first read always answers: only the dialogs' fetches are scripted.
          if (name === "getTimecards" && reads.calls[name] > 1) {
            const answer = reads.timecards.shift() ?? "ok"
            if (answer === "fail") return Promise.reject(new Error("offline"))
            if (answer === "hold") return new Promise((resolve) => reads.held.push(() => resolve([])))
          }
          return Promise.resolve(DATA[name] ?? (name.endsWith("Settings") ? null : []))
        },
      },
    ),
  }),
}))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/",
}))

async function renderPage() {
  // The app's staleTime: a cached copy under a minute old would otherwise be read as is.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 60_000 } } })
  render(
    <QueryClientProvider client={client}>
      <ClientPage clientId="c1" />
    </QueryClientProvider>,
  )
  await screen.findByRole("heading", { name: "Lumon", level: 1 })
}
// hidden: once a dialog is open, Radix hides the page behind it from the accessibility tree.
const button = (name: string) => screen.getByRole("button", { name, hidden: true })
const more = () => button("More actions for Migration")
/** Edit Contract and Delete Contract: the card's More menu, opened from the keyboard as Radix allows in jsdom. */
async function menu(item: "Edit Contract" | "Delete Contract") {
  more().focus()
  fireEvent.keyDown(more(), { key: "Enter" })
  fireEvent.click(await screen.findByRole("menuitem", { name: item }))
}

describe("The contract dialogs", () => {
  it("opens Amend once the hours are in, its button busy and announced meanwhile", async () => {
    reads.timecards = ["hold"]
    await renderPage()
    fireEvent.click(button("Amend Contract"))
    await waitFor(() => expect(button("Amend Contract")).toHaveAttribute("aria-busy", "true"))
    expect(screen.getByText("Loading the logged hours…")).toBeInTheDocument()
    expect(screen.queryByRole("dialog")).toBeNull()

    act(() => reads.held[0]())
    expect(await screen.findByRole("dialog", { name: "Amend Contract" })).toBeInTheDocument()
    expect(button("Amend Contract")).not.toHaveAttribute("aria-busy")
  })

  it("fetches the hours and invoices again on every click, past a copy still fresh", async () => {
    await renderPage()
    const timecardsBefore = reads.calls.getTimecards
    const invoicesBefore = reads.calls.getInvoices
    fireEvent.click(button("Amend Contract"))
    const dialog = await screen.findByRole("dialog", { name: "Amend Contract" })
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())

    await menu("Edit Contract")
    await screen.findByRole("dialog", { name: "Edit Contract" })
    expect(reads.calls.getTimecards).toBe(timecardsBefore + 2)
    expect(reads.calls.getInvoices).toBe(invoicesBefore + 2)
  })

  it("says so in the row when the hours fail to load, and opens nothing", async () => {
    reads.timecards = ["fail"]
    await renderPage()
    await menu("Edit Contract")
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn't load the logged hours and invoices, so this contract can't be changed right now. Try again in a moment.",
    )
    expect(screen.queryByRole("dialog")).toBeNull()
    // No dialog will take the focus: the menu hands it back to More, not to the page.
    await waitFor(() => expect(more()).toHaveFocus())
    // The next click tries again.
    await menu("Edit Contract")
    expect(await screen.findByRole("dialog", { name: "Edit Contract" })).toBeInTheDocument()
    expect(screen.queryByRole("alert")).toBeNull()
  })

  it("opens only the last dialog asked for, however the answers arrive", async () => {
    reads.timecards = ["hold"]
    await renderPage()
    fireEvent.click(button("Amend Contract"))
    await menu("Edit Contract")
    await waitFor(() => expect(reads.held).toHaveLength(1))
    act(() => reads.held[0]())
    await screen.findByRole("dialog", { name: "Edit Contract" })
    expect(screen.getAllByRole("dialog")).toHaveLength(1)
  })

  it("puts focus back on the button that opened a dialog", async () => {
    await renderPage()
    const amend = button("Amend Contract")
    amend.focus()
    fireEvent.click(amend)
    const dialog = await screen.findByRole("dialog", { name: "Amend Contract" })
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }))
    await waitFor(() => expect(amend).toHaveFocus())
  })

  it("names Edit and Delete in the card's More menu, and puts focus back on More", async () => {
    // A menu item is gone once its dialog opens: focus returns to the button that opened the menu.
    await renderPage()
    await menu("Edit Contract")
    const dialog = await screen.findByRole("dialog", { name: "Edit Contract" })
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }))
    await waitFor(() => expect(more()).toHaveFocus())
  })
})

describe("Close Contract", () => {
  // Hours make Delete a Close; the contract has no start, so it closes on today.
  const contract = (DATA.getEngagements as Record<string, unknown>[])[0]
  const thisMonth = format(now, "yyyy-MM")
  const nextMonth = format(addMonths(now, 1), "yyyy-MM")
  const amendment = (from: string) => ({ from, dailyRate: 800, addedDays: null, lastDay: null, lastDayBefore: null, note: null })
  beforeEach(() => {
    DATA.getTimecards = [
      { id: `e1_${thisMonth}-01`, userId: "u1", engagementId: "e1", date: `${thisMonth}-01`, hours: 8, createdAt: now, updatedAt: now },
    ]
  })
  afterEach(() => {
    delete DATA.getTimecards
    delete contract.amendments
  })

  it("refuses a close that ends before an amendment, and names the fix", async () => {
    contract.amendments = [amendment(nextMonth)]
    await renderPage()
    await menu("Delete Contract")
    const dialog = await screen.findByRole("alertdialog", { name: "Close Contract" })
    expect(dialog).toHaveTextContent(
      `The end moves before the ${format(addMonths(now, 1), "MMM yyyy")} amendment: it would never apply. Remove it with Amend Contract first.`,
    )
    expect(within(dialog).queryByRole("button", { name: "Close Contract" })).toBeNull()
  })

  it.each([
    ["no amendments", undefined],
    ["an amendment from this month", [amendment(thisMonth)]],
  ])("closes on today with %s", async (_label, amendments) => {
    contract.amendments = amendments
    await renderPage()
    await menu("Delete Contract")
    const dialog = await screen.findByRole("alertdialog", { name: "Close Contract" })
    expect(dialog).not.toHaveTextContent("would never apply")
    fireEvent.click(within(dialog).getByRole("button", { name: "Close Contract" }))
    await waitFor(() => expect(reads.calls.updateEngagement).toBe(1))
    const today = isoDate(new Date())
    expect(reads.args.updateEngagement).toEqual(["u1", "e1", { isActive: false, endDate: today, endMonth: thisMonth }])
  })
})
