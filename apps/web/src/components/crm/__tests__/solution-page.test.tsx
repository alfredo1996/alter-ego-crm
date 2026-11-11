/**
 * A solution's page, /solutions/[id], on made-up data (solution-fixtures.ts):
 * Nordwind Retail S.p.A.'s delivered product knowledge graph, 4 of 9 sections
 * written, on a contract whose newest status call was green. The router and
 * next/link are faked: Link here runs onNavigate as Next's does, then pushes.
 */
import { Toaster } from "@alter-ego/ui/ui/toaster"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"


import { SolutionPage } from "../solution-page"
import { CHURN, DATA, GRAPH, ROAD, SEARCH, solution } from "./solution-fixtures"

import type { MouseEvent, ReactNode } from "react"

const writes = vi.hoisted(() => ({
  updateSolution: vi.fn(async () => ({})),
  deleteSolution: vi.fn(async () => {}),
}))
const push = vi.hoisted(() => vi.fn())
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: vi.fn() }) }))
vi.mock("next/link", () => ({
  default: ({ href, onNavigate, children, ...rest }: { href: string; onNavigate?: (e: { preventDefault: () => void }) => void; children: ReactNode }) => (
    <a
      href={href}
      {...rest}
      onClick={(e: MouseEvent) => {
        e.preventDefault()
        let kept = false
        onNavigate?.({ preventDefault: () => (kept = true) })
        if (!kept) push(href)
      }}
    >
      {children}
    </a>
  ),
}))
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

// happy-dom never lays out: each observer is told 600 px at once, so the data model graph draws.
beforeEach(() => {
  push.mockClear()
  Object.values(writes).forEach((w) => w.mockClear())
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private cb: ResizeObserverCallback) {}
      observe() {
        this.cb([{ contentRect: { width: 600 } } as ResizeObserverEntry], this as unknown as ResizeObserver)
      }
      unobserve() {}
      disconnect() {}
    },
  )
})
afterEach(() => vi.unstubAllGlobals())

const type = (field: HTMLElement, value: string) => fireEvent.change(field, { target: { value } })

/** The page of solution `id`, once its data is in. */
async function show(id = "s1") {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SolutionPage id={id} />
      <Toaster />
    </QueryClientProvider>,
  )
  return screen.findByRole("heading", { level: 1 })
}

async function pick(combobox: HTMLElement, option: string) {
  fireEvent.keyDown(combobox, { key: "Enter" })
  fireEvent.keyDown(await screen.findByRole("option", { name: option }), { key: "Enter" })
}

const graph = (name: string) => screen.getByRole("img", { name: `Data model graph: ${name}` })
const button = (name: string) => screen.getByRole("button", { name })

