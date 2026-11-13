/**
 * The Solutions catalog on made-up data (solution-fixtures.ts). The filters and
 * the search live in the URL, so the router is faked here as the month-end test
 * fakes it. The filter maths is lib/__tests__/solutions.test.ts; a solution's own
 * page is solution-page.test.tsx.
 */
import { Toaster } from "@alter-ego/ui/ui/toaster"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"


import { SolutionCatalog } from "../solution-catalog"
import { CAPPED, DATA, ROAD, solution } from "./solution-fixtures"

const writes = vi.hoisted(() => ({
  createSolution: vi.fn(async (_u: string, input: object) => ({ id: "s9", ...input })),
  updateSolution: vi.fn(async () => ({})),
  deleteSolution: vi.fn(async () => {}),
}))

/** The URL's search, as the router keeps it: replace changes it, and the page re-reads it. */
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
const push = vi.fn()
vi.mock("next/navigation", async () => {
  const { useSyncExternalStore } = await import("react")
  return {
    useRouter: () => ({ replace, push }),
    usePathname: () => "/solutions",
    useSearchParams: () => new URLSearchParams(useSyncExternalStore(url.subscribe, () => url.search)),
  }
})
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { id: "u1" } }) }))
vi.mock("@/lib/backend", () => ({
  getBackend: () => ({
    db: new Proxy(
      {},
      {
        get: (_db, method) =>
          writes[method as keyof typeof writes] ?? (() => Promise.resolve(DATA[String(method)] ?? [])),
      },
    ),
  }),
}))

beforeEach(() => {
  url.search = ""
  replace.mockClear()
  push.mockClear()
  Object.values(writes).forEach((w) => w.mockClear())
})

/** Swaps the faked backend's reads for one test. */
async function withData(over: Record<string, unknown>, run: () => Promise<void>) {
  const stored = { ...DATA }
  Object.assign(DATA, over)
  try {
    await run()
  } finally {
    Object.assign(DATA, stored)
  }
}
const journalEntry = (solutionId: string, date: string) => ({ id: "j1", userId: "u1", solutionId, clientId: "c1", kind: "work", date, stepTitle: null, text: "Worked", decisions: [], links: [], next: null, createdAt: new Date(2026, 9, 27), updatedAt: new Date(2026, 9, 27) })

const type = (field: HTMLElement, value: string) => fireEvent.change(field, { target: { value } })

async function show(search = "") {
  url.search = search
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SolutionCatalog />
      <Toaster />
    </QueryClientProvider>,
  )
  await screen.findByRole("heading", { name: "Solutions" })
}

/** Each card's name, in reading order. */
const names = () => screen.getAllByRole("article").map((card) => within(card).getByRole("link").textContent)
const card = (name: string) => screen.getByRole("article", { name })

async function pick(combobox: HTMLElement, option: string) {
  fireEvent.keyDown(combobox, { key: "Enter" })
  fireEvent.keyDown(await screen.findByRole("option", { name: option }), { key: "Enter" })
}

