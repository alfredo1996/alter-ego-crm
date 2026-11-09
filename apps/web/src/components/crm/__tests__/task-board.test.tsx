/**
 * The task board: the filters' arithmetic first, then the page on made-up tasks
 * (columns, cards, the phone's one-column tabs, Done's last ten, the search).
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { addDays, format, subDays } from "date-fns"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ALL, NO_CONTRACT, TaskBoard, filterBoardTasks, newTaskInitial } from "../task-board"
import { client, contract } from "./solution-fixtures"

import type { Task } from "@/types"

/**
 * These tasks are written as before #164 — a contract, no clientId — so the
 * Client filter has to go through the contract. Two contracts for one client
 * must both survive it.
 */
const engagements = [
  { id: "e1", clientId: "acme" },
  { id: "e2", clientId: "acme" },
  { id: "e3", clientId: "globex" },
]

const task = (id: string, engagementId: string) => ({ id, engagementId }) as Task

const tasks = [task("t1", "e1"), task("t2", "e2"), task("t3", "e3")]
const ids = (list: Task[]) => list.map((t) => t.id)

describe("filterBoardTasks", () => {
  it("keeps everything with both filters off", () => {
    expect(ids(filterBoardTasks(tasks, engagements, ALL, ALL))).toEqual(["t1", "t2", "t3"])
  })

  it("keeps every contract of the chosen client", () => {
    expect(ids(filterBoardTasks(tasks, engagements, "acme", ALL))).toEqual(["t1", "t2"])
  })

  it("narrows to one contract", () => {
    expect(ids(filterBoardTasks(tasks, engagements, "acme", "e2"))).toEqual(["t2"])
  })

  it("matches nothing when the contract is not the client's", () => {
    expect(filterBoardTasks(tasks, engagements, "globex", "e1")).toEqual([])
  })

  // #164: a client-level task has no contract to go through.
  it("keeps a client-level task under its client, and out of every contract", () => {
    const withClientLevel = [...tasks, { id: "t4", clientId: "globex", engagementId: null } as Task]
    expect(ids(filterBoardTasks(withClientLevel, engagements, "globex", ALL))).toEqual(["t3", "t4"])
    expect(ids(filterBoardTasks(withClientLevel, engagements, "globex", "e3"))).toEqual(["t3"])
    expect(ids(filterBoardTasks(withClientLevel, engagements, "acme", ALL))).toEqual(["t1", "t2"])
  })
})

/** #164: the Contract filter's "Client only". */
describe("filterBoardTasks with NO_CONTRACT", () => {
  const withClientLevel = [
    ...tasks,
    { id: "t4", clientId: "globex", engagementId: null } as Task,
    { id: "t5", clientId: "acme", engagementId: null } as Task,
  ]

  it("keeps only client-level tasks", () => {
    expect(ids(filterBoardTasks(withClientLevel, engagements, ALL, NO_CONTRACT))).toEqual(["t4", "t5"])
  })

  it("keeps only the chosen client's client-level tasks", () => {
    expect(ids(filterBoardTasks(withClientLevel, engagements, "acme", NO_CONTRACT))).toEqual(["t5"])
  })
})

describe("filterBoardTasks by search", () => {
  const written = [
    { id: "t1", clientId: "acme", engagementId: null, labels: [], title: "Draft the Proposal", notes: null },
    { id: "t2", clientId: "acme", engagementId: null, labels: [], title: "Call", notes: "Ask for the proposal PDF" },
    { id: "t3", clientId: "acme", engagementId: null, labels: [], title: "Invoice", notes: null },
  ] as unknown as Task[]

  it("matches the title or the description, whatever the case, ignoring the spaces around it", () => {
    expect(ids(filterBoardTasks(written, engagements, ALL, ALL, ALL, "  proposal "))).toEqual(["t1", "t2"])
  })

  it("keeps everything when blank", () => {
    expect(ids(filterBoardTasks(written, engagements, ALL, ALL, ALL, " "))).toEqual(["t1", "t2", "t3"])
  })
})

