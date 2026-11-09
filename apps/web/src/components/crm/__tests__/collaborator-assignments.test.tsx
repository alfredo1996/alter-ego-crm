/**
 * A collaborator on a contract, over a fixed clock (15 Oct 2026): the card's assignment line, usage
 * and quarter figures with the variable cost in them; the Edit Collaborator dialog's On Contracts
 * section (assign, edit, remove); the preview of the quarter's planned cost and margin.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

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
const engagement = (id: string, clientId: string, name: string, extra: Record<string, unknown> = {}) => ({
  id, userId: "u1", clientId, name, opportunityId: null, dailyRate: 520, vatApplicable: true, contractedDays: 80,
  defaultDaysPerMonth: 8, startMonth: "2026-09", endMonth: null, endDate: null, isActive: true, notes: null, createdAt: at, updatedAt: at, ...extra,
})
const assignment = {
  id: "a1", userId: "u1", collaboratorId: "giulia", engagementId: "e1", dailyRate: 320, from: "2026-09", until: "2027-02",
  defaultDays: 4, monthDays: { "2026-11": 6 }, createdAt: at, updatedAt: at,
}
const hours = (collaboratorId: string | null, date: string, h: number) => ({
  id: `e1_${date}${collaboratorId ? `_${collaboratorId}` : ""}`, userId: "u1", engagementId: "e1", collaboratorId, date, hours: h, notes: null, createdAt: at, updatedAt: at,
})

beforeAll(() => vi.setSystemTime(new Date(2026, 9, 15)))
afterAll(() => vi.useRealTimers())
beforeEach(() => {
  calls.length = 0
  for (const k of Object.keys(DATA)) delete DATA[k]
  DATA.getCollaborators = [
    { id: "giulia", userId: "u1", name: "Giulia Neri", type: "freelancer", notes: null, isActive: true, fee: null, createdAt: at, updatedAt: at },
  ]
  DATA.getClients = [
    { id: "c1", userId: "u1", name: "Nordwind", vatNumber: null, email: null, contactName: null, contactPhone: null, notes: null, isActive: true, createdAt: at, updatedAt: at },
  ]
  DATA.getEngagements = [engagement("e1", "c1", "Product Graph"), engagement("e2", "c1", "Retainer", { dailyRate: 450 })]
  DATA.getAssignments = [assignment]
  // Her 3 days in October (8 h each is a day) and the owner's 5: usage counts hers only.
  DATA.getTimecards = [hours("giulia", "2026-09-02", 32), hours("giulia", "2026-10-05", 24), hours(null, "2026-10-05", 40)]
})

async function show() {
  cleanup()
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <CollaboratorsShell />
    </QueryClientProvider>,
  )
  return screen.findByRole("article", { name: "Giulia Neri" })
}
const openEdit = async () => {
  const card = await show()
  fireEvent.pointerDown(within(card).getByRole("button", { name: "More actions for Giulia Neri" }), { button: 0, ctrlKey: false })
  fireEvent.click(await screen.findByRole("menuitem", { name: "Edit Collaborator" }))
  return screen.findByRole("dialog", { name: "Edit Collaborator" })
}

describe("a collaborator's card with an assignment", () => {
  it("says where she is and what she has used, and adds her variable cost to the quarter", async () => {
    const card = await show()
    expect(card).toHaveTextContent("On Nordwind · Product Graph at €320/day, Sep 2026 to Feb 2027")
    expect(card).toHaveTextContent("7 of 26 days used · 19 left · this month 3 of 4")
    // Q4: Oct 4 + Nov 6 + Dec 4 = 14 days × €320; Q1 2027: Jan 4 + Feb 4 = 8 days × €320.
    expect(card).toHaveTextContent("This quarter€4,480Q4 2026, 14 days planned")
    expect(card).toHaveTextContent("Next quarter€2,560Q1 2027, 8 days planned")
  })

  it("flags a month logged above its plan as over, in words", async () => {
    DATA.getTimecards = [hours("giulia", "2026-10-05", 40)]
    const card = await show()
    expect(card).toHaveTextContent("this month 5 of 4 · over this month")
  })
})

describe("the On Contracts section of the Edit Collaborator dialog", () => {
  it("lists her assignment with its rate, run, days, what the client pays and its usage, and the quarter's cost and margin", async () => {
    const dialog = await openEdit()
    expect(dialog).toHaveTextContent("Nordwind · Product Graph")
    expect(dialog).toHaveTextContent("€320/day · Sep 2026 to Feb 2027 · 4 days a month, 6 in Nov · the client pays €520/day")
    expect(dialog).toHaveTextContent("7 of 26 days used · 19 left")
    // 14 days at €320 = €4,480; the client is billed 14 × €520 = €7,280: €2,800 of margin on her days.
    expect(within(dialog).getByLabelText("Variable cost preview")).toHaveTextContent("Q4 2026 planned €4,480 (14 days) · margin on their days €2,800")
  })

  it("removes an assignment", async () => {
    const dialog = await openEdit()
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove the assignment on Nordwind · Product Graph" }))
    await waitFor(() => expect(calls.find(([m]) => m === "deleteAssignment")?.[1]).toEqual(["u1", "a1"]))
  })

  it("edits the rate and days and keeps the contract and the month overrides", async () => {
    const dialog = await openEdit()
    fireEvent.click(within(dialog).getByRole("button", { name: "Edit the assignment on Nordwind · Product Graph" }))
    const form = within(dialog).getByRole("group", { name: "Edit assignment" })
    fireEvent.change(within(form).getByLabelText("A Day"), { target: { value: "300" } })
    fireEvent.change(within(form).getByLabelText("Days a Month"), { target: { value: "5" } })
    fireEvent.click(within(form).getByRole("button", { name: "Save Assignment" }))
    await waitFor(() => expect(calls.find(([m]) => m === "updateAssignment")?.[1]).toEqual(["u1", "a1", { dailyRate: 300, from: "2026-09", until: "2027-02", defaultDays: 5 }]))
  })

  it("assigns her to another contract: a rate, a start, days a month; the contract she is on is not offered", async () => {
    const dialog = await openEdit()
    fireEvent.click(within(dialog).getByRole("button", { name: "Assign to Contract" }))
    const form = within(dialog).getByRole("group", { name: "New assignment" })
    fireEvent.click(within(form).getByRole("combobox", { name: "Contract" }))
    expect(screen.queryByRole("option", { name: "Nordwind · Product Graph" })).not.toBeInTheDocument()
    fireEvent.click(await screen.findByRole("option", { name: /Nordwind · Retainer|Nordwind · 8 days/ }))
    fireEvent.change(within(form).getByLabelText("A Day"), { target: { value: "280" } })
    fireEvent.change(within(form).getByLabelText("Days a Month"), { target: { value: "2" } })
    fireEvent.change(within(form).getByLabelText("Assignment From"), { target: { value: "2026-11" } })
    // The client pays €450 a day: €170 of margin on each of her days, 38%.
    expect(within(form).getByRole("status")).toHaveTextContent("Nordwind bills €450/day: €170 a day of margin on their days, 38%.")
    fireEvent.click(within(form).getByRole("button", { name: "Add Assignment" }))
    await waitFor(() =>
      expect(calls.find(([m]) => m === "createAssignment")?.[1]).toEqual([
        "u1",
        { collaboratorId: "giulia", engagementId: "e2", dailyRate: 280, from: "2026-11", until: null, defaultDays: 2 },
      ]),
    )
  })

  it("refuses a missing rate with its message and writes nothing", async () => {
    const dialog = await openEdit()
    fireEvent.click(within(dialog).getByRole("button", { name: "Assign to Contract" }))
    const form = within(dialog).getByRole("group", { name: "New assignment" })
    fireEvent.click(within(form).getByRole("button", { name: "Add Assignment" }))
    expect(await within(form).findByRole("alert")).toHaveTextContent("Pick a contract")
    expect(calls.some(([m]) => m === "createAssignment")).toBe(false)
  })

  const fillNew = async (dialog: HTMLElement) => {
    fireEvent.click(within(dialog).getByRole("button", { name: "Assign to Contract" }))
    const form = within(dialog).getByRole("group", { name: "New assignment" })
    fireEvent.click(within(form).getByRole("combobox", { name: "Contract" }))
    fireEvent.click(await screen.findByRole("option", { name: /Nordwind · Retainer|Nordwind · 8 days/ }))
    fireEvent.change(within(form).getByLabelText("A Day"), { target: { value: "280" } })
    fireEvent.change(within(form).getByLabelText("Days a Month"), { target: { value: "2" } })
    return form
  }

  it("Enter in an assignment field saves the assignment, not the collaborator", async () => {
    const dialog = await openEdit()
    const form = await fillNew(dialog)
    fireEvent.keyDown(within(form).getByLabelText("Days a Month"), { key: "Enter" })
    await waitFor(() => expect(calls.some(([m]) => m === "createAssignment")).toBe(true))
    expect(calls.some(([m]) => m === "updateCollaborator")).toBe(false)
    expect(screen.getByRole("dialog", { name: "Edit Collaborator" })).toBeInTheDocument()
  })

  it("Save on the dialog with an assignment typed and not saved refuses, and writes nothing", async () => {
    const dialog = await openEdit()
    await fillNew(dialog)
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }))
    expect(await within(dialog).findByText("Save or cancel the assignment first")).toBeInTheDocument()
    expect(calls.some(([m]) => m === "updateCollaborator" || m === "createAssignment")).toBe(false)
  })

  it("an hourly contract asks for hours a month and stores days", async () => {
    DATA.getEngagements = [engagement("e1", "c1", "Product Graph"), engagement("e2", "c1", "Support", { unit: "hour", dailyRate: 600 })]
    const dialog = await openEdit()
    fireEvent.click(within(dialog).getByRole("button", { name: "Assign to Contract" }))
    const form = within(dialog).getByRole("group", { name: "New assignment" })
    fireEvent.click(within(form).getByRole("combobox", { name: "Contract" }))
    fireEvent.click(await screen.findByRole("option", { name: /Nordwind · Support|Nordwind · 8 days/ }))
    fireEvent.change(within(form).getByLabelText("An Hour"), { target: { value: "40" } })
    fireEvent.change(within(form).getByLabelText("Hours a Month"), { target: { value: "16" } })
    fireEvent.click(within(form).getByRole("button", { name: "Add Assignment" }))
    await waitFor(() => expect(calls.find(([m]) => m === "createAssignment")?.[1]).toEqual(["u1", expect.objectContaining({ dailyRate: 320, defaultDays: 2 })]))
  })
})

describe("usage when the contract bills less than her plan", () => {
  it("counts what the contract leaves her: 2 days a month for Oct to Feb, not her 4", async () => {
    DATA.getEngagements = [engagement("e1", "c1", "Product Graph", { defaultDaysPerMonth: 2 }), engagement("e2", "c1", "Retainer", { dailyRate: 450 })]
    const card = await show()
    // Sep (before the plan cells) 4, Oct-Feb 2 each = 14; 7 used.
    expect(card).toHaveTextContent("7 of 14 days used · 7 left · this month 3 of 2 · over this month")
  })

  it("an assignment and contract with no end say what is used, with no total", async () => {
    DATA.getAssignments = [{ ...assignment, until: null }]
    const card = await show()
    expect(card).toHaveTextContent("7 days used · this month 3 of 4")
    DATA.getTimecards = [hours("giulia", "2026-10-05", 8)]
    expect(await show()).toHaveTextContent("1 day used · this month 1 of 4")
    expect(card).not.toHaveTextContent(" left ·")
  })
})