describe("a solution's page", () => {
  it("heads it with the way back, its status and domain, its client, contract and stack", async () => {
    expect(await show()).toHaveTextContent("Product knowledge graph")
    const back = screen.getByRole("link", { name: "Back to Solutions" })
    expect(back).toHaveAttribute("href", "/solutions")
    expect(back.parentElement).toHaveTextContent("Back to Solutions/Nordwind Retail S.p.A.")
    expect(screen.getByText("Delivered")).toHaveClass("bg-success-soft")
    expect(screen.getByText("retail")).toBeInTheDocument()
    // The contract's newest stated status, and the newest call even when it stated none.
    expect(screen.getByText(/^Product graph · green on 9 Oct 2026$/).parentElement!.querySelector("[aria-hidden]")).toHaveClass("bg-success")
    // The year shows once it is not this one (its own test below): either way the line reads true.
    expect(screen.getByText(/^Last meeting 12 Oct( 2026)? · updated 1 Oct( 2026)?$/)).toBeInTheDocument()
    for (const tag of GRAPH.stack) expect(screen.getByText(tag)).toBeInTheDocument()
    expect(button("Edit Details")).toBeInTheDocument()
    expect(button("More actions")).toBeInTheDocument()
  })

  it("dates the last meeting as it dates the update: with the year, once it is not this one", async () => {
    // Only Date: React Query and Radix keep their real timers.
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(2027, 0, 5) })
    try {
      await show()
      expect(screen.getByText("Last meeting 12 Oct 2026 · updated 1 Oct 2026")).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it("says how much is written, links what is still to write, and lists the sections in reading order", async () => {
    await show()
    expect(screen.getByText("4 of 7 sections written")).toBeInTheDocument()
    const still = screen.getByText(/^Still to write:/, { selector: "span" })
    expect(within(still).getAllByRole("link").map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["Results", "#results"],
      ["Data Model", "#model"],
      ["Architecture", "#architecture"],
    ])
    // A phone's short version goes to the first of them.
    expect(screen.getByRole("link", { name: "Still to write: 3" })).toHaveAttribute("href", "#results")

    const index = screen.getByRole("navigation", { name: "Sections" })
    expect(within(index).getAllByRole("link").map((a) => a.getAttribute("aria-label"))).toEqual([
      "Purpose and Target",
      "KPIs",
      "Results (empty)",
      "Data Model (empty)",
      "Requirements",
      "Data Sources",
      "Architecture (empty)",
    ])
    expect(within(index).getByRole("link", { name: "Purpose and Target" })).toHaveAttribute("aria-current", "location")
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual([
      "Roadmap", "No steps yet", "What We Know", "Purpose and Target", "KPIs", "Results", "Data Model", "Requirements", "Data Sources", "Architecture",
    ])
    // Each section is the anchor its index link names, and plain text is a paragraph per line: no Markdown.
    expect(document.getElementById("purpose")).toHaveAccessibleName("Purpose and Target")
    expect(screen.getByText("One graph for the catalog,").tagName).toBe("P")
    expect(screen.getByText("so search and merchandising read the same products.").tagName).toBe("P")
  })

  it("shows an unwritten section as one dashed prompt, its question and its Write button", async () => {
    await show()
    const results = document.getElementById("results")!
    expect(results).toHaveAccessibleName("Results")
    expect(results).toHaveTextContent("What did it deliver, which numbers did it reach, and what would you do differently?")
    expect(results).toHaveTextContent("The section pre-sales reads first. Not written yet.")
    // Pre-sales reads Results first: its Write is the one filled button.
    expect(within(results).getByRole("button", { name: "Write Results" })).toHaveClass("bg-primary")
    const architecture = document.getElementById("architecture")!
    expect(architecture).toHaveTextContent("Which components are there, who talks to whom, and where does each one run?")
    expect(within(architecture).getByRole("button", { name: "Write Architecture" })).not.toHaveClass("bg-primary")
    // What it measured beside what it delivered.
    expect(document.getElementById("kpis")!.parentElement).toBe(results.parentElement)
  })

  it("shows a written section's text with a pencil to edit it, a leading label in bold", async () => {
    await show()
    const kpis = document.getElementById("kpis")!
    expect(kpis).toHaveTextContent("Search time: from 4 s to 1 s")
    expect(within(kpis).getByText("Search time:").tagName).toBe("STRONG")
    expect(within(kpis).getByRole("button", { name: "Edit KPIs" })).toHaveTextContent("")
  })

  it("edits in place: the question over the textbox, Unsaved changes by the heading", async () => {
    await show()
    fireEvent.click(button("Edit Requirements"))
    const text = screen.getByRole("textbox", { name: "Requirements" })
    expect(text).toHaveAccessibleDescription("What did it have to do, point by point, and under which constraints?")
    expect(text).toHaveValue("Nightly load from the ERP")
    expect(screen.queryByRole("button", { name: "Edit Requirements" })).not.toBeInTheDocument()
    const heading = screen.getByRole("heading", { level: 2, name: "Requirements" })
    expect(heading.parentElement).not.toHaveTextContent("Unsaved changes")
    type(text, "Nightly load from the ERP\nBy 6 am")
    expect(heading.parentElement).toHaveTextContent("Unsaved changes")
  })

  it("shows a dated History as a timeline, newest first; Add an Entry opens it with a line for today", async () => {
    const stored = DATA.getSolutions
    const history = "2026-02-10 Kickoff\n2026-07-15 Go-live.\nAfter the store pilot."
    DATA.getSolutions = [{ ...GRAPH, sections: { ...GRAPH.sections, history } }, CHURN, SEARCH]
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(2026, 9, 15) })
    try {
      await show()
      const section = document.getElementById("history")!
      expect(within(section).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
        "2026-07-15Go-live.\nAfter the store pilot.",
        "2026-02-10Kickoff",
      ])
      fireEvent.click(within(section).getByRole("button", { name: "Add an Entry" }))
      expect(screen.getByRole("textbox", { name: "History" })).toHaveValue(`${history}\n2026-10-15 `)
      expect(section).toHaveTextContent("One line per entry, opening on its date: 2026-07-15 Go-live.")
      // The line for today alone is no change, and saving it untouched writes no empty entry.
      expect(section).not.toHaveTextContent("Unsaved changes")
      fireEvent.click(within(section).getByRole("button", { name: "Save History" }))
      await waitFor(() => expect(writes.updateSolution).toHaveBeenCalledWith("u1", "s1", { sections: { history } }))
    } finally {
      vi.useRealTimers()
      DATA.getSolutions = stored
    }
  })

  it("shows a History that does not open on a date as written", async () => {
    const stored = DATA.getSolutions
    DATA.getSolutions = [{ ...GRAPH, sections: { ...GRAPH.sections, history: "Kickoff in February.\n2026-07-15 Go-live." } }, CHURN, SEARCH]
    try {
      await show()
      const section = document.getElementById("history")!
      expect(within(section).queryAllByRole("listitem")).toHaveLength(0)
      expect(within(section).getByText("Kickoff in February.").tagName).toBe("P")
      expect(within(section).getByText("2026-07-15 Go-live.").tagName).toBe("P")
    } finally {
      DATA.getSolutions = stored
    }
  })

  it("says so for a solution that is gone, with the way back", async () => {
    expect(await show("gone")).toHaveTextContent("Solution not found")
    expect(screen.getByRole("link", { name: "Back to Solutions" })).toHaveAttribute("href", "/solutions")
  })

  it("names a pre-sales solution's missing contract, and opens an empty model on its Entities", async () => {
    await show("s2")
    expect(screen.getByText("Pre-sales")).toBeInTheDocument()
    expect(screen.getByRole("tab", { name: "Entities" })).toHaveAttribute("aria-selected", "true")
    expect(button("Save Data Model")).toBeInTheDocument()
  })

  it("shows the graph first, and Save Data Model only beside the tables or a change", async () => {
    await show()
    expect(screen.getByRole("tab", { name: "Graph" })).toHaveAttribute("aria-selected", "true")
    expect(screen.queryByRole("button", { name: "Save Data Model" })).not.toBeInTheDocument()
    // Radix selects a tab on mousedown.
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Relations" }))
    expect(screen.getByRole("tab", { name: "Relations" })).toHaveAttribute("aria-selected", "true")
    expect(button("Save Data Model")).toBeInTheDocument()
  })
})