describe("filterBoardTasks by label", () => {
  const labelled = [
    { id: "t1", clientId: "acme", engagementId: "e1", labels: ["Urgente", "Bug"] },
    { id: "t2", clientId: "acme", engagementId: null, labels: ["urgente"] },
    { id: "t3", clientId: "globex", engagementId: "e3", labels: [] },
  ] as unknown as Task[]

  it("keeps the tasks carrying the label, whatever its case", () => {
    expect(ids(filterBoardTasks(labelled, engagements, ALL, ALL, "Urgente"))).toEqual(["t1", "t2"])
  })

  it("combines with the other filters", () => {
    expect(ids(filterBoardTasks(labelled, engagements, "acme", NO_CONTRACT, "urgente"))).toEqual(["t2"])
    expect(filterBoardTasks(labelled, engagements, "globex", ALL, "Bug")).toEqual([])
  })
})

/** Like add_task, the dialog never attaches a task to a contract nobody picked. */
describe("newTaskInitial", () => {
  const clients = [{ id: "acme" }, { id: "globex" }]

  it("starts blank among several clients, with no contract", () => {
    expect(newTaskInitial(clients, engagements, ALL, ALL)).toEqual({ clientId: "", engagementId: NO_CONTRACT })
  })

  it("starts on the filtered client, with no contract", () => {
    expect(newTaskInitial(clients, engagements, "globex", ALL)).toEqual({
      clientId: "globex",
      engagementId: NO_CONTRACT,
    })
  })

  it("starts on the filtered contract and its client", () => {
    expect(newTaskInitial(clients, engagements, ALL, "e2")).toEqual({ clientId: "acme", engagementId: "e2" })
  })

  it("keeps Client only as no contract", () => {
    expect(newTaskInitial(clients, engagements, "acme", NO_CONTRACT)).toEqual({
      clientId: "acme",
      engagementId: NO_CONTRACT,
    })
  })

  // A client with exactly one contract still starts client-level: explicit beats guessed.
  it("preselects the only client, but not its only contract", () => {
    expect(newTaskInitial([{ id: "globex" }], engagements, ALL, ALL)).toEqual({
      clientId: "globex",
      engagementId: NO_CONTRACT,
    })
  })
})

vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { id: "u1" } }) }))
const DATA: Record<string, unknown> = {}
vi.mock("@/lib/backend", () => ({
  getBackend: () => ({ db: new Proxy({}, { get: (_db, method) => () => Promise.resolve(DATA[String(method)] ?? []) }) }),
}))

const today = new Date()
const at = new Date(2026, 0, 1)
const make = (o: Partial<Task> & Pick<Task, "id" | "title">): Task => ({
  userId: "u1", clientId: "c1", engagementId: null, dueDate: null, notes: null, isDone: false,
  startedAt: null, labels: [], createdAt: at, updatedAt: at, ...o,
})
/** Twelve done tasks, Done 1 the oldest. */
const DONE = Array.from({ length: 12 }, (_, i) =>
  make({ id: `d${i + 1}`, title: `Done ${i + 1}`, isDone: true, updatedAt: new Date(2026, 9, i + 1) }),
)
const BOARD = [
  make({ id: "t1", clientId: "c2", title: "Book forecasting intro call", dueDate: subDays(today, 3), labels: ["sales"], notes: "Ask about Q4" }),
  make({ id: "t2", clientId: "c3", title: "Draft Graph RAG proposal", dueDate: addDays(today, 1), labels: ["sales"] }),
  make({ id: "t3", clientId: "c1", engagementId: "e1", title: "Load store hierarchy", dueDate: addDays(today, 3), labels: ["data", "graph"], startedAt: at }),
  ...DONE.slice(0, 11),
  { ...DONE[11], dueDate: new Date(today.getFullYear(), 9, 3) },
]

beforeEach(() => {
  DATA.getClients = [client("c1", "Nordwind Retail S.p.A."), client("c2", "Lumen Srl"), client("c3", "Vela Analytics Srl")]
  DATA.getEngagements = [contract("e1", "c1", "Product Graph")]
  DATA.getTasks = BOARD
})

async function show() {
  cleanup()
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <TaskBoard />
    </QueryClientProvider>,
  )
  await screen.findByRole("region", { name: "To Do" })
}

const column = (name: string) => screen.getByRole("region", { name })
const card = (title: string) => screen.getByRole("article", { name: title })
const titles = (region: HTMLElement) => within(region).getAllByRole("article").map((a) => within(a).getAllByRole("button")[0].textContent)

