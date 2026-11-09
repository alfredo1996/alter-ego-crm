/**
 * The Collaborators page over a fixed clock, 15 Oct 2026 (Q4 2026, then Q1 2027): the strip, the
 * All / Active / Inactive chips, a card per collaborator with the fee today and its fixed cost this
 * quarter and next, and the New / Edit dialog with its fee changes and its messages.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { CollaboratorsShell } from "../collaborators-shell"

vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { id: "u1" } }) }))
const DATA: Record<string, unknown> = {}
const calls: [string, unknown[]][] = []
vi.mock("@/lib/backend", () => ({
  getBackend: () => ({
    db: new Proxy(
      {},
      {
        get: (_db, method) => (...args: unknown[]) => {
          calls.push([String(method), args])
          return Promise.resolve(DATA[String(method)] ?? [])
        },
      },
    ),
  }),
}))

const at = new Date(2026, 0, 1)
const collaborator = (id: string, name: string, extra: Record<string, unknown>) => ({
  id, userId: "u1", name, type: "freelancer", notes: null, isActive: true, fee: null, createdAt: at, updatedAt: at, ...extra,
})

beforeAll(() => vi.setSystemTime(new Date(2026, 9, 15)))
afterAll(() => vi.useRealTimers())
beforeEach(() => {
  calls.length = 0
  DATA.getCollaborators = [
    collaborator("verdi", "Studio Verdi", {
      type: "company", notes: "UX and front-end.",
      fee: { amount: 2400, from: "2026-01", until: null, changes: [{ from: "2027-03", amount: 2600 }] },
    }),
    collaborator("marco", "Marco Bianchi", { fee: { amount: 1500, from: "2026-10", until: "2027-03", changes: [] } }),
    collaborator("giulia", "Giulia Neri", {}),
    collaborator("lab", "Lab Nove Srl", { type: "company", isActive: false, notes: "Design system work, 2025–26", fee: { amount: 900, from: "2025-01", until: "2026-06", changes: [] } }),
  ]
})

async function show() {
  cleanup()
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <CollaboratorsShell />
    </QueryClientProvider>,
  )
  await screen.findByRole("heading", { name: "Collaborators", level: 1 })
  await screen.findByRole("article", { name: "Studio Verdi" })
}
const names = () => screen.queryAllByRole("article").map((c) => within(c).getByRole("heading", { level: 2 }).textContent)
const card = (name: string) => screen.getByRole("article", { name })

describe("the Collaborators page", () => {
  it("heads the list with the active count, the fees a month and this quarter's total", async () => {
    await show()
    const strip = screen.getByText("a month in fixed fees").closest("div")!
    expect(strip).toHaveTextContent("3 active€3,900 a month in fixed fees€11,700 this quarter, Q4 2026")
  })

  describe("invoiced against plan", () => {
    const invoice = (id: string, collaboratorId: string, forMonth: string, amount: number, documentRef: string | null) => ({
      id, userId: "u1", description: id, category: "collaborators", amount, date: new Date(2026, 9, 2), isRecurring: false,
      collaboratorId, engagementId: null, forMonth, documentRef,
    })
    afterEach(() => {
      vi.setSystemTime(new Date(2026, 9, 15))
      delete DATA.getCompanyExpenses
    })
    beforeEach(() => {
      DATA.getCompanyExpenses = [
        invoice("a", "verdi", "2026-07", 2400, "11/2026"),
        invoice("b", "verdi", "2026-08", 2400, "12/2026"),
      ]
    })

    it("lists last quarter's months with their invoice numbers, the missing one open, and the gap in a pill", async () => {
      await show()
      const block = within(card("Studio Verdi")).getByRole("group", { name: "Invoiced against plan" })
      expect(block).toHaveTextContent("Last quarter: invoiced €4,800 of €7,200")
      expect(block).toHaveTextContent("Sep not invoiced")
      expect(within(block).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
        "Jul · 11/2026€2,400 ✓",
        "Aug · 12/2026€2,400 ✓",
        "Sep— of €2,400",
      ])
    })

    it("adds the sum of the gaps to the strip, and leaves a card with nothing planned without a block", async () => {
      await show()
      expect(screen.getByText("a month in fixed fees").closest("div")).toHaveTextContent("€2,400 not invoiced yet")
      expect(within(card("Giulia Neri")).queryByRole("group", { name: "Invoiced against plan" })).not.toBeInTheDocument()
    })

    it("says All invoiced when every month is covered", async () => {
      DATA.getCompanyExpenses = [
        invoice("a", "verdi", "2026-07", 2400, "11/2026"), invoice("b", "verdi", "2026-08", 2400, "12/2026"), invoice("c", "verdi", "2026-09", 2400, "14/2026"),
      ]
      await show()
      expect(within(card("Studio Verdi")).getByRole("group", { name: "Invoiced against plan" })).toHaveTextContent("All invoiced")
      expect(screen.getByText("a month in fixed fees").closest("div")).not.toHaveTextContent("not invoiced yet")
    })

    it("reads Q4 so far once one of its months has ended", async () => {
      vi.setSystemTime(new Date(2026, 10, 15))
      DATA.getCompanyExpenses = [invoice("o", "verdi", "2026-10", 2400, "15/2026")]
      await show()
      const block = within(card("Studio Verdi")).getByRole("group", { name: "Invoiced against plan" })
      expect(block).toHaveTextContent("Q4 so far: invoiced €2,400 of €2,400")
      expect(within(block).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Oct · 15/2026€2,400 ✓"])
    })

    it("keeps last quarter's open gap in view once the new quarter has an ended month", async () => {
      vi.setSystemTime(new Date(2026, 10, 15))
      DATA.getCompanyExpenses = [
        invoice("a", "verdi", "2026-07", 2400, "11/2026"), invoice("b", "verdi", "2026-08", 2400, "12/2026"), invoice("o", "verdi", "2026-10", 2400, "15/2026"),
      ]
      await show()
      const block = within(card("Studio Verdi")).getByRole("group", { name: "Invoiced against plan" })
      expect(block).toHaveTextContent("Q4 so far: invoiced €2,400 of €2,400")
      expect(block).toHaveTextContent("Q3: €2,400 not invoiced (Sep)")
      // Verdi's September plus Marco's October fee, which has no invoice either.
      expect(screen.getByText("a month in fixed fees").closest("div")).toHaveTextContent("€3,900 not invoiced yet")
    })

    it("shows the days logged on a month of variable work", async () => {
      DATA.getAssignments = [{ id: "a1", userId: "u1", collaboratorId: "giulia", engagementId: "e1", dailyRate: 320, from: "2026-09", until: null, defaultDays: 4, monthDays: {}, createdAt: at, updatedAt: at }]
      DATA.getTimecards = [1, 2, 3, 4].map((d) => ({ id: `t${d}`, engagementId: "e1", collaboratorId: "giulia", date: `2026-09-0${d}`, hours: 8 }))
      DATA.getCompanyExpenses = [invoice("g", "giulia", "2026-09", 1280, "9/2026")]
      await show()
      const block = within(card("Giulia Neri")).getByRole("group", { name: "Invoiced against plan" })
      expect(within(block).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Sep · 9/2026 · 4 days€1,280 ✓"])
      delete DATA.getAssignments
      delete DATA.getTimecards
    })
  })

  it.each([
    ["Studio Verdi", "Company", "Active", "€2,400 a month since Jan 2026 · €2,600 from Mar 2027 · no end", "€7,200", "Q4 2026, planned", "€7,400", "Q1 2027, the change in March"],
    ["Marco Bianchi", "Freelancer", "Active", "€1,500 a month from Oct 2026 · ends Mar 2027", "€4,500", "Q4 2026, planned", "€4,500", "Q1 2027, the last one"],
    ["Giulia Neri", "Freelancer", "Active", "No fixed fee", "€0", "Q4 2026, no fixed fee", "€0", "Q1 2027, no fixed fee"],
    ["Lab Nove Srl", "Company", "Inactive", "€900 a month · ended Jun 2026", "€0", "Q4 2026, fee ended", "Notes", "Design system work, 2025–26"],
  ])("draws %s as a card", async (name, type, pill, fee, thisQ, thisDetail, nextQ, nextDetail) => {
    await show()
    const c = card(name)
    expect(c).toHaveTextContent(type)
    expect(within(c).getByText(pill, { exact: true })).toBeInTheDocument()
    expect(c).toHaveTextContent(fee)
    expect(c).toHaveTextContent(`This quarter${thisQ}${thisDetail}`)
    expect(c).toHaveTextContent(`${nextQ === "Notes" ? "" : "Next quarter"}${nextQ}${nextDetail}`)
  })

  it("narrows the cards with the chips, each carrying its count", async () => {
    await show()
    expect(names()).toEqual(["Studio Verdi", "Marco Bianchi", "Giulia Neri", "Lab Nove Srl"])
    expect(screen.getByRole("tab", { name: "All 4" })).toBeInTheDocument()
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Inactive 1" }), { button: 0 })
    await waitFor(() => expect(names()).toEqual(["Lab Nove Srl"]))
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Active 3" }), { button: 0 })
    await waitFor(() => expect(names()).toEqual(["Studio Verdi", "Marco Bianchi", "Giulia Neri"]))
  })

  it("offers Edit Collaborator and Delete Collaborator behind More", async () => {
    await show()
    fireEvent.pointerDown(within(card("Giulia Neri")).getByRole("button", { name: "More actions for Giulia Neri" }), { button: 0, ctrlKey: false })
    expect(await screen.findByRole("menuitem", { name: "Edit Collaborator" })).toBeInTheDocument()
    expect(screen.getByRole("menuitem", { name: "Delete Collaborator" })).toBeInTheDocument()
  })

  it("deletes from the card's More menu after the confirmation", async () => {
    await show()
    fireEvent.pointerDown(within(card("Giulia Neri")).getByRole("button", { name: "More actions for Giulia Neri" }), { button: 0, ctrlKey: false })
    fireEvent.click(await screen.findByRole("menuitem", { name: "Delete Collaborator" }))
    const confirm = await screen.findByRole("alertdialog", { name: "Delete Collaborator" })
    expect(calls.some(([m]) => m === "deleteCollaborator")).toBe(false)
    fireEvent.click(within(confirm).getByRole("button", { name: "Delete" }))
    await waitFor(() => expect(calls.find(([m]) => m === "deleteCollaborator")?.[1]).toEqual(["u1", "giulia"]))
  })

  it("deletes from the edit dialog's Delete, after the same confirmation", async () => {
    await show()
    fireEvent.pointerDown(within(card("Marco Bianchi")).getByRole("button", { name: "More actions for Marco Bianchi" }), { button: 0, ctrlKey: false })
    fireEvent.click(await screen.findByRole("menuitem", { name: "Edit Collaborator" }))
    const dialog = await screen.findByRole("dialog", { name: "Edit Collaborator" })
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }))
    const confirm = await screen.findByRole("alertdialog", { name: "Delete Collaborator" })
    fireEvent.click(within(confirm).getByRole("button", { name: "Delete" }))
    await waitFor(() => expect(calls.find(([m]) => m === "deleteCollaborator")?.[1]).toEqual(["u1", "marco"]))
  })

  it("says so when there is none yet", async () => {
    DATA.getCollaborators = []
    cleanup()
    render(
      <QueryClientProvider client={new QueryClient()}>
        <CollaboratorsShell />
      </QueryClientProvider>,
    )
    expect(await screen.findByText("No collaborators yet")).toBeInTheDocument()
  })
})

describe("the New and Edit Collaborator dialog", () => {
  const openNew = async () => {
    await show()
    fireEvent.click(screen.getByRole("button", { name: "New Collaborator" }))
    return screen.findByRole("dialog", { name: "New Collaborator" })
  }

  it("saves a company with a fee and a change, changes oldest first", async () => {
    const dialog = await openNew()
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "  Atelier Rossi " } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Company" }))
    fireEvent.click(within(dialog).getByRole("switch", { name: "A fee every month" }))
    fireEvent.change(within(dialog).getByLabelText("A month"), { target: { value: "1200" } })
    fireEvent.change(within(dialog).getByLabelText("From"), { target: { value: "2026-11" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Add Change" }))
    fireEvent.change(within(dialog).getByLabelText("Change From"), { target: { value: "2027-06" } })
    fireEvent.change(within(dialog).getByLabelText("New Amount a Month"), { target: { value: "1400" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Save Change" }))
    fireEvent.click(within(dialog).getByRole("button", { name: "Add Change" }))
    fireEvent.change(within(dialog).getByLabelText("Change From"), { target: { value: "2027-02" } })
    fireEvent.change(within(dialog).getByLabelText("New Amount a Month"), { target: { value: "1300" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Save Change" }))
    expect(within(dialog).getAllByText(/^From /).map((n) => n.textContent)).toEqual(["From Feb 2027", "From Jun 2027"])

    fireEvent.click(within(dialog).getByRole("button", { name: "Create Collaborator" }))
    await waitFor(() => expect(calls.find(([m]) => m === "createCollaborator")).toBeDefined())
    expect(calls.find(([m]) => m === "createCollaborator")![1]).toEqual([
      "u1",
      {
        name: "Atelier Rossi", type: "company", notes: null, isActive: true,
        fee: { amount: 1200, from: "2026-11", until: null, changes: [{ from: "2027-02", amount: 1300 }, { from: "2027-06", amount: 1400 }] },
      },
    ])
  })

  it("names what is wrong in English and saves nothing", async () => {
    const dialog = await openNew()
    fireEvent.click(within(dialog).getByRole("button", { name: "Create Collaborator" }))
    expect(await within(dialog).findByText("Name is required")).toBeInTheDocument()
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Late Co" } })
    fireEvent.click(within(dialog).getByRole("switch", { name: "A fee every month" }))
    fireEvent.change(within(dialog).getByLabelText("From"), { target: { value: "2026-06" } })
    fireEvent.change(within(dialog).getByLabelText("Until"), { target: { value: "2026-01" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Create Collaborator" }))
    expect(await within(dialog).findByText("The fee is more than 0")).toBeInTheDocument()
    expect(within(dialog).getByText("The end is before the start")).toBeInTheDocument()
    expect(calls.some(([m]) => m === "createCollaborator")).toBe(false)
  })

  it("refuses a change that is not after the start, under Changes", async () => {
    const dialog = await openNew()
    fireEvent.click(within(dialog).getByRole("switch", { name: "A fee every month" }))
    fireEvent.change(within(dialog).getByLabelText("A month"), { target: { value: "1000" } })
    fireEvent.change(within(dialog).getByLabelText("From"), { target: { value: "2026-06" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Add Change" }))
    fireEvent.change(within(dialog).getByLabelText("Change From"), { target: { value: "2026-06" } })
    fireEvent.change(within(dialog).getByLabelText("New Amount a Month"), { target: { value: "1100" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Save Change" }))
    expect(await within(dialog).findByText("A change starts after the fee does")).toBeInTheDocument()
    expect(within(dialog).queryByRole("button", { name: /^Remove the change/ })).toBeNull()
  })

  it("edits with its changes listed and previews the quarter, the year and the Plan's net", async () => {
    await show()
    fireEvent.pointerDown(within(card("Studio Verdi")).getByRole("button", { name: "More actions for Studio Verdi" }), { button: 0, ctrlKey: false })
    fireEvent.click(await screen.findByRole("menuitem", { name: "Edit Collaborator" }))
    const dialog = await screen.findByRole("dialog", { name: "Edit Collaborator" })
    expect(within(dialog).getByLabelText("A month")).toHaveValue(2400)
    expect(within(dialog).getByText("From Mar 2027")).toBeInTheDocument()
    expect(within(dialog).getByText("€2,600 a month")).toBeInTheDocument()
    // Studio Verdi and Marco Bianchi over Oct 2026 to Sep 2027: 12,000 + 18,200 + 9,000, and no revenue.
    expect(within(dialog).getByLabelText("Fixed cost preview")).toHaveTextContent("Q4 2026 €7,200 · 2026 €28,800 · Plan net, next 12 months -€39,200")

    fireEvent.click(within(dialog).getByRole("button", { name: "Remove the change from Mar 2027" }))
    expect(within(dialog).getByLabelText("Fixed cost preview")).toHaveTextContent("Plan net, next 12 months -€37,800")
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }))
    await waitFor(() => expect(calls.find(([m]) => m === "updateCollaborator")).toBeDefined())
    expect(calls.find(([m]) => m === "updateCollaborator")![1]).toEqual([
      "u1", "verdi",
      {
        name: "Studio Verdi", type: "company", notes: "UX and front-end.", isActive: true,
        fee: { amount: 2400, from: "2026-01", until: null, changes: [] },
      },
    ])
  })

  it("refuses to save while a change is typed but not saved, under Changes", async () => {
    const dialog = await openNew()
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Atelier Rossi" } })
    fireEvent.click(within(dialog).getByRole("switch", { name: "A fee every month" }))
    fireEvent.change(within(dialog).getByLabelText("A month"), { target: { value: "1200" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Add Change" }))
    fireEvent.change(within(dialog).getByLabelText("Change From"), { target: { value: "2027-06" } })
    fireEvent.change(within(dialog).getByLabelText("New Amount a Month"), { target: { value: "1400" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Create Collaborator" }))
    const message = await within(dialog).findByText("Save or cancel the change first")
    expect(calls.some(([m]) => m === "createCollaborator")).toBe(false)
    for (const label of ["Change From", "New Amount a Month"]) {
      const input = within(dialog).getByLabelText(label)
      expect(input).toHaveAttribute("aria-invalid", "true")
      expect(input).toHaveAttribute("aria-describedby", message.id)
    }

    // Cancel Change drops what was typed, and saving goes through.
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel Change" }))
    fireEvent.click(within(dialog).getByRole("button", { name: "Create Collaborator" }))
    await waitFor(() => expect(calls.find(([m]) => m === "createCollaborator")).toBeDefined())
  })

  it("previews nothing for the quarter and the year when Active is off, as the card does", async () => {
    await show()
    fireEvent.pointerDown(within(card("Studio Verdi")).getByRole("button", { name: "More actions for Studio Verdi" }), { button: 0, ctrlKey: false })
    fireEvent.click(await screen.findByRole("menuitem", { name: "Edit Collaborator" }))
    const dialog = await screen.findByRole("dialog", { name: "Edit Collaborator" })
    fireEvent.click(within(dialog).getByRole("switch", { name: "Active" }))
    expect(within(dialog).getByLabelText("Fixed cost preview")).toHaveTextContent("Q4 2026 €0 · 2026 €0 · Plan net, next 12 months -€9,000")
  })
})