describe("the Solutions catalog", () => {
  it("shows every solution as a row, newest updated first, with its client, kind, status, contract and stack", async () => {
    await show()
    expect(names()).toEqual(["Store search", "Product knowledge graph", "Churn model"])
    const graph = card("Product knowledge graph")
    expect(graph).toHaveTextContent("Nordwind Retail S.p.A.")
    expect(within(graph).getByText("Delivered")).toHaveClass("bg-success-soft")
    expect(within(graph).getByText("Product")).toBeInTheDocument()
    expect(graph).toHaveTextContent("neo4jgdskafka")
    expect(graph).toHaveTextContent("Product graph · Active")
    expect(card("Store search")).toHaveTextContent("Pre-sales")
    expect(card("Churn model")).toHaveTextContent("Retainer · Closed")
    // The name links to the solution's page, stretched over the row, its focus ring with no white band in dark mode.
    expect(within(graph).getByRole("link")).toHaveAttribute("href", "/solutions/s1")
    expect(within(graph).getByRole("link")).toHaveClass("after:inset-0", "focus-visible:ring-offset-card")
  })

  it("draws the road: target, a track of its steps, Now and Next, and the last activity", async () => {
    await withData({ getSolutions: [ROAD], getJournal: [journalEntry("s4", "2026-10-27")] }, async () => {
      await show()
      const row = card("Guest 360")
      expect(row).toHaveTextContent("One guest record on the front desk's screen.")
      expect(within(row).getByRole("img", { name: "1 of 5 steps done" })).toBeInTheDocument()
      expect(row).toHaveTextContent("Now: MVP on the client's server (step 2 of 5)")
      expect(row).toHaveTextContent("Next: Front-desk guest card")
      // The journal entry (27 Oct) is newer than the contract's last call (25 Oct).
      expect(row).toHaveTextContent(/Last activity 27 Oct( 2026)?/)
    })
  })

  it("says Reached and the Result once every step is done, and the call when it is the newest activity", async () => {
    const done = ROAD.steps.map((x) => ({ ...x, state: "done" as const, doneOn: "2026-07-20", outcome: "Search is one query" }))
    await withData({ getSolutions: [solution({ ...ROAD, status: "delivered", steps: done })] }, async () => {
      await show()
      const row = card("Guest 360")
      expect(within(row).getByRole("img", { name: "All 5 steps done, target reached" })).toBeInTheDocument()
      expect(row).toHaveTextContent("Reached: Target reached in Jul 2026.")
      expect(row).toHaveTextContent("Result: Search is one query")
      expect(row).toHaveTextContent(/Last activity 25 Oct( 2026)?/)
    })
  })

  it("narrows by kind, into ?kind=", async () => {
    await withData({ getSolutions: [ROAD, solution({ id: "s5", clientId: "c1", name: "Tuning", kind: "advisory" })] }, async () => {
      await show()
      await pick(screen.getByRole("combobox", { name: "Kind" }), "Advisory")
      expect(replace).toHaveBeenLastCalledWith("/solutions?kind=advisory", { scroll: false })
      await waitFor(() => expect(names()).toEqual(["Tuning"]))
    })
  })

  it("counts each status over the other filters, and a tab writes ?status=", async () => {
    await show("?client=c1")
    expect(names()).toEqual(["Store search", "Product knowledge graph"])
    expect(screen.getByRole("combobox", { name: "Client" })).toHaveTextContent("Client: Nordwind Retail S.p.A.")
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["All 2", "Proposed 1", "Building 0", "Delivered 1", "Retired 0"])

    // Radix selects a tab on mousedown.
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Delivered 1" }))
    expect(replace).toHaveBeenLastCalledWith("/solutions?client=c1&status=delivered", { scroll: false })
    await waitFor(() => expect(names()).toEqual(["Product knowledge graph"]))
    expect(screen.getByRole("tab", { name: "Delivered 1" })).toHaveAttribute("aria-selected", "true")

    await pick(screen.getByRole("combobox", { name: "Client" }), "All clients")
    expect(replace).toHaveBeenLastCalledWith("/solutions?status=delivered", { scroll: false })
  })

  it("narrows by one technology in use, and Show All clears every filter and the search", async () => {
    await show("?q=a")
    await pick(screen.getByRole("combobox", { name: "Stack" }), "kafka")
    expect(replace).toHaveBeenLastCalledWith("/solutions?q=a&stack=kafka", { scroll: false })
    await waitFor(() => expect(names()).toEqual(["Store search", "Product knowledge graph"]))

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Retired 0" }))
    await screen.findByText(/No solutions match these filters/)
    fireEvent.click(screen.getByRole("button", { name: "Show All" }))
    expect(replace).toHaveBeenLastCalledWith("/solutions", { scroll: false })
    await waitFor(() => expect(names()).toHaveLength(3))
    expect(screen.getByRole("searchbox", { name: "Search solutions" })).toHaveValue("")
  })

  it("searches as you type, into ?q=, and reads it back from a link", async () => {
    await show()
    type(screen.getByRole("searchbox", { name: "Search solutions" }), "search time")
    expect(replace).toHaveBeenLastCalledWith("/solutions?q=search+time", { scroll: false })
    expect(names()).toEqual(["Product knowledge graph"])
    cleanup()

    await show("?q=CHURN")
    expect(screen.getByRole("searchbox", { name: "Search solutions" })).toHaveValue("CHURN")
    expect(names()).toEqual(["Churn model"])
  })

  it("follows a link that drops ?q=, but never undoes a keystroke with its own write landing late", async () => {
    await show("?q=CHURN&status=retired")
    const box = screen.getByRole("searchbox", { name: "Search solutions" })
    // The sidebar's Solutions link: /solutions, no filters.
    act(() => url.set(""))
    expect(box).toHaveValue("")
    expect(names()).toHaveLength(3)

    // The router lags behind the typing: "s" lands after "st" is typed.
    replace.mockImplementationOnce(() => {}).mockImplementationOnce(() => {})
    type(box, "s")
    type(box, "st")
    act(() => url.set("?q=s"))
    expect(box).toHaveValue("st")
    act(() => url.set("?q=st"))
    expect(box).toHaveValue("st")
    expect(names()).toEqual(["Store search"])
  })

  it("sends an old ?solution= link, from when a solution opened in a sheet, to its page", async () => {
    url.search = "?status=delivered&solution=s1"
    render(
      <QueryClientProvider client={new QueryClient()}>
        <SolutionCatalog />
      </QueryClientProvider>,
    )
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/solutions/s1"))
    // No catalog flashes on the way.
    expect(screen.queryByRole("heading", { name: "Solutions" })).not.toBeInTheDocument()
    expect(screen.getByRole("status", { name: "Loading" })).toBeInTheDocument()
  })

  it("says so when there are none yet, with New Solution", async () => {
    const stored = DATA.getSolutions
    DATA.getSolutions = []
    try {
      await show()
      expect(screen.getByText(/No solutions yet/)).toBeInTheDocument()
      expect(screen.getAllByRole("button", { name: "New Solution" })).toHaveLength(1)
    } finally {
      DATA.getSolutions = stored
    }
  })
})