describe("the task board", () => {
  it("has three columns, each a region named by its heading, with its count beside it", async () => {
    await show()
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual(["To Do", "In Progress", "Done"])
    expect(titles(column("To Do"))).toEqual(["Book forecasting intro call", "Draft Graph RAG proposal"])
    expect(column("In Progress")).toHaveTextContent(/^In Progress1/)
    expect(card("Load store hierarchy")).toHaveTextContent("Nordwind Retail S.p.A. · Product Graph")
  })

  it("says a card is overdue or due soon in a pill beside its date, with no red date and no destructive badge", async () => {
    await show()
    const overdue = card("Book forecasting intro call")
    expect(within(overdue).getByText("Overdue")).not.toHaveClass("bg-destructive")
    expect(overdue).toHaveTextContent(new RegExp(`Overdue\\s*${format(subDays(today, 3), "d MMM")}`))
    expect(within(overdue).getByText("Has description")).toBeInTheDocument()
    expect(card("Draft Graph RAG proposal")).toHaveTextContent("Due tomorrow")
    expect(card("Load store hierarchy")).toHaveTextContent(`Due ${format(addDays(today, 3), "d MMM")}`)
  })

  it("ticks a done card in words, never striking its title through", async () => {
    await show()
    const done = card("Done 12")
    expect(done).toHaveTextContent(/Done\s*due 3 Oct/)
    expect(within(done).getByRole("button", { name: "Done 12" })).not.toHaveClass("line-through")
  })

  it("keeps Done to the ten most recent, then Show All Done", async () => {
    await show()
    expect(titles(column("Done"))).toEqual(["Done 12", "Done 11", "Done 10", "Done 9", "Done 8", "Done 7", "Done 6", "Done 5", "Done 4", "Done 3"])
    expect(column("Done")).toHaveTextContent(/^Done12/)
    fireEvent.click(within(column("Done")).getByRole("button", { name: "Show All Done" }))
    expect(titles(column("Done"))).toHaveLength(12)
    expect(within(column("Done")).queryByRole("button", { name: "Show All Done" })).not.toBeInTheDocument()
    // The button is gone, so focus lands on the first card it brought, not on the page.
    expect(document.activeElement).toBe(within(card("Done 2")).getByRole("button", { name: "Done 2" }))
  })

  // A phone shows one column at a time: the others are hidden by CSS, never unmounted.
  it("on a phone, shows the tabbed column and hides the others without unmounting them", async () => {
    await show()
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["To Do 2", "In Progress 1", "Done 12"])
    expect(screen.getByRole("tablist", { name: "Status" }).closest(".sm\\:hidden")).not.toBeNull()
    // From sm up the tabs are hidden: no panel named after them, nothing focusable, wraps the columns.
    expect(document.querySelector('[role="tabpanel"]')).toBeNull()
    for (const [tab, name] of [["To Do 2", "To Do"], ["In Progress 1", "In Progress"], ["Done 12", "Done"]]) {
      expect(column(name).closest("[tabindex]")).toBeNull()
      expect(screen.getByRole("tab", { name: tab })).toHaveAttribute("aria-controls", column(name).id)
    }
    expect(column("To Do")).not.toHaveClass("max-sm:hidden")
    expect(column("In Progress")).toHaveClass("max-sm:hidden")
    expect(column("Done")).toHaveClass("max-sm:hidden")

    fireEvent.mouseDown(screen.getByRole("tab", { name: "In Progress 1" }), { button: 0 })
    expect(screen.getByRole("tab", { name: "In Progress 1" })).toHaveAttribute("aria-selected", "true")
    expect(column("To Do")).toHaveClass("max-sm:hidden")
    expect(column("In Progress")).not.toHaveClass("max-sm:hidden")
    expect(card("Book forecasting intro call")).toBeInTheDocument()
  })

  // The e2e flows reach the filters with getByLabel(…, { exact: true }): one of each on a desktop.
  it("names each filter once, and the search narrows the cards", async () => {
    await show()
    for (const name of ["Client", "Contract", "Label"]) expect(screen.getAllByLabelText(name, { exact: true })).toHaveLength(1)
    fireEvent.change(screen.getByRole("searchbox", { name: "Search tasks" }), { target: { value: "q4" } })
    expect(screen.getAllByRole("article")).toEqual([card("Book forecasting intro call")])
    expect(screen.getByRole("tab", { name: "In Progress 0" })).toBeInTheDocument()
  })
})
