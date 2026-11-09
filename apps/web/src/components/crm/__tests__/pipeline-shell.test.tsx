/**
 * The Pipeline page on made-up deals: the figures, the open deals as cards, the closed
 * ones as a table, and the Stage tabs (?stage=), client and search that narrow them.
 * The arithmetic is lib/__tests__/opportunities.test.ts.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { addDays, startOfDay, subDays } from "date-fns"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { PipelineShell } from "../pipeline-shell"
import { client, contract } from "./solution-fixtures"

import type { Opportunity } from "@/types"

const url = vi.hoisted(() => {
  const subs = new Set<() => void>()
  return {
    search: "",
    set(search: string) {
      this.search = search
      subs.forEach((f) => f())
    },
    subscribe: (f: () => void) => (subs.add(f), () => void subs.delete(f)),
  }
})
const replace = vi.fn((href: string) => url.set(new URL(href, "http://localhost").search))
vi.mock("next/navigation", async () => {
  const { useSyncExternalStore } = await import("react")
  return {
    useRouter: () => ({ replace, push: vi.fn() }),
    useSearchParams: () => new URLSearchParams(useSyncExternalStore(url.subscribe, () => url.search)),
  }
})
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { id: "u1" } }) }))

const at = new Date(2026, 0, 1)
const deal = (o: Partial<Opportunity> & Pick<Opportunity, "id" | "clientId" | "title" | "stage" | "probability">): Opportunity => ({
  userId: "u1", dailyRate: 500, estimatedDaysPerMonth: 10, estimatedDurationMonths: 3, expectedStartMonth: null,
  vatApplicable: true, nextActionDate: null, nextActionNote: null, notes: null, lostReason: null, closedAt: null,
  engagementId: null, createdAt: at, updatedAt: at, ...o,
})
const today = new Date()
const DEALS = [
  deal({ id: "o1", clientId: "c2", title: "Demand Forecasting PoC", stage: "lead", probability: 15, dailyRate: 500, estimatedDaysPerMonth: 6, expectedStartMonth: "2026-12", nextActionDate: addDays(today, 5), nextActionNote: "Intro call with Paolo" }),
  deal({ id: "o2", clientId: "c3", title: "Graph RAG Assistant", stage: "proposal", probability: 40, dailyRate: 520, estimatedDaysPerMonth: 8, nextActionDate: addDays(today, 2), nextActionNote: "Send revised proposal" }),
  deal({ id: "o3", clientId: "c1", title: "Store Analytics Phase 2", stage: "negotiation", probability: 70, dailyRate: 540, estimatedDaysPerMonth: 10 }),
  deal({ id: "o4", clientId: "c2", title: "BI Dashboard Refresh", stage: "lead", probability: 20, dailyRate: 450, estimatedDaysPerMonth: 4 }),
  deal({ id: "o5", clientId: "c1", title: "Product Graph", stage: "won", probability: 100, engagementId: "e1", closedAt: new Date(2026, 5, 20) }),
  deal({ id: "o6", clientId: "c3", title: "Warehouse Dashboard", stage: "lost", probability: 0, lostReason: "Went with an in-house team", closedAt: new Date(2026, 7, 8) }),
]
const DATA: Record<string, unknown> = {}
vi.mock("@/lib/backend", () => ({
  getBackend: () => ({ db: new Proxy({}, { get: (_db, method) => () => Promise.resolve(DATA[String(method)] ?? []) }) }),
}))

beforeEach(() => {
  url.search = ""
  replace.mockClear()
  DATA.getClients = [client("c1", "Nordwind Retail S.p.A."), client("c2", "Lumen Srl"), client("c3", "Vela Analytics Srl")]
  DATA.getEngagements = [contract("e1", "c1", "Product Graph")]
  DATA.getOpportunities = DEALS
})

async function show(search = "") {
  cleanup()
  url.search = search
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <PipelineShell />
    </QueryClientProvider>,
  )
  await screen.findByRole("heading", { name: "Pipeline", level: 1 })
}

/** The open deals' titles, in reading order. */
const cards = () => screen.queryAllByRole("article").map((card) => within(card).getByRole("heading", { level: 3 }).textContent)