describe("its sections and data model", () => {
  it("saves one section alone, with its own Save", async () => {
    await show()
    fireEvent.click(button("Write Architecture"))
    const text = screen.getByRole("textbox", { name: "Architecture" })
    expect(text).toHaveAccessibleDescription(/^Which components are there/)
    type(text, "Kafka into Neo4j, GDS nightly")
    expect(screen.getByText("29 / 20,000")).toBeInTheDocument()
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument()
    fireEvent.click(button("Save Architecture"))
    await waitFor(() =>
      expect(writes.updateSolution).toHaveBeenCalledWith("u1", "s1", { sections: { architecture: "Kafka into Neo4j, GDS nightly" } }),
    )
  })

  it("saves an emptied section as null", async () => {
    await show()
    fireEvent.click(button("Edit KPIs"))
    type(screen.getByRole("textbox", { name: "KPIs" }), "  ")
    fireEvent.click(button("Save KPIs"))
    await waitFor(() => expect(writes.updateSolution).toHaveBeenCalledWith("u1", "s1", { sections: { kpis: null } }))
  })

  it("writes the modelling choices as the Data Model section, inside its card, with a Save of their own", async () => {
    await show()
    const card = document.getElementById("model")!
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Entities" }))
    fireEvent.click(within(card).getByRole("button", { name: "Write Modelling Choices" }))
    type(within(card).getByRole("textbox", { name: "Modelling choices" }), "Product is the hub")
    // Beside the tables' Save Data Model, never named as it.
    expect(within(card).getAllByRole("button", { name: /^Save/ }).map((b) => b.getAttribute("aria-label") ?? b.textContent)).toEqual([
      "Save Data Model",
      "Save Modelling Choices",
    ])
    fireEvent.click(within(card).getByRole("button", { name: "Save Modelling Choices" }))
    await waitFor(() => expect(writes.updateSolution).toHaveBeenCalledWith("u1", "s1", { sections: { model: "Product is the hub" } }))
  })

  it("leaves focus in the tables when Modelling choices finishes saving", async () => {
    let done = () => {}
    writes.updateSolution.mockImplementationOnce(() => new Promise((resolve) => (done = () => resolve({}))))
    await show()
    const card = document.getElementById("model")!
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Entities" }))
    fireEvent.click(within(card).getByRole("button", { name: "Write Modelling Choices" }))
    type(within(card).getByRole("textbox", { name: "Modelling choices" }), "Product is the hub")
    fireEvent.click(within(card).getByRole("button", { name: "Save Modelling Choices" }))
    // Typing in a table while it saves: the save closing its editor must not pull focus away.
    const entity = screen.getByRole("textbox", { name: "Entity 1 name" })
    entity.focus()
    await waitFor(() => expect(writes.updateSolution).toHaveBeenCalled())
    done()
    await waitFor(() => expect(within(card).queryByRole("textbox", { name: "Modelling choices" })).not.toBeInTheDocument())
    expect(entity).toHaveFocus()
  })

  it("refuses a relation to a removed entity before writing anything", async () => {
    await show()
    const remove = button("Remove entity 2")
    remove.focus()
    fireEvent.click(remove)
    // The last row gone, focus goes up a row, not to the page's top.
    expect(button("Remove entity 1")).toHaveFocus()
    expect(screen.getByRole("combobox", { name: "Relation 1 To" }).textContent).toBe("To")
    fireEvent.click(button("Save Data Model"))
    expect(await screen.findByRole("alert")).toHaveTextContent("Relation 1: pick an entity at each end")
    expect(writes.updateSolution).not.toHaveBeenCalled()
  })

  it("keeps a renamed entity's relations, even typed through another entity's name, and saves both tables together", async () => {
    await show()
    // "Product Line", a keystroke at a time, is "Product" for a moment: entity 1's name.
    const name = screen.getByRole("textbox", { name: "Entity 2 name" })
    for (let n = 1; n <= "Product Line".length; n++) type(name, "Product Line".slice(0, n))
    type(screen.getByRole("textbox", { name: "Entity 1 notes" }), "One per SKU")
    expect(screen.getByRole("combobox", { name: "Relation 1 To" })).toHaveTextContent("Product Line")
    // The graph draws the saved model, and says so while the draft differs.
    expect(screen.getByText("The graph shows the saved model.")).toBeInTheDocument()
    fireEvent.click(button("Save Data Model"))
    await waitFor(() =>
      expect(writes.updateSolution).toHaveBeenCalledWith("u1", "s1", {
        entities: [
          { name: "Product", source: "SAP MARA", notes: "One per SKU" },
          { name: "Product Line", source: null, notes: "From the merchandising tree" },
        ],
        relations: [{ from: "Product", to: "Product Line", type: "IN_CATEGORY" }],
      }),
    )
  })

  it("draws the saved model, not the draft, and the new one once Save Data Model lands", async () => {
    await show()
    expect(graph("2 entities, 1 relation")).toHaveTextContent(/ProductSAP MARA/)
    fireEvent.click(button("Add Entity"))
    type(screen.getByRole("textbox", { name: "Entity 3 name" }), "Brand")
    expect(graph("2 entities, 1 relation")).not.toHaveTextContent("Brand")
    const stored = DATA.getSolutions
    // What the save writes, as the list refetched after it reads it back.
    DATA.getSolutions = [{ ...GRAPH, entities: [...GRAPH.entities, { name: "Brand", source: null, notes: null }] }, CHURN, SEARCH]
    try {
      fireEvent.click(button("Save Data Model"))
      await waitFor(() => expect(graph("3 entities, 1 relation")).toHaveTextContent("Brand"))
      expect(screen.getByText("3 entities · 1 relation")).toBeInTheDocument()
      expect(screen.queryByText("The graph shows the saved model.")).not.toBeInTheDocument()
    } finally {
      DATA.getSolutions = stored
    }
  })

  it("keeps each save's outcome when two overlap: the second closes its editor, the first still reports its failure", async () => {
    let fail = (_e: Error) => {}
    writes.updateSolution.mockImplementationOnce(() => new Promise((_resolve, reject) => (fail = reject)))
    await show()
    fireEvent.click(button("Edit Purpose and Target"))
    fireEvent.click(button("Edit Requirements"))
    type(screen.getByRole("textbox", { name: "Purpose and Target" }), "One graph")
    type(screen.getByRole("textbox", { name: "Requirements" }), "Nightly load, by 6 am")
    fireEvent.click(button("Save Purpose and Target"))
    fireEvent.click(button("Save Requirements"))
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "Requirements" })).not.toBeInTheDocument())
    expect(button("Save Purpose and Target")).toBeDisabled()
    fail(new Error("offline"))
    expect(await screen.findByRole("alert")).toHaveTextContent("Save failed. Try again.")
    expect(screen.getByRole("textbox", { name: "Purpose and Target" })).toHaveValue("One graph")
  })

  it("puts focus back on the section's button after Save or Cancel, and on Add Relation after the last relation goes", async () => {
    await show()
    fireEvent.click(button("Write Architecture"))
    type(screen.getByRole("textbox", { name: "Architecture" }), "Kafka into Neo4j")
    const save = button("Save Architecture")
    save.focus()
    fireEvent.click(save)
    await waitFor(() => expect(button("Write Architecture")).toHaveFocus())

    fireEvent.click(button("Write Results"))
    const cancel = button("Cancel")
    cancel.focus()
    fireEvent.click(cancel)
    expect(button("Write Results")).toHaveFocus()

    const remove = button("Remove relation 1")
    remove.focus()
    fireEvent.click(remove)
    expect(button("Add Relation")).toHaveFocus()
  })

  it("follows a data model another writer changed while the draft is untouched", async () => {
    await show()
    expect(graph("2 entities, 1 relation")).toBeInTheDocument()
    const stored = DATA.getSolutions
    DATA.getSolutions = [{ ...GRAPH, entities: [...GRAPH.entities, { name: "Brand", source: null, notes: null }] }, CHURN, SEARCH]
    try {
      // Any save refetches the list; here a section's brings the other writer's entity.
      fireEvent.click(button("Write Architecture"))
      type(screen.getByRole("textbox", { name: "Architecture" }), "Kafka into Neo4j")
      fireEvent.click(button("Save Architecture"))
      expect(await screen.findByRole("textbox", { name: "Entity 3 name" })).toHaveValue("Brand")
      expect(screen.queryByText("Unsaved changes")).not.toBeInTheDocument()
      expect(graph("3 entities, 1 relation")).toHaveTextContent("Brand")
    } finally {
      DATA.getSolutions = stored
    }
  })
})