describe("Present", () => {
  /** A contract without a name reads as its rate: the money Present must hide. */
  const priced = { getSolutions: [ROAD], getEngagements: [{ ...CAPPED, name: null }] }

  it("shows the rate in the row, and a Present button writes ?present=1", async () => {
    await withData(priced, async () => {
      await show()
      expect(card("Guest 360")).toHaveTextContent("€600")
      fireEvent.click(screen.getByRole("button", { name: "Present" }))
      expect(replace).toHaveBeenLastCalledWith("/solutions?present=1", { scroll: false })
    })
  })

  it("holds no € amount, no New Solution and no edit control, and keeps the link presenting", async () => {
    await withData(priced, async () => {
      await show("?present=1")
      expect(document.body.textContent).not.toContain("€")
      expect(screen.queryByRole("button", { name: "New Solution" })).not.toBeInTheDocument()
      expect(screen.queryByRole("button", { name: /Edit/ })).not.toBeInTheDocument()
      expect(screen.getByRole("status")).toHaveTextContent("Presenting")
      expect(within(card("Guest 360")).getByRole("link")).toHaveAttribute("href", "/solutions/s4?present=1")
      expect(card("Guest 360")).toHaveTextContent("Active")
    })
  })

  it("keeps ?present=1 through a filter, and Stop Presenting drops it", async () => {
    await withData(priced, async () => {
      await show("?present=1")
      fireEvent.mouseDown(screen.getByRole("tab", { name: "Building 1" }))
      expect(replace).toHaveBeenLastCalledWith("/solutions?present=1&status=building", { scroll: false })
      fireEvent.click(screen.getByRole("button", { name: "Stop Presenting" }))
      expect(replace).toHaveBeenLastCalledWith("/solutions?status=building", { scroll: false })
    })
  })
})

