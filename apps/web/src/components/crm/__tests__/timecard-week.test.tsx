/**
 * The week of hours on /plan over a fixed clock (Tue 15 Sep 2026). A cell's note: the rules
 * are noteEdit's (lib/__tests__/timecards.test.ts); this checks the cell writes
 * them as the same hours with the new note. The week's result: the sums are
 * weekResult's; this checks where they show. The flow end to end is in
 * e2e/hours.spec.ts.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { TimecardWeek } from "../timecard-week"

const at = new Date(2026, 8, 1)
const timecard = (engagementId: string, date: string, hours: number, notes: string | null) => (
  { id: `${engagementId}_${date}`, userId: "u1", engagementId, date, hours, notes, createdAt: at, updatedAt: at }
)
const contract = (id: string, name: string, endDate: string | null) => ({
  id, userId: "u1", clientId: "c1", name, opportunityId: null, dailyRate: 500, vatApplicable: true,
  contractedDays: null, defaultDaysPerMonth: 10, startMonth: null, endMonth: endDate?.slice(0, 7) ?? null, endDate,
  isActive: endDate === null, notes: null, createdAt: at, updatedAt: at,
})
const DATA: Record<string, unknown> = {
  getClients: [
    {
      id: "c1", userId: "u1", name: "Acme", vatNumber: null, email: null, contactName: null,
      contactPhone: null, notes: null, isActive: true, createdAt: at, updatedAt: at,
    },
  ],
  // Ended closes on Monday: the hours after it stay, for clearing only.
  getEngagements: [contract("e1", "Platform", null), contract("e2", "Ended", "2026-09-14")],
  getTimecards: [
    timecard("e1", "2026-09-14", 6, "Kickoff"),
    timecard("e1", "2026-09-15", 4, null),
    timecard("e2", "2026-09-15", 2, "Handover"),
    timecard("e2", "2026-09-16", 3, null),
  ],
}
const setTimecard = vi.fn()

vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { id: "u1" } }) }))
let search = new URLSearchParams()
vi.mock("next/navigation", () => ({ useSearchParams: () => search }))
vi.mock("@/lib/backend", () => ({
  getBackend: () => ({
    db: new Proxy(
      {},
      {
        get: (_db, method) =>
          method === "setTimecard" ? setTimecard : () => Promise.resolve(DATA[String(method)] ?? []),
      },
    ),
  }),
}))

// Date only: fake timers would stall TanStack and findBy.
beforeAll(() => vi.setSystemTime(new Date(2026, 8, 15, 12)))
afterAll(() => vi.useRealTimers())
// Braces: a function returned from beforeEach runs as its cleanup, and this one is the mock.
beforeEach(() => {
  setTimecard.mockReset().mockResolvedValue({})
  search = new URLSearchParams()
})

function renderGrid() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <TimecardWeek />
    </QueryClientProvider>,
  )
}

const note = (contract: string, day: string) => screen.findByRole("button", { name: `Note for Acme · ${contract}, ${day}` })
const hours = (contract: string, day: string) =>
  screen.findByRole("textbox", { name: new RegExp(`^Acme · ${contract}, ${day}`) })

describe("the week's result cards", () => {
  const saved = { getEngagements: DATA.getEngagements, getTimecards: DATA.getTimecards }
  afterEach(() => void Object.assign(DATA, saved))
  const week = async () => within(await screen.findByRole("region", { name: "Week result" }))

  it("count a week of hourly contracts in hours alone", async () => {
    DATA.getEngagements = [{ ...contract("e1", "Platform", null), unit: "hour" }]
    DATA.getTimecards = [timecard("e1", "2026-09-14", 6, null), timecard("e1", "2026-09-15", 4, null)]
    renderGrid()
    const cards = await week()
    expect(cards.getByText("10 h")).toBeInTheDocument()
    expect(cards.getByText("€625.00")).toBeInTheDocument() // 10 h at €500 / 8, no day count beside it
    expect(cards.getByText("Planned").nextElementSibling).toHaveTextContent(/^[\d.]+ h$/)
    expect(screen.getByRole("region", { name: "Week result" }).textContent).not.toMatch(/ d\b/)
  })

  it("keep the days beside a day contract's hours", async () => {
    renderGrid()
    expect(await week()).toBeTruthy()
    expect(screen.getByRole("region", { name: "Week result" }).textContent).toMatch(/\d d · €/)
  })
})

describe("what is left on a contract", () => {
  const saved = { getEngagements: DATA.getEngagements, getTimecards: DATA.getTimecards }
  afterEach(() => void Object.assign(DATA, saved))

  it("moves while an hour is typed, before it is saved", async () => {
    // 100 h: 6 h and 4 h worked up to today.
    DATA.getEngagements = [{ ...contract("e1", "Platform", null), unit: "hour", contractedDays: 12.5 }]
    DATA.getTimecards = [timecard("e1", "2026-09-14", 6, null), timecard("e1", "2026-09-15", 4, null)]
    renderGrid()
    const row = await screen.findByRole("rowheader", { name: /Platform/ })
    expect(row).toHaveTextContent("90 h left of 100")
    fireEvent.change(await hours("Platform", "Tuesday 15 Sep"), { target: { value: "8" } })
    expect(row).toHaveTextContent("86 h left of 100")
    // An odd number of hours stays exact: 6 + 7 worked leaves 87 h, not 86.96.
    fireEvent.change(await hours("Platform", "Tuesday 15 Sep"), { target: { value: "7" } })
    expect(row).toHaveTextContent("87 h left of 100")
    expect(setTimecard).not.toHaveBeenCalled()
    // A later day is the plan, not worked: left stays.
    fireEvent.change(await hours("Platform", "Wednesday 16 Sep"), { target: { value: "2" } })
    expect(row).toHaveTextContent("87 h left of 100")
  })

  it("reads a contract with no budget as no cap", async () => {
    renderGrid()
    expect(await screen.findByRole("rowheader", { name: /Platform/ })).toHaveTextContent("No cap · 1.25 d worked")
  })
})

describe("a cell's note", () => {
  it("needs hours on the day", async () => {
    renderGrid()
    const wednesday = await note("Platform", "Wednesday 16 Sep")
    expect(wednesday).toBeDisabled()
    expect(wednesday).toHaveAttribute("title", "Log hours first")
  })

  it("opens on the stored note and saves the edit on the same hours", async () => {
    renderGrid()
    fireEvent.click(await note("Platform", "Monday 14 Sep"))
    const text = screen.getByLabelText("Note")
    expect(text).toHaveValue("Kickoff")
    fireEvent.change(text, { target: { value: "Kickoff, then planning" } })
    fireEvent.click(screen.getByRole("button", { name: "Save" }))
    await waitFor(() => expect(screen.queryByLabelText("Note")).toBeNull())
    expect(setTimecard).toHaveBeenCalledWith("u1", {
      engagementId: "e1", date: "2026-09-14", hours: 6, notes: "Kickoff, then planning",
    })
  })

  it("clears with empty text, as null", async () => {
    renderGrid()
    fireEvent.click(await note("Platform", "Monday 14 Sep"))
    fireEvent.change(screen.getByLabelText("Note"), { target: { value: "" } })
    fireEvent.click(screen.getByRole("button", { name: "Save" }))
    await waitFor(() => expect(setTimecard).toHaveBeenCalledWith("u1", {
      engagementId: "e1", date: "2026-09-14", hours: 6, notes: null,
    }))
  })

  it("counts down near the 1000 characters it holds", async () => {
    renderGrid()
    fireEvent.click(await note("Platform", "Tuesday 15 Sep"))
    const text = screen.getByLabelText("Note")
    expect(text).toHaveAttribute("maxLength", "1000")
    expect(screen.queryByText("950 / 1000")).toBeNull()
    fireEvent.change(text, { target: { value: "x".repeat(950) } })
    expect(screen.getByText("950 / 1000")).toBeInTheDocument()
  })

  it("on a day past the contract's end, says why up front: a note is read and cleared, never added", async () => {
    renderGrid()
    const empty = await note("Ended", "Wednesday 16 Sep")
    expect(empty).toBeDisabled()
    expect(empty).toHaveAttribute("title", "The contract has ended before this day.")

    fireEvent.click(await note("Ended", "Tuesday 15 Sep"))
    const text = screen.getByLabelText("Note")
    expect(text).toHaveValue("Handover")
    expect(text).toHaveAttribute("readonly")
    expect(text).toHaveAccessibleDescription("The contract has ended before this day. The note can be read or cleared.")
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Clear Note" }))
    await waitFor(() => expect(setTimecard).toHaveBeenCalledWith("u1", {
      engagementId: "e2", date: "2026-09-15", hours: 2, notes: null,
    }))
  })

  it("is out of the Tab order and opens with Alt+Enter from the day", async () => {
    renderGrid()
    expect(await note("Platform", "Monday 14 Sep")).toHaveAttribute("tabindex", "-1")
    fireEvent.keyDown(await hours("Platform", "Monday 14 Sep"), { key: "Enter", altKey: true })
    expect(await screen.findByLabelText("Note")).toHaveValue("Kickoff")
  })

  it("holds the day's hours read-only while the note saves", async () => {
    let land = () => {}
    setTimecard.mockReturnValue(new Promise((resolve) => (land = () => resolve({}))))
    renderGrid()
    const monday = await hours("Platform", "Monday 14 Sep")
    fireEvent.click(await note("Platform", "Monday 14 Sep"))
    fireEvent.change(screen.getByLabelText("Note"), { target: { value: "Retro" } })
    fireEvent.click(screen.getByRole("button", { name: "Save" }))
    await waitFor(() => expect(monday).toHaveAttribute("readonly"))
    expect(monday).toHaveAttribute("aria-busy", "true")
    land()
    await waitFor(() => expect(monday).not.toHaveAttribute("readonly"))
  })

  it("keeps the text open when the save fails", async () => {
    setTimecard.mockRejectedValue(new Error("offline"))
    renderGrid()
    fireEvent.click(await note("Platform", "Tuesday 15 Sep"))
    fireEvent.change(screen.getByLabelText("Note"), { target: { value: "Standup" } })
    fireEvent.click(screen.getByRole("button", { name: "Save" }))
    await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeEnabled())
    expect(screen.getByLabelText("Note")).toHaveValue("Standup")
  })
})

describe("the week's result", () => {
  // Platform: 6 + 4 h worked at €500. Ended: 2 h worked (Tue), 3 h scheduled (Wed, after today).
  // One card per figure: label, value, detail, in that order.
  const card = async (label: string) => {
    const region = within(await screen.findByRole("region", { name: "Week result" }))
    return [...(region.getByText(label, { exact: true }).parentElement?.children ?? [])].map((c) => c.textContent)
  }

  it("shows the worked and the scheduled hours at the contracts' rates as cards", async () => {
    renderGrid()
    expect(await card("Worked")).toEqual(["Worked", "12 h", "1.5 d · €750.00"])
    expect(await card("Scheduled")).toEqual(["Scheduled", "3 h", "0.38 d · €187.50, on Wednesday"])
    expect(await card("Worked incl. VAT")).toEqual(["Worked incl. VAT", "€915.00", "€750.00 plus VAT"])
  })

  it("steps by links, the week's own label under the heading", async () => {
    renderGrid()
    expect(await screen.findByRole("heading", { name: "This Week" })).toBeInTheDocument()
    expect(screen.getByText("Week 38 · 14 Sep – 20 Sep 2026")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Previous week" })).toHaveAttribute("href", "/plan?week=2026-09-07")
    expect(screen.getByRole("link", { name: "Next week" })).toHaveAttribute("href", "/plan?week=2026-09-21")
  })

  it("gives each row one Total in hours, with what is scheduled under it; the week's is worked hours, days and euros, then what is scheduled", async () => {
    renderGrid()
    const total = async (header: string) =>
      (await screen.findByRole("rowheader", { name: header })).closest("tr")?.lastElementChild
    expect(await total("Acme · Platform")).toHaveTextContent(/^10 h$/)
    expect(await total("Acme · Ended · closed")).toHaveTextContent(/^2 h3 h scheduled$/)
    expect(await total("Total")).toHaveTextContent(/^12 h1\.5 d€750\.00.*3 h scheduled · \+€187\.50 sch\.$/)
  })
})

describe("a contract with a collaborator on it", () => {
  const saved = { ...DATA }
  afterEach(() => void Object.assign(DATA, saved))
  const giulia = {
    id: "g", userId: "u1", name: "Giulia Neri", type: "freelancer", notes: null, isActive: true, fee: null, createdAt: at, updatedAt: at,
  }
  const assignment = (engagementId: string) => ({
    id: `a-${engagementId}`, userId: "u1", collaboratorId: "g", engagementId, dailyRate: 320, from: "2026-09", until: null,
    defaultDays: 4, monthDays: {}, createdAt: at, updatedAt: at,
  })
  const hers = (engagementId: string, date: string, h: number) => ({
    ...timecard(engagementId, date, h, null), id: `${engagementId}_${date}_g`, collaboratorId: "g",
  })
  const setup = () => {
    DATA.getCollaborators = [giulia]
    DATA.getAssignments = [assignment("e1")]
    DATA.getEngagements = [contract("e1", "Platform", null), contract("e3", "Support", null)]
    // Mon 14: your 6 h and her 8 h on Platform; Tue 15: your 4 h.
    DATA.getTimecards = [
      { ...timecard("e1", "2026-09-14", 6, null), collaboratorId: null },
      { ...timecard("e1", "2026-09-15", 4, null), collaboratorId: null },
      hers("e1", "2026-09-14", 8),
    ]
  }

  it("shows You and her under the contract, her with her rate; a contract with nobody assigned keeps one row", async () => {
    setup()
    renderGrid()
    expect(await screen.findByRole("rowheader", { name: "Acme · Platform · You" })).toBeInTheDocument()
    expect(screen.getByRole("rowheader", { name: "Acme · Platform · Giulia Neri" })).toHaveTextContent("Giulia Neri€320/day")
    expect(screen.queryByRole("rowheader", { name: /Support · You/ })).toBeNull()
    expect(screen.getByRole("rowheader", { name: "Acme · Support" })).toBeInTheDocument()
  })

  it("totals both on the contract's row, and reads each person's cells", async () => {
    setup()
    renderGrid()
    const contractRow = (await screen.findByRole("rowheader", { name: "Acme · Platform" })).closest("tr")!
    // Mon 6 + 8 = 14 h, Tue 4 h; 18 h in the week.
    expect(within(contractRow).getAllByRole("cell").map((c) => c.textContent).slice(0, 2)).toEqual(["14 h", "4 h"])
    expect(contractRow.lastElementChild).toHaveTextContent("18 h")
    expect(await hours("Platform · Giulia Neri", "Monday 14 Sep")).toHaveValue("8")
    expect(await hours("Platform · You", "Monday 14 Sep")).toHaveValue("6")
  })

  it("logs her day on her own row, as her document, and leaves yours alone", async () => {
    setup()
    renderGrid()
    const cell = await hours("Platform · Giulia Neri", "Tuesday 15 Sep")
    fireEvent.change(cell, { target: { value: "7" } })
    fireEvent.blur(cell)
    await waitFor(() =>
      expect(setTimecard).toHaveBeenCalledWith("u1", { engagementId: "e1", date: "2026-09-15", hours: 7, collaboratorId: "g" }),
    )
    expect(setTimecard).toHaveBeenCalledTimes(1)
  })

  it("logs yours with no person, as before", async () => {
    setup()
    renderGrid()
    const cell = await hours("Platform · You", "Wednesday 16 Sep")
    fireEvent.change(cell, { target: { value: "5" } })
    fireEvent.blur(cell)
    await waitFor(() => expect(setTimecard).toHaveBeenCalledWith("u1", { engagementId: "e1", date: "2026-09-16", hours: 5 }))
  })

  it("counts the 8 hours of a day per person: her 8 h and your 8 h are not 16", async () => {
    setup()
    renderGrid()
    const cell = await hours("Platform · You", "Monday 14 Sep")
    fireEvent.change(cell, { target: { value: "8" } })
    fireEvent.blur(cell)
    await waitFor(() => expect(setTimecard).toHaveBeenCalledWith("u1", { engagementId: "e1", date: "2026-09-14", hours: 8 }))
    expect(screen.queryByRole("alert")).toBeNull()
  })

  it.each([
    ["Platform · You", "Tuesday 15 Sep", "That makes 9 h on this client in one day: more than 8."],
    ["Platform · Giulia Neri", "Tuesday 15 Sep", "That makes 9 h on this day across clients: more than 8."],
  ])("typing 9 on %s shows the reason and saves nothing", async (row, day, message) => {
    setup()
    renderGrid()
    const cell = await hours(row, day)
    fireEvent.change(cell, { target: { value: "9" } })
    fireEvent.blur(cell)
    expect(await screen.findByRole("alert")).toHaveTextContent(message)
    expect(setTimecard).not.toHaveBeenCalled()
  })

  it("budgets the contract on both people's hours", async () => {
    setup()
    DATA.getEngagements = [{ ...contract("e1", "Platform", null), contractedDays: 10 }, contract("e3", "Support", null)]
    renderGrid()
    // 6 + 4 + 8 = 18 h = 2.25 d of 10.
    expect(await screen.findByRole("rowheader", { name: "Acme · Platform" })).toHaveTextContent("7.75 d left of 10")
  })

  it("a client with two contracts, one of them with two people on it, says 2 contracts, not 3", async () => {
    setup()
    renderGrid()
    const group = await screen.findByRole("button", { name: /^Acme/ })
    expect(group).toHaveTextContent("Acme2 contracts")
  })

  it("the Worked card is your own hours, days and money; the collaborators' are one line apart", async () => {
    setup()
    renderGrid()
    const cards = within(await screen.findByRole("region", { name: "Week result" }))
    // Your 10 h (1.25 d) at €500 / 8 = €625; her 8 h = €500.
    expect(cards.getByText("Worked").nextElementSibling).toHaveTextContent("10 h")
    expect(cards.getByText("Worked").nextElementSibling?.nextElementSibling).toHaveTextContent("1.25 d · €625.00Collaborators: 8 h · €500.00")
  })
})

describe("the month's plan", () => {
  // The collaborator tests leave their people in DATA: start from none.
  const saved = { ...DATA, getCollaborators: [], getAssignments: [] }
  beforeEach(() => void Object.assign(DATA, saved))
  afterEach(() => {
    Object.assign(DATA, saved)
    vi.setSystemTime(new Date(2026, 8, 15, 12))
  })
  const type = async (name: string, day: string, value: string) => {
    const cell = await hours(name, day)
    fireEvent.change(cell, { target: { value } })
    fireEvent.blur(cell)
  }

  it("notes hours past the plan, saves them, and says nothing at the plan", async () => {
    // 16 h planned; 10 h are logged this month.
    DATA.getEngagements = [{ ...contract("e1", "Platform", null), defaultDaysPerMonth: 2 }]
    DATA.getTimecards = [timecard("e1", "2026-09-14", 6, null), timecard("e1", "2026-09-15", 4, null)]
    renderGrid()
    await type("Platform", "Wednesday 16 Sep", "6")
    await waitFor(() => expect(setTimecard).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole("status")).toBeNull()
    await type("Platform", "Thursday 17 Sep", "1")
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Acme · Platform, September: That is 17 h this month: past the plan's 16 h.",
    )
    expect(setTimecard).toHaveBeenCalledWith("u1", { engagementId: "e1", date: "2026-09-17", hours: 1 })
  })

  it("names the contract, not the person, so one warning serves everyone on it", async () => {
    DATA.getCollaborators = [
      { id: "g", userId: "u1", name: "Giulia Neri", type: "freelancer", notes: null, isActive: true, fee: null, createdAt: at, updatedAt: at },
    ]
    DATA.getAssignments = [
      { id: "a-e1", userId: "u1", collaboratorId: "g", engagementId: "e1", dailyRate: 320, from: "2026-09", until: null, defaultDays: 4, monthDays: {}, createdAt: at, updatedAt: at },
    ]
    DATA.getEngagements = [{ ...contract("e1", "Platform", null), defaultDaysPerMonth: 1 }]
    DATA.getTimecards = [timecard("e1", "2026-09-14", 6, null)]
    renderGrid()
    await type("Platform · Giulia Neri", "Tuesday 15 Sep", "4")
    const status = await screen.findByRole("status")
    expect(status).toHaveTextContent("Acme · Platform, September: That is 10 h this month: past the plan's 8 h.")
    expect(status).not.toHaveTextContent("Giulia")
  })

  it("reads a past month's plan as log_time does: a contract with no start still has its default", async () => {
    vi.setSystemTime(new Date(2026, 10, 7, 12))
    search = new URLSearchParams({ week: "2026-10-26" })
    DATA.getEngagements = [{ ...contract("e1", "Platform", null), defaultDaysPerMonth: 1 }]
    DATA.getTimecards = [timecard("e1", "2026-10-29", 6, null)]
    DATA.getAllocations = []
    renderGrid()
    await type("Platform", "Friday 30 Oct", "4")
    expect(await screen.findByRole("status")).toHaveTextContent("That is 10 h this month: past the plan's 8 h.")
    expect(setTimecard).toHaveBeenCalledWith("u1", { engagementId: "e1", date: "2026-10-30", hours: 4 })
  })

  it("counts a day's hours still saving, so two quick edits cannot pass 8 h", async () => {
    DATA.getEngagements = [contract("e1", "Platform", null), contract("e3", "Support", null)]
    DATA.getTimecards = []
    renderGrid()
    await type("Platform", "Monday 14 Sep", "5")
    await waitFor(() => expect(setTimecard).toHaveBeenCalledTimes(1))
    await type("Support", "Monday 14 Sep", "4")
    expect(await screen.findByRole("alert")).toHaveTextContent("That makes 9 h on this client in one day: more than 8.")
    expect(setTimecard).toHaveBeenCalledTimes(1)
  })
})