describe("leaving with unsaved edits", () => {
  it("lets a reload or a closed tab ask first only while something is unsaved", async () => {
    await show()
    const unload = () => {
      const e = new Event("beforeunload", { cancelable: true })
      window.dispatchEvent(e)
      return e.defaultPrevented
    }
    expect(unload()).toBe(false)
    fireEvent.click(button("Write Results"))
    type(screen.getByRole("textbox", { name: "Results" }), "Under a second")
    expect(unload()).toBe(true)
    fireEvent.click(button("Cancel"))
    expect(unload()).toBe(false)
  })

  it("asks before the breadcrumb leaves: Keep Editing stays, Discard Changes goes", async () => {
    await show()
    fireEvent.click(button("Add Entity"))
    fireEvent.click(screen.getByRole("link", { name: "Back to Solutions" }))
    let ask = await screen.findByRole("alertdialog", { name: "Discard Changes" })
    fireEvent.click(within(ask).getByRole("button", { name: "Keep Editing" }))
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument())
    expect(push).not.toHaveBeenCalled()
    expect(screen.getByRole("textbox", { name: "Entity 3 name" })).toBeInTheDocument()

    fireEvent.click(screen.getByRole("link", { name: "Back to Solutions" }))
    ask = await screen.findByRole("alertdialog", { name: "Discard Changes" })
    fireEvent.click(within(ask).getByRole("button", { name: "Discard Changes" }))
    expect(push).toHaveBeenCalledWith("/solutions")
  })

  it("leaves at once with nothing unsaved", async () => {
    await show()
    fireEvent.click(screen.getByRole("link", { name: "Back to Solutions" }))
    expect(push).toHaveBeenCalledWith("/solutions")
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
  })
})