describe("the Pipeline page", () => {
  it("leads with the weighted pipeline by stage, the open deals and the next follow-up", async () => {
    await show()
    const summary = screen.getByRole("region", { name: "Summary" })
    // 3,780 + 1,664 + 450 + 360: each open deal at its own odds; won and lost count for nothing.
    expect(within(summary).getByText("Weighted pipeline").nextElementSibling).toHaveTextContent("€6,254/month")
    expect(within(summary).getByRole("img")).toHaveAccessibleName(
      "Weighted pipeline by stage, per month: Negotiation €3,780, Proposal €1,664, Lead €810.",
    )
    expect(within(summary).getByText("Open deals").nextElementSibling).toHaveTextContent(/^4/)
    expect(summary).toHaveTextContent("€14,360/month if all four close")
    expect(summary).toHaveTextContent("Graph RAG Assistant · in 2 days")
    expect(summary).toHaveTextContent("Nothing overdue")
  })

  it("shows open deals as cards closest to signing first, each with Won and a More menu", async () => {
    await show()
    expect(cards()).toEqual(["Store Analytics Phase 2", "Graph RAG Assistant", "BI Dashboard Refresh", "Demand Forecasting PoC"])
    const poc = screen.getByRole("article", { name: "Demand Forecasting PoC" })
    expect(poc).toHaveTextContent("Lumen Srl")
    expect(poc).toHaveTextContent("Next: Intro call with Paolo")
    expect(poc).toHaveTextContent("€450/month weighted")
    expect(poc).toHaveTextContent("€3,000/month at 100% · 6 days × €500 · 3 months from Dec 2026")
    expect(within(poc).getByRole("button", { name: "More actions for Demand Forecasting PoC" })).toBeInTheDocument()
    expect(screen.getByRole("article", { name: "BI Dashboard Refresh" })).toHaveTextContent("3 months, start not set")
    // Only an open deal can be won.
    expect(screen.getAllByRole("button", { name: "Won" })).toHaveLength(4)
  })

  it("lists closed deals in a table, won before lost as the boards draw it, a won one naming its contract", async () => {
    await show()
    const closed = screen.getByRole("region", { name: "Closed" })
    expect(within(closed).getByRole("heading", { name: "Closed" })).toBeInTheDocument()
    expect(closed).toHaveTextContent("1 won · 1 lost")
    const rows = within(within(closed).getByRole("table")).getAllByRole("row").slice(1)
    // Product Graph closed in June, before Warehouse Dashboard in August: won goes first all the same.
    expect(rows.map((r) => within(r).getAllByRole("button")[0].textContent)).toEqual(["Product Graph", "Warehouse Dashboard"])
    expect(within(rows[0]).getByRole("link", { name: "Product Graph" })).toHaveAttribute("href", "/clients/c1#contracts")
    expect(rows[1]).toHaveTextContent("Went with an in-house team")
  })

  it("narrows by stage through ?stage=, and by a search over titles and clients", async () => {
    await show()
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Lead 2" }), { button: 0 })
    expect(replace).toHaveBeenLastCalledWith("/pipeline?stage=lead", { scroll: false })
    expect(await screen.findByRole("tab", { name: "Lead 2", selected: true })).toBeInTheDocument()
    expect(cards()).toEqual(["BI Dashboard Refresh", "Demand Forecasting PoC"])
    expect(screen.queryByRole("region", { name: "Closed" })).toBeNull()

    await show("?stage=closed")
    expect(cards()).toEqual([])
    expect(screen.getByRole("region", { name: "Closed" })).toBeInTheDocument()

    await show()
    fireEvent.change(screen.getByRole("searchbox", { name: "Search deals" }), { target: { value: "vela" } })
    expect(cards()).toEqual(["Graph RAG Assistant"])
    expect(screen.getByRole("tab", { name: "All 2" })).toBeInTheDocument()
    fireEvent.change(screen.getByRole("searchbox", { name: "Search deals" }), { target: { value: "nothing like it" } })
    expect(screen.getByText("No deals match these filters.")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Show All" }))
    expect(cards()).toHaveLength(4)
  })

  it("says an overdue follow-up in words, on the card and in the figures", async () => {
    DATA.getOpportunities = [...DEALS, deal({ id: "o7", clientId: "c1", title: "Late One", stage: "proposal", probability: 50, nextActionDate: subDays(today, 3), nextActionNote: "Call back" })]
    await show()
    expect(screen.getByRole("article", { name: "Late One" })).toHaveTextContent("Overdue · Next: Call back")
    const summary = screen.getByRole("region", { name: "Summary" })
    expect(within(summary).getByText("Next follow-up").nextElementSibling).toHaveClass("text-warning-soft-foreground")
    expect(summary).toHaveTextContent("Late One · 3 days overdue")
    expect(summary).toHaveTextContent("1 overdue")
  })

  it("calls a follow-up dated today due, not overdue", async () => {
    // Stored as midnight, as the form saves it.
    DATA.getOpportunities = [...DEALS, deal({ id: "o7", clientId: "c1", title: "Due Today", stage: "proposal", probability: 50, nextActionDate: startOfDay(today), nextActionNote: "Call back" })]
    await show()
    expect(screen.getByRole("article", { name: "Due Today" })).not.toHaveTextContent("Overdue")
    const summary = screen.getByRole("region", { name: "Summary" })
    expect(within(summary).getByText("Next follow-up").nextElementSibling).not.toHaveClass("text-warning-soft-foreground")
    expect(summary).toHaveTextContent("Due Today · today")
    expect(summary).toHaveTextContent("Nothing overdue")
  })

  it("sends focus back to the button that opened a dialog, the More button for a menu item", async () => {
    await show()
    const more = screen.getByRole("button", { name: "More actions for Graph RAG Assistant" })
    for (const [item, dialog] of [["Edit Opportunity", "dialog"], ["Delete Opportunity", "alertdialog"]] as const) {
      more.focus()
      fireEvent.keyDown(more, { key: "Enter" })
      fireEvent.click(await screen.findByRole("menuitem", { name: item }))
      const open = await screen.findByRole(dialog)
      fireEvent.keyDown(open, { key: "Escape" })
      await waitFor(() => expect(screen.queryByRole(dialog)).toBeNull())
      await waitFor(() => expect(more).toHaveFocus())
    }
    // And to the title, for the deal opened by its title.
    const title = screen.getByRole("button", { name: "Graph RAG Assistant" })
    fireEvent.click(title)
    fireEvent.keyDown(await screen.findByRole("dialog"), { key: "Escape" })
    await waitFor(() => expect(title).toHaveFocus())
  })

  it("with no deals, asks for the first one, with one New Opportunity button", async () => {
    DATA.getOpportunities = []
    await show()
    expect(screen.getByRole("heading", { name: "No opportunities yet" })).toBeInTheDocument()
    expect(screen.getAllByRole("button", { name: "New Opportunity" })).toHaveLength(1)
    expect(screen.queryByRole("region", { name: "Summary" })).toBeNull()
  })
})

describe("the closed deals on the All tab", () => {
  // Lost deals closed on 1 to 4 January 2026: more recent than the old won ones.
  const lost = (n: number) =>
    deal({ id: `l${n}`, clientId: "c1", title: `Lost ${n}`, stage: "lost", probability: 0, closedAt: new Date(2026, 0, n) })
  // Won long ago: a won-first cut would list them before every lost deal.
  const old = (n: number) =>
    deal({ id: `w${n}`, clientId: "c1", title: `Old Win ${n}`, stage: "won", probability: 100, closedAt: new Date(2024, 0, n) })
  // Created straight as won: no closedAt, so it dates from its last update.
  const created = deal({ id: "cw", clientId: "c1", title: "Created Won", stage: "won", probability: 100, updatedAt: new Date(2026, 8, 1) })
  const rows = () => within(within(screen.getByRole("region", { name: "Closed" })).getByRole("table")).getAllByRole("row").slice(1)
  const names = () => rows().map((r) => within(r).getAllByRole("rowheader")[0].textContent)

  it("lists the six most recently closed, won or lost, and a control to the Closed tab", async () => {
    DATA.getOpportunities = [...DEALS, created, ...[1, 2, 3, 4].map(lost), ...[1, 2, 3, 4, 5].map(old)]
    await show()
    expect(names()).toEqual(["Product Graph", "Created Won", "Warehouse Dashboard", "Lost 4", "Lost 3", "Lost 2"])
    fireEvent.click(screen.getByRole("button", { name: "View All Closed (12)" }))
    expect(replace).toHaveBeenCalledWith("/pipeline?stage=closed", { scroll: false })
    expect(rows()).toHaveLength(12)
    expect(screen.queryByRole("button", { name: /View All Closed/ })).toBeNull()
  })

  it.each([
    ["fewer than six", []],
    ["exactly six", [1, 2, 3, 4].map(lost)],
  ])("shows no control with %s closed deals", async (_, extra) => {
    DATA.getOpportunities = [...DEALS, ...extra]
    await show()
    expect(rows()).toHaveLength(2 + extra.length)
    expect(screen.queryByRole("button", { name: /View All Closed/ })).toBeNull()
  })
})
