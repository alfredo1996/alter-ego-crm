import { fireEvent, render, screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { QuartersSection } from "../quarters-section"

import type { ProjectionMonth } from "@/lib/projection"
import type { Collaborator, CompanyExpense, Invoice } from "@/types"

const invoice = (yearMonth: string, amount: number, fromMonth: string | null = null) =>
  ({ yearMonth, fromMonth, amount, clientId: null, engagementId: null, createdAt: new Date("2026-01-01") }) as Invoice
const cost = (date: string, amount: number) =>
  ({ id: date, isRecurring: false, date: new Date(date), amount }) as CompanyExpense
const plan = (yearMonth: string, revenue: number, costs: number): ProjectionMonth => ({ yearMonth, lines: [], revenue, costs, collaborators: 0, otherCosts: costs })

const today = new Date("2026-10-23T12:00:00")
const props = {
  today,
  invoices: [invoice("2026-02", 30000), invoice("2026-07", 10000)],
  engagements: [],
  timecards: [],
  expenses: [cost("2026-02-10", 10000), cost("2026-08-10", 2000)],
  plan: [plan("2026-10", 15000, 6000), plan("2026-11", 12000, 5000), plan("2026-12", 20000, 7000)],
}

const rows = () => within(screen.getByRole("table")).getAllByRole("row").map((r) => r.textContent)

describe("QuartersSection", () => {
  it("lists Q1 to Q4 and the year with revenue, costs, net and margin", () => {
    render(<QuartersSection {...props} />)
    expect(rows()).toEqual([
      "QuarterRevenueCollaboratorsOther costsNetMargin",
      "Q1Jan–MarClosed€30,000€0€10,000€20,00067%",
      "Q2Apr–JunClosed€0€0€0€0–",
      "Q3Jul–SepClosed€10,000€0€2,000€8,00080%",
      "Q4Oct–DecIn progress€47,000€0plan€18,000€29,00062%",
      "2026€87,000€0€30,000€57,00066%",
    ])
  })

  it("shows the three stat cards: current quarter at plan, year so far, year at plan", () => {
    render(<QuartersSection {...props} />)
    const stat = (label: string) => screen.getByText(label).nextElementSibling!.textContent
    expect(stat("Q4 · in progress")).toBe("€29,000")
    expect(stat("Year so far")).toBe("€28,000")
    expect(stat("Year at plan")).toBe("€57,000")
  })

  // The phone list: the quarter in progress first, then newest first; it leads with net and opens to its months.
  it("lists the phone cards current quarter first then newest first, the current one open", () => {
    render(<QuartersSection {...props} />)
    const cards = Array.from(screen.getByRole("list", { name: "Quarters" }).children)
    expect(cards.map((c) => c.querySelector("button")!.textContent)).toEqual([
      "Q4 · Oct–DecIn progress",
      "Q3 · Jul–SepClosed",
      "Q2 · Apr–JunClosed",
      "Q1 · Jan–MarClosed",
    ])
    expect(cards.map((c) => c.querySelector("button")!.getAttribute("aria-expanded"))).toEqual(["true", "false", "false", "false"])
    expect(within(cards[0] as HTMLElement).getByText("€29,000 net")).toBeInTheDocument()
    expect(cards[0].textContent).toContain("October · plan€9,000 net")
  })

  it("words a fully closed year as invoiced and spent, not as plan", () => {
    render(<QuartersSection {...props} invoices={[invoice("2025-03", 100)]} />)
    fireEvent.click(screen.getByRole("button", { name: "Previous year" }))
    const label = screen.getByText("Q4 · closed")
    expect(label.nextElementSibling!.nextElementSibling!.textContent).toBe("Net, as invoiced and spent")
    expect(screen.getByText("Year")).toBeInTheDocument()
    expect(screen.queryByText("Year at plan")).toBeNull()
  })

  it("lets the year stepper reach the year an invoice period starts in", () => {
    render(<QuartersSection {...props} invoices={[invoice("2026-01", 100, "2025-12")]} />)
    fireEvent.click(screen.getByRole("button", { name: "Previous year" }))
    expect(within(screen.getByRole("group", { name: "Year" })).getByText("2025")).toBeInTheDocument()
  })

  it("lets the year stepper reach a year only a collaborator invoice's For Month is in", () => {
    const december = { id: "d", isRecurring: false, category: "collaborators", collaboratorId: "verdi", forMonth: "2025-12", date: new Date("2026-01-10"), amount: 2400 } as CompanyExpense
    render(<QuartersSection {...props} expenses={[...props.expenses, december]} />)
    fireEvent.click(screen.getByRole("button", { name: "Previous year" }))
    expect(within(screen.getByRole("group", { name: "Year" })).getByText("2025")).toBeInTheDocument()
    expect(rows()[4]).toBe("Q4Oct–DecClosed€0€2,400€0-€2,400–")
  })

  it("says which scenario the planned months follow", () => {
    render(<QuartersSection {...props} weighted />)
    expect(screen.getByText(/planned months include the weighted pipeline/i)).toBeInTheDocument()
  })

  it("opens a quarter to its months, each with its source", () => {
    render(<QuartersSection {...props} />)
    const q4 = within(screen.getByRole("table")).getByRole("button", { name: /Q4/ })
    expect(q4).toHaveAttribute("aria-expanded", "false")
    fireEvent.click(q4)
    expect(q4).toHaveAttribute("aria-expanded", "true")
    expect(rows().slice(5, 8)).toEqual([
      "October · plan€15,000€0€6,000€9,00060%",
      "November · plan€12,000€0€5,000€7,00058%",
      "December · plan€20,000€0€7,000€13,00065%",
    ])
    fireEvent.click(within(screen.getByRole("table")).getByRole("button", { name: /Q1/ }))
    expect(rows().slice(2, 5)).toEqual([
      "January · invoiced€0€0€0€0–",
      "February · invoiced€30,000€0€10,000€20,00067%",
      "March · invoiced€0€0€0€0–",
    ])
  })

  describe("collaborators against their invoices", () => {
    const verdi = { id: "verdi", name: "Studio Verdi", isActive: true, fee: { amount: 2400, from: "2026-07", until: null, changes: [] } } as unknown as Collaborator
    const invoiceFor = (forMonth: string, amount: number) =>
      ({ id: forMonth, isRecurring: false, category: "collaborators", collaboratorId: "verdi", forMonth, date: new Date("2026-10-02"), amount }) as CompanyExpense
    const withVerdi = { ...props, collaborators: [verdi], expenses: [invoiceFor("2026-07", 2400), invoiceFor("2026-08", 2400)] }

    it("splits Costs, shows the plan beside the invoiced and flags what is not invoiced yet", () => {
      render(<QuartersSection {...withVerdi} />)
      expect(rows()[3]).toBe("Q3Jul–SepClosed€2,400 not invoiced yet€10,000€4,800plan €7,200€0€5,20052%")
      fireEvent.click(within(screen.getByRole("table")).getByRole("button", { name: /Q3/ }))
      expect(rows().slice(4, 7)).toEqual([
        "July · invoiced€10,000€2,400plan €2,400 ✓€0€7,60076%",
        "August · invoiced€0€2,400plan €2,400 ✓€0-€2,400–",
        "September · invoiced€0€0plan €2,400 · Studio Verdi €2,400 missing€0€0–",
      ])
    })

    it("says an invoice over the plan is over, not missing", () => {
      render(<QuartersSection {...withVerdi} expenses={[invoiceFor("2026-07", 2400), invoiceFor("2026-08", 2400), invoiceFor("2026-09", 2650)]} />)
      expect(rows()[3]).toContain("€7,450€250 over plan")
    })

    it("keeps the phone cards and the stat cards in step", () => {
      render(<QuartersSection {...withVerdi} />)
      const q3 = Array.from(screen.getByRole("list", { name: "Quarters" }).children)[1]
      expect(q3.textContent).toContain("Collaborators€4,800")
      expect(q3.textContent).toContain("€2,400 not invoiced yet")
    })
  })

  it("steps to the next year and stops there", () => {
    render(<QuartersSection {...props} />)
    fireEvent.click(screen.getByRole("button", { name: "Next year" }))
    expect(screen.getByText("2027")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Next year" })).toBeDisabled()
  })

  it("says so when the year has nothing", () => {
    render(<QuartersSection {...props} invoices={[]} expenses={[]} plan={[]} />)
    expect(screen.getByText("Nothing invoiced, spent or planned in 2026 yet.")).toBeInTheDocument()
    expect(screen.queryByRole("table")).toBeNull()
  })
})