describe("Edit Details and Delete Solution", () => {
  const TAKEN = 'Nordwind Retail S.p.A. already has a solution named "Product knowledge graph".'

  async function rename(id: string, name: string) {
    await show(id)
    fireEvent.click(button("Edit Details"))
    const dialog = await screen.findByRole("dialog", { name: "Edit Solution" })
    type(within(dialog).getByLabelText("Name"), name)
    fireEvent.click(within(dialog).getByRole("button", { name: "Save Changes" }))
    return dialog
  }

  it("refuses renaming one to another of the client's names, and writes nothing", async () => {
    const dialog = await rename("s2", "Product Knowledge Graph")
    expect(await within(dialog).findByText(TAKEN)).toHaveAttribute("role", "alert")
    expect(writes.updateSolution).not.toHaveBeenCalled()
  })

  it("lets a solution take its own name in another case", async () => {
    await rename("s1", "PRODUCT KNOWLEDGE GRAPH")
    await waitFor(() => expect(writes.updateSolution).toHaveBeenCalledWith("u1", "s1", { name: "PRODUCT KNOWLEDGE GRAPH" }))
  })

  it("checks the name only when it changes: one of a same-named pair saved before the rule still saves its status", async () => {
    const stored = DATA.getSolutions
    DATA.getSolutions = [GRAPH, CHURN, { ...SEARCH, name: "product knowledge graph" }]
    try {
      await show("s2")
      fireEvent.click(button("Edit Details"))
      const dialog = await screen.findByRole("dialog", { name: "Edit Solution" })
      await pick(within(dialog).getByRole("combobox", { name: "Status" }), "Delivered")
      fireEvent.click(within(dialog).getByRole("button", { name: "Save Changes" }))
      await waitFor(() => expect(writes.updateSolution).toHaveBeenCalledWith("u1", "s2", { status: "delivered" }))
    } finally {
      DATA.getSolutions = stored
    }
  })

  it("puts focus back on More after Edit Details from its menu (a phone's way in) closes", async () => {
    await show()
    fireEvent.keyDown(button("More actions"), { key: "Enter" })
    fireEvent.click(await screen.findByRole("menuitem", { name: "Edit Details" }))
    const dialog = await screen.findByRole("dialog", { name: "Edit Solution" })
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    await waitFor(() => expect(button("More actions")).toHaveFocus())
  })

  it("deletes from More after Delete Solution, goes back to the catalog and says so", async () => {
    await show()
    // Radix opens a menu on pointerdown, or on Enter from the keyboard.
    fireEvent.keyDown(button("More actions"), { key: "Enter" })
    fireEvent.click(await screen.findByRole("menuitem", { name: "Delete Solution" }))
    const confirm = await screen.findByRole("alertdialog", { name: "Delete Solution" })
    fireEvent.click(within(confirm).getByRole("button", { name: "Delete Solution" }))
    await waitFor(() => expect(writes.deleteSolution).toHaveBeenCalledWith("u1", "s1"))
    await waitFor(() => expect(push).toHaveBeenCalledWith("/solutions"))
    expect((await screen.findAllByText('Solution "Product knowledge graph" deleted.'))[0]).toBeInTheDocument()
  })
})