describe("New Solution", () => {
  it("shows zod's messages inline and writes nothing while they stand", async () => {
    await show()
    fireEvent.click(screen.getByRole("button", { name: "New Solution" }))
    const dialog = await screen.findByRole("dialog", { name: "New Solution" })
    fireEvent.click(within(dialog).getByRole("button", { name: "Create Solution" }))
    expect(await within(dialog).findByText("Name is required")).toHaveClass("text-destructive")
    // Announced, and named by its field: focus stays on Create.
    expect(within(dialog).getByText("Client is required")).toHaveAttribute("role", "alert")
    expect(within(dialog).getByRole("combobox", { name: "Client" })).toHaveAccessibleDescription("Client is required")
    expect(writes.createSolution).not.toHaveBeenCalled()
  })

  it("clears the contract when the client changes to one it is not for", async () => {
    await show("?client=c1")
    fireEvent.click(screen.getByRole("button", { name: "New Solution" }))
    const dialog = await screen.findByRole("dialog", { name: "New Solution" })
    type(within(dialog).getByLabelText("Name"), "Price graph")
    await pick(within(dialog).getByRole("combobox", { name: "Contract" }), "Product graph")
    fireEvent.click(within(dialog).getByRole("combobox", { name: "Client" }))
    fireEvent.click(await screen.findByRole("option", { name: "Lumen Srl" }))
    expect(within(dialog).getByRole("combobox", { name: "Contract" })).toHaveTextContent("None (pre-sales)")
    fireEvent.click(within(dialog).getByRole("button", { name: "Create Solution" }))
    await waitFor(() =>
      expect(writes.createSolution).toHaveBeenCalledWith("u1", expect.objectContaining({ clientId: "c2", engagementId: null })),
    )
  })

  it("does not start on a client a stale link names but no longer exists", async () => {
    await show("?client=gone")
    fireEvent.click(screen.getByRole("button", { name: "New Solution" }))
    const dialog = await screen.findByRole("dialog", { name: "New Solution" })
    expect(within(dialog).getByRole("combobox", { name: "Client" })).toHaveTextContent("Choose or type a client")
  })

  it("starts on the filtered client, adds the typed technology, and opens what it created", async () => {
    await show("?client=c1")
    fireEvent.click(screen.getByRole("button", { name: "New Solution" }))
    const dialog = await screen.findByRole("dialog", { name: "New Solution" })
    expect(within(dialog).getByRole("combobox", { name: "Client" })).toHaveTextContent("Nordwind Retail S.p.A.")
    type(within(dialog).getByLabelText("Name"), "Price graph")
    type(within(dialog).getByLabelText("Stack"), "Neo4j,")
    type(within(dialog).getByLabelText("Stack"), "Kafka")
    await pick(within(dialog).getByRole("combobox", { name: "Contract" }), "Product graph")
    fireEvent.click(within(dialog).getByRole("button", { name: "Create Solution" }))
    await waitFor(() =>
      expect(writes.createSolution).toHaveBeenCalledWith("u1", {
        clientId: "c1", name: "Price graph", engagementId: "e1", status: "proposed", kind: "product", target: null, domain: null, stack: ["neo4j", "kafka"],
      }),
    )
    await waitFor(() => expect(push).toHaveBeenCalledWith("/solutions/s9"))
  })

  it("sets the kind and the target without the MCP, and refuses a target over 500 characters", async () => {
    await show("?client=c1")
    fireEvent.click(screen.getByRole("button", { name: "New Solution" }))
    const dialog = await screen.findByRole("dialog", { name: "New Solution" })
    type(within(dialog).getByLabelText("Name"), "Pricing advice")
    await pick(within(dialog).getByRole("combobox", { name: "Kind" }), "Advisory")
    type(within(dialog).getByLabelText("Target (optional)"), "x".repeat(501))
    fireEvent.click(within(dialog).getByRole("button", { name: "Create Solution" }))
    expect(await within(dialog).findByText("At most 500 characters")).toHaveAttribute("role", "alert")
    expect(writes.createSolution).not.toHaveBeenCalled()
    type(within(dialog).getByLabelText("Target (optional)"), " Prices set by one team ")
    fireEvent.click(within(dialog).getByRole("button", { name: "Create Solution" }))
    await waitFor(() =>
      expect(writes.createSolution).toHaveBeenCalledWith("u1", expect.objectContaining({ kind: "advisory", target: "Prices set by one team" })),
    )
  })
})

describe("a solution's name, unique within its client as over chat", () => {
  const TAKEN = 'Nordwind Retail S.p.A. already has a solution named "Product knowledge graph".'

  async function create(client: string, name: string) {
    await show(`?client=${client}`)
    fireEvent.click(screen.getByRole("button", { name: "New Solution" }))
    const dialog = await screen.findByRole("dialog", { name: "New Solution" })
    type(within(dialog).getByLabelText("Name"), name)
    fireEvent.click(within(dialog).getByRole("button", { name: "Create Solution" }))
    return dialog
  }

  it("refuses a new one named as one of the client's, in any case, under Name, and writes nothing", async () => {
    const dialog = await create("c1", "  product KNOWLEDGE graph ")
    expect(await within(dialog).findByText(TAKEN)).toHaveAttribute("role", "alert")
    expect(within(dialog).getByLabelText("Name")).toHaveAccessibleDescription(TAKEN)
    expect(writes.createSolution).not.toHaveBeenCalled()
  })

  it("lets a new one share the name of another client's", async () => {
    await create("c2", "Product knowledge graph")
    await waitFor(() =>
      expect(writes.createSolution).toHaveBeenCalledWith("u1", expect.objectContaining({ clientId: "c2", name: "Product knowledge graph" })),
    )
  })
})