/** Shows solution `s` (the catalog's other solutions beside it) and runs `body`; the stored list is put back after. */
async function withSolution(s: ReturnType<typeof solution>, body: () => Promise<void>) {
  const stored = DATA.getSolutions
  DATA.getSolutions = [s, CHURN, SEARCH]
  try {
    await show(s.id)
    await body()
  } finally {
    DATA.getSolutions = stored
  }
}
/** The steps the last updateSolution wrote. */
const wroteSteps = () =>
  (writes.updateSolution.mock.calls.at(-1) as unknown as unknown[]).find((a): a is { steps: { title: string; state: string }[] } => !!a && typeof a === "object" && "steps" in a)!.steps

describe("an Advisory", () => {
  const advisory = solution({ id: "s5", clientId: "c1", name: "Month-end tuning", kind: "advisory" })

  it("shows its three sections and Add Section for the others", async () => {
    await withSolution(advisory, async () => {
      expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual([
        "Roadmap", "No steps yet", "What We Know", "Purpose and Target", "KPIs", "Results and Lessons",
      ])
      expect(screen.getByText("0 of 3 sections written")).toBeInTheDocument()
      fireEvent.keyDown(button("Add Section"), { key: "Enter" })
      expect((await screen.findAllByRole("menuitem")).map((m) => m.textContent)).toEqual(["Requirements", "Data Sources", "Data Model", "Architecture"])
      fireEvent.click(screen.getByRole("menuitem", { name: "Architecture" }))
      expect(await screen.findByRole("textbox", { name: "Architecture" })).toBeInTheDocument()
    })
  })

  it("keeps a section that holds text, without offering it again", async () => {
    await withSolution({ ...advisory, sections: { ...advisory.sections, requirements: "Nightly load" } }, async () => {
      expect(screen.getByRole("heading", { level: 2, name: "Requirements" })).toBeInTheDocument()
      fireEvent.keyDown(button("Add Section"), { key: "Enter" })
      expect((await screen.findAllByRole("menuitem")).map((m) => m.textContent)).toEqual(["Data Sources", "Data Model", "Architecture"])
    })
  })
})

describe("Steps and History", () => {
  it("show only while they hold text", async () => {
    await show()
    expect(screen.queryByRole("heading", { level: 2, name: "Steps" })).not.toBeInTheDocument()
    expect(screen.queryByRole("heading", { level: 2, name: "History" })).not.toBeInTheDocument()
  })

  it("show with their text, and Steps stays editable", async () => {
    await withSolution({ ...GRAPH, sections: { ...GRAPH.sections, steps: "1. Load the ERP", history: "2026-07-15 Go-live." } }, async () => {
      expect(screen.getByRole("heading", { level: 2, name: "Steps" })).toBeInTheDocument()
      expect(screen.getByText("1. Load the ERP")).toBeInTheDocument()
      expect(screen.getByRole("heading", { level: 2, name: "History" })).toBeInTheDocument()
      expect(button("Edit Steps")).toBeInTheDocument()
    })
  })
})

describe("the road", () => {
  it("shows the target, each step with its months and what pays for it, and where the work is", async () => {
    await withSolution(ROAD, async () => {
      expect(screen.getByText("One guest record on the front desk's screen.")).toBeInTheDocument()
      expect(screen.getByText("Step 2 of 5")).toBeInTheDocument()
      const road = screen.getByRole("heading", { level: 2, name: "Roadmap" }).closest("section")!
      const steps = within(road).getAllByRole("listitem").filter((li) => li.querySelector("button"))
      expect(steps.map((li) => li.textContent)).toEqual([
        "Done · Aug 20261.Proof of concept15 questions answeredContract · closed",
        "Now · Oct – Nov 20262.MVP on the client's serverContract · active",
        "Next · From Jan 20273.Front-desk guest cardOpportunity · Proposal",
        "Later · From Mar 20274.Campaign segmentsOpportunity · Lead",
        "Later · From Jun 20275.Offers assistantOpportunity · Lost",
      ])
      expect(within(steps[1]).getByRole("button")).toHaveAttribute("aria-current", "step")
    })
  })

  it("gives the Now card the contract's days as the client page counts them, its last call and its open tasks", async () => {
    await withSolution(ROAD, async () => {
      const card = screen.getByRole("heading", { level: 2, name: "Now · Step 2" }).closest("section")!
      expect(within(card).getByText("6.5 of 11 days used")).toBeInTheDocument()
      expect(within(card).getByRole("progressbar", { name: "Days used" })).toHaveAttribute("aria-valuenow", "59")
      expect(within(card).getByText("Runs every night on their server.")).toBeInTheDocument()
      expect(within(card).getByText("Contract Guest MVP · Active")).toBeInTheDocument()
      expect(within(card).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Back up and restore12 Nov", "Handover session20 Nov"])
      expect(within(card).getByRole("link", { name: "Open in Tasks" })).toHaveAttribute("href", "/tasks")
    })
  })

  it("lists in Next Steps only the steps an open opportunity pays for", async () => {
    await withSolution(ROAD, async () => {
      const list = screen.getByRole("heading", { level: 2, name: "Next Steps in the Pipeline" }).closest("section")!
      expect(within(list).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
        "3. Front-desk guest cardOpens the guest's story.Proposal15 days",
        "4. Campaign segmentsLead15 days",
      ])
    })
  })

  it("marks the Now step Done with its outcome, which the step asks for, and the next step becomes Now", async () => {
    await withSolution(ROAD, async () => {
      fireEvent.click(screen.getByRole("button", { name: /MVP on the client's server/ }))
      const dialog = await screen.findByRole("dialog", { name: "Edit Step" })
      expect(dialog).toHaveTextContent("Step 2 of 5 on Guest 360.")
      await pick(within(dialog).getByRole("combobox", { name: "State" }), "Done")
      fireEvent.click(within(dialog).getByRole("button", { name: "Save Step" }))
      expect(await within(dialog).findByRole("alert")).toHaveTextContent("Say what came of it to mark the step Done")
      expect(writes.updateSolution).not.toHaveBeenCalled()
      type(within(dialog).getByRole("textbox", { name: "Outcome" }), "Live on their server")
      fireEvent.click(within(dialog).getByRole("button", { name: "Save Step" }))
      await waitFor(() => expect(writes.updateSolution).toHaveBeenCalledTimes(1))
      expect(wroteSteps().map((x) => x.state)).toEqual(["done", "done", "now", "later", "later"])
      await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit Step" })).not.toBeInTheDocument())
    })
  })

  it("adds a step at the end", async () => {
    await withSolution(ROAD, async () => {
      fireEvent.click(button("Add Step"))
      const dialog = await screen.findByRole("dialog", { name: "Add Step" })
      type(within(dialog).getByRole("textbox", { name: "Title" }), "Hand over")
      fireEvent.click(within(dialog).getByRole("button", { name: "Save Step" }))
      await waitFor(() => expect(writes.updateSolution).toHaveBeenCalledTimes(1))
      expect(wroteSteps().map((x) => x.title).at(-1)).toBe("Hand over")
      expect(wroteSteps()).toHaveLength(6)
    })
  })

  it("reorders by drag, and by Move Later and Move Earlier from the dialog", async () => {
    await withSolution(ROAD, async () => {
      const item = (title: RegExp) => screen.getByRole("button", { name: title }).closest("li")!
      const dataTransfer = { setData: vi.fn(), getData: vi.fn(), effectAllowed: "" }
      fireEvent.dragStart(item(/Campaign segments/), { dataTransfer })
      fireEvent.dragOver(item(/Front-desk guest card/), { dataTransfer })
      fireEvent.drop(item(/Front-desk guest card/), { dataTransfer })
      await waitFor(() => expect(writes.updateSolution).toHaveBeenCalledTimes(1))
      expect(wroteSteps().map((x) => x.title)).toEqual([
        "Proof of concept", "MVP on the client's server", "Campaign segments", "Front-desk guest card", "Offers assistant",
      ])

      fireEvent.click(screen.getByRole("button", { name: /Proof of concept/ }))
      const dialog = await screen.findByRole("dialog", { name: "Edit Step" })
      expect(within(dialog).getByRole("button", { name: "Move Earlier" })).toBeDisabled()
      fireEvent.click(within(dialog).getByRole("button", { name: "Move Later" }))
      await waitFor(() => expect(writes.updateSolution).toHaveBeenCalledTimes(2))
      expect(wroteSteps().map((x) => x.title).slice(0, 2)).toEqual(["MVP on the client's server", "Proof of concept"])
    })
  })

  it("deletes a step only after asking", async () => {
    await withSolution(ROAD, async () => {
      fireEvent.click(screen.getByRole("button", { name: /Offers assistant/ }))
      fireEvent.click(within(await screen.findByRole("dialog", { name: "Edit Step" })).getByRole("button", { name: "Delete Step" }))
      const ask = await screen.findByRole("alertdialog", { name: "Delete Step" })
      expect(writes.updateSolution).not.toHaveBeenCalled()
      fireEvent.click(within(ask).getByRole("button", { name: "Delete Step" }))
      await waitFor(() => expect(writes.updateSolution).toHaveBeenCalledTimes(1))
      expect(wroteSteps().map((x) => x.title)).toEqual(["Proof of concept", "MVP on the client's server", "Front-desk guest card", "Campaign segments"])
    })
  })
})
