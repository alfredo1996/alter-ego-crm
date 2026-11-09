import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { createMockRent } from "../adapter-mock"
import { RentPage, type DepositReturn } from "../pages/rent-page"

import type { RentAdapter, RentCostInput, RentMovementInput } from "../adapter"
import type { RentCost, RentMovement } from "../rent"
import type { CreateLeaseInput } from "../types"

const U = "u1"
let n = 0
let db: RentAdapter
let savedMovements: RentMovementInput[]
let savedCosts: RentCostInput[]
let changed: number
let returned: DepositReturn[]

const tenantInput = (firstName: string, surname: string) => ({
  firstName, surname, taxId: "TX1", street: "Gedimino pr. 12", postcode: "01103", city: "Vilnius", country: "Lithuania",
})
const leaseInput = (tenantId: string, o: Partial<CreateLeaseInput> = {}): CreateLeaseInput => ({
  tenantId, property: "Via Aurora 7", room: "Room 1", rent: 1050, contribution: 150,
  startDate: "2025-09-01", endDate: "2026-08-31", paidBy: null, ...o,
})

const show = (o: { movements?: RentMovement[]; costs?: RentCost[]; failMovement?: number; today?: string } = {}) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RentPage
        db={{
          ...db,
          createCompanyMovement: async (_u, input) => {
            if (savedMovements.length === o.failMovement) throw new Error("offline")
            savedMovements.push(input)
          },
          createCompanyExpense: async (_u, input) => void savedCosts.push(input),
        }}
        userId={U}
        movements={o.movements ?? []}
        costs={o.costs ?? []}
        accounts={[{ id: "a1", name: "Bank One" }]}
        figures={(_year, property) => (property === "Via Aurora 7" ? { income: 8400, costs: 104800, result: -96400 } : null)}
        costCentresHref="/cash-book"
        onReturnDeposit={(b) => void returned.push(b)}
        onCashBookChanged={() => void changed++}
        today={o.today ?? "2026-10-15"}
      />
    </QueryClientProvider>,
  )
const houses = () => screen.queryAllByRole("heading", { level: 2 }).map((h) => h.textContent)

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date("2026-10-15T12:00:00"))
  db = createMockRent(() => `id-${++n}`).rent
  savedMovements = []
  savedCosts = []
  changed = 0
  returned = []
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe("the Rent page", () => {
  it("shows a lease in every year it was active and in no other", async () => {
    const elena = await db.createTenant(U, tenantInput("Elena", "Ivanova"))
    await db.createLease(U, leaseInput(elena.id)) // 2025-09-01 .. 2026-08-31
    show()

    expect(await screen.findByText("Elena Ivanova")).toBeInTheDocument() // 2026
    expect(screen.getByText("€1,050 + €150 contribution")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Next year" })) // 2027
    expect(await screen.findByText("No leases in 2027")).toBeInTheDocument()
    expect(screen.queryByText("Elena Ivanova")).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Previous year" }))
    fireEvent.click(screen.getByRole("button", { name: "Previous year" })) // 2025
    expect(await screen.findByText("Elena Ivanova")).toBeInTheDocument()
  })

  it("makes a block for a new property name and none for the same name with extra spaces", async () => {
    const tomas = await db.createTenant(U, tenantInput("Tomas", "Vaitkus"))
    await db.createLease(U, leaseInput(tomas.id, { startDate: "2026-01-01", endDate: "2026-12-31" }))
    show()
    await screen.findByText("Tomas Vaitkus")
    expect(houses()).toEqual(["Via Aurora 7"])

    const addLease = async (property: string, room: string) => {
      fireEvent.click(screen.getByRole("button", { name: "New Lease" }))
      const dialog = await screen.findByRole("dialog", { name: "New Lease" })
      fireEvent.click(within(dialog).getByRole("combobox", { name: "Tenant" }))
      fireEvent.click(await screen.findByRole("option", { name: "Tomas Vaitkus" }))
      fireEvent.change(within(dialog).getByRole("combobox", { name: "Property" }), { target: { value: property } })
      fireEvent.change(within(dialog).getByLabelText("Room (optional)"), { target: { value: room } })
      fireEvent.change(within(dialog).getByLabelText("Rent a Month"), { target: { value: "900" } })
      fireEvent.change(within(dialog).getByLabelText("Start"), { target: { value: "2026-11-01" } })
      fireEvent.change(within(dialog).getByLabelText("End"), { target: { value: "2027-10-31" } })
      fireEvent.click(within(dialog).getByRole("button", { name: "Save" }))
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    }

    await addLease("Via Roma 12", "Room 1")
    await waitFor(() => expect(houses()).toEqual(["Via Aurora 7", "Via Roma 12"]))

    await addLease("  Via Roma 12 ", "Room 2")
    await waitFor(() => expect(within(screen.getByRole("region", { name: "Via Roma 12" })).getAllByRole("button", { name: /^Edit lease of/ })).toHaveLength(2))
    expect(houses()).toEqual(["Via Aurora 7", "Via Roma 12"])
  })

  it("saves a name in another case as the house that exists, so there is one block", async () => {
    const tomas = await db.createTenant(U, tenantInput("Tomas", "Vaitkus"))
    await db.createLease(U, leaseInput(tomas.id, { property: "Via Roma 12", startDate: "2026-01-01", endDate: "2026-12-31" }))
    show()
    await screen.findByText("Tomas Vaitkus")
    fireEvent.click(screen.getByRole("button", { name: "New Lease" }))
    const dialog = await screen.findByRole("dialog", { name: "New Lease" })
    fireEvent.click(within(dialog).getByRole("combobox", { name: "Tenant" }))
    fireEvent.click(await screen.findByRole("option", { name: "Tomas Vaitkus" }))
    fireEvent.change(within(dialog).getByRole("combobox", { name: "Property" }), { target: { value: "via roma 12" } })
    fireEvent.change(within(dialog).getByLabelText("Room (optional)"), { target: { value: "Room 2" } })
    fireEvent.change(within(dialog).getByLabelText("Rent a Month"), { target: { value: "900" } })
    fireEvent.change(within(dialog).getByLabelText("Start"), { target: { value: "2026-11-01" } })
    fireEvent.change(within(dialog).getByLabelText("End"), { target: { value: "2027-10-31" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    await waitFor(() => expect(within(screen.getByRole("region", { name: "Via Roma 12" })).getAllByRole("button", { name: /^Edit lease of/ })).toHaveLength(2))
    expect(houses()).toEqual(["Via Roma 12"])
    expect((await db.getLeases(U)).map((l) => l.property)).toEqual(["Via Roma 12", "Via Roma 12"])
  })

  it("offers adding a name that is not a house yet, and the houses that are", async () => {
    const tomas = await db.createTenant(U, tenantInput("Tomas", "Vaitkus"))
    await db.createLease(U, leaseInput(tomas.id, { startDate: "2026-01-01", endDate: "2026-12-31" }))
    show()
    await screen.findByText("Tomas Vaitkus")
    fireEvent.click(screen.getByRole("button", { name: "New Lease" }))
    const property = within(await screen.findByRole("dialog", { name: "New Lease" })).getByRole("combobox", { name: "Property" })

    fireEvent.focus(property)
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Via Aurora 7· 1 lease"])
    fireEvent.change(property, { target: { value: "Via Roma 12" } })
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Add “Via Roma 12” as a new house"])
  })

  it("renews a lease from the day after its end, and ends one early", async () => {
    const elena = await db.createTenant(U, tenantInput("Elena", "Ivanova"))
    await db.createLease(U, leaseInput(elena.id, { startDate: "2026-01-01", endDate: "2026-12-31", paidBy: "Petra Ivanova" }))
    show()
    await screen.findByText("Elena Ivanova")

    fireEvent.click(screen.getByRole("button", { name: "Edit lease of Elena Ivanova, Room 1" }))
    fireEvent.click(within(await screen.findByRole("dialog", { name: "Edit Lease" })).getByRole("button", { name: "Renew" }))
    const renew = await screen.findByRole("dialog", { name: "Renew Lease" })
    expect(within(renew).getByLabelText("Start")).toHaveValue("2027-01-01")
    expect(within(renew).getByLabelText("End")).toHaveValue("2027-12-31")
    expect(within(renew).getByLabelText("Rent a Month")).toHaveValue(1050)
    fireEvent.change(within(renew).getByLabelText("Rent a Month"), { target: { value: "1100" } })
    fireEvent.click(within(renew).getByRole("button", { name: "Renew" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())

    const renewed = (await db.getLeases(U)).find((l) => l.startDate === "2027-01-01")
    expect(renewed).toMatchObject({ tenantId: elena.id, property: "Via Aurora 7", room: "Room 1", rent: 1100, endDate: "2027-12-31", paidBy: "Petra Ivanova" })

    fireEvent.click(screen.getByRole("button", { name: "Edit lease of Elena Ivanova, Room 1" }))
    fireEvent.click(within(await screen.findByRole("dialog", { name: "Edit Lease" })).getByRole("button", { name: "End Tenancy" }))
    const end = await screen.findByRole("dialog", { name: "End Tenancy" })
    fireEvent.change(within(end).getByLabelText("Last Day"), { target: { value: "2026-12-31" } })
    fireEvent.click(within(end).getByRole("button", { name: "End Tenancy" }))
    expect(await within(end).findByText("The last day must be before the lease ends")).toBeInTheDocument()
    fireEvent.change(within(end).getByLabelText("Last Day"), { target: { value: "2026-03-31" } })
    fireEvent.click(within(end).getByRole("button", { name: "End Tenancy" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    expect((await db.getLeases(U)).find((l) => l.startDate === "2026-01-01")?.endDate).toBe("2026-03-31")
  })

  describe("ends a tenancy with a deposit held", () => {
    const setup = async (extra: Partial<RentMovement>[] = []) => {
      const dana = await db.createTenant(U, tenantInput("Dana", "Kowalczyk"))
      const lease = await db.createLease(U, leaseInput(dana.id, { startDate: "2026-01-01", endDate: "2026-12-31" }))
      const deposit = (o: Partial<RentMovement>): RentMovement => ({ id: `d${++n}`, leaseId: lease.id, amount: 1500, date: new Date(2026, 0, 2), kind: "deposit_held", direction: "in", accountId: "a1", counterparty: "Room 1", ...o })
      show({ movements: [deposit({}), deposit({ direction: "out", amount: 300, accountId: "a2", counterparty: "Room 1", date: new Date(2026, 5, 1) }), ...extra.map(deposit)] })
      fireEvent.click(await screen.findByRole("button", { name: "Edit lease of Dana Kowalczyk, Room 1" }))
      fireEvent.click(within(await screen.findByRole("dialog", { name: "Edit Lease" })).getByRole("button", { name: "End Tenancy" }))
      const end = await screen.findByRole("dialog", { name: "End Tenancy" })
      return { lease, end }
    }
    const endOn = async (end: HTMLElement, day: string, button: string) => {
      fireEvent.change(within(end).getByLabelText("Last Day"), { target: { value: day } })
      fireEvent.click(within(end).getByRole("button", { name: button }))
    }

    it("shows it, saves the last day, then hands over the deposit and the name it came in under", async () => {
      const dana = await db.createTenant(U, tenantInput("Dana", "Kowalczyk"))
      const lease = await db.createLease(U, leaseInput(dana.id, { startDate: "2026-01-01", endDate: "2026-12-31" }))
      const deposit = (o: Partial<RentMovement>): RentMovement => ({ id: `d${++n}`, leaseId: lease.id, amount: 1500, date: new Date(2026, 0, 2), kind: "deposit_held", direction: "in", accountId: "a1", counterparty: "Room 1", ...o })
      show({ movements: [deposit({}), deposit({ direction: "out", amount: 300, accountId: "a2", date: new Date(2026, 5, 1) })] })

      expect(await screen.findByText("Jan 2026 – Dec 2026 · deposit €1,200")).toBeInTheDocument()
      expect(screen.getByText("Deposits held")).toHaveTextContent("Deposits held €1,200")
      // The strip reads "… paid · Owed … · Deposits held …", as the Main board draws it.
      expect(screen.getByText("Owed", { selector: "span" }).compareDocumentPosition(screen.getByText("Deposits held"))).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
      fireEvent.click(screen.getByRole("button", { name: "Edit lease of Dana Kowalczyk, Room 1" }))
      const edit = await screen.findByRole("dialog", { name: "Edit Lease" })
      expect(within(edit).getByText("Deposit held €1,200 · owed €10,800 · ends in 2 months")).toBeInTheDocument()
      fireEvent.click(within(edit).getByRole("button", { name: "End Tenancy" }))
      const end = await screen.findByRole("dialog", { name: "End Tenancy" })
      expect(within(end).getByText("Deposit held €1,200 · owed €10,800")).toBeInTheDocument()
      fireEvent.change(within(end).getByLabelText("Last Day"), { target: { value: "2026-09-30" } })
      fireEvent.click(within(end).getByRole("button", { name: "End and Return Deposit" }))
      await waitFor(() => expect(returned).toEqual([{ leaseId: lease.id, amount: 1200, date: "2026-09-30", counterparty: "Room 1", property: "Via Aurora 7", accountId: "a1" }]))
      expect((await db.getLeases(U))[0].endDate).toBe("2026-09-30")
    })

    it.each([
      ["a last day still to come", "2026-11-30", "2026-10-15"],
      ["a last day that has passed", "2026-09-30", "2026-09-30"],
    ])("dates the return %s on the earlier of it and today", async (_n, day, date) => {
      const { end } = await setup()
      await endOn(end, day, "End and Return Deposit")
      await waitFor(() => expect(returned.map((r) => r.date)).toEqual([date]))
    })

    it("keeps the tenant's name when no deposit row names anyone", async () => {
      const { end } = await setup([{ counterparty: null, date: new Date(2026, 6, 1) }])
      await endOn(end, "2026-09-30", "End and Return Deposit")
      await waitFor(() => expect(returned.map((r) => r.counterparty)).toEqual(["Dana Kowalczyk"]))
    })

    it("hands over only after the last day is saved", async () => {
      const { end } = await setup()
      fireEvent.change(within(end).getByLabelText("Last Day"), { target: { value: "2026-12-31" } }) // not before the lease ends: refused
      fireEvent.click(within(end).getByRole("button", { name: "End and Return Deposit" }))
      expect(await within(end).findByText("The last day must be before the lease ends")).toBeInTheDocument()
      expect(returned).toEqual([])
    })

    it("hands nothing over when it was all given back: a plain End Tenancy", async () => {
      const dana = await db.createTenant(U, tenantInput("Dana", "Kowalczyk"))
      const lease = await db.createLease(U, leaseInput(dana.id, { startDate: "2026-01-01", endDate: "2026-12-31" }))
      const row = (o: Partial<RentMovement>): RentMovement => ({ id: `d${++n}`, leaseId: lease.id, amount: 1500, date: new Date(2026, 0, 2), kind: "deposit_held", direction: "in", ...o })
      show({ movements: [row({}), row({ direction: "out", date: new Date(2026, 5, 1) })] })
      fireEvent.click(await screen.findByRole("button", { name: "Edit lease of Dana Kowalczyk, Room 1" }))
      fireEvent.click(within(await screen.findByRole("dialog", { name: "Edit Lease" })).getByRole("button", { name: "End Tenancy" }))
      const end = await screen.findByRole("dialog", { name: "End Tenancy" })
      await endOn(end, "2026-09-30", "End Tenancy")
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
      expect(returned).toEqual([])
    })
  })

  it("ends a tenancy with no deposit as before: plain button, nothing handed over", async () => {
    const dana = await db.createTenant(U, tenantInput("Dana", "Kowalczyk"))
    await db.createLease(U, leaseInput(dana.id, { startDate: "2026-01-01", endDate: "2026-12-31" }))
    show()
    fireEvent.click(await screen.findByRole("button", { name: "Edit lease of Dana Kowalczyk, Room 1" }))
    fireEvent.click(within(await screen.findByRole("dialog", { name: "Edit Lease" })).getByRole("button", { name: "End Tenancy" }))
    const end = await screen.findByRole("dialog", { name: "End Tenancy" })
    fireEvent.change(within(end).getByLabelText("Last Day"), { target: { value: "2026-11-30" } })
    fireEvent.click(within(end).getByRole("button", { name: "End Tenancy" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    expect(returned).toEqual([])
  })

  it("selects the tenant created from inside New Lease, and keeps what was typed", async () => {
    show()
    fireEvent.click(await screen.findByRole("button", { name: "New Lease" }))
    const lease = await screen.findByRole("dialog", { name: "New Lease" })
    fireEvent.change(within(lease).getByLabelText("Room (optional)"), { target: { value: "Room 7" } })
    fireEvent.click(within(lease).getByRole("button", { name: "New Tenant" }))
    const tenant = await screen.findByRole("dialog", { name: "New Tenant" })
    const t = tenantInput("Greta", "Petrauskas")
    for (const [label, value] of [["First Name", t.firstName], ["Surname", t.surname], ["Tax ID (optional)", t.taxId], ["Street and Number", t.street], ["Postcode", t.postcode], ["City", t.city], ["Country", t.country]])
      fireEvent.change(within(tenant).getByLabelText(label), { target: { value } })
    fireEvent.click(within(tenant).getByRole("button", { name: "Save" }))

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "New Tenant" })).not.toBeInTheDocument())
    const back = await screen.findByRole("dialog", { name: "New Lease" })
    await waitFor(() => expect(within(back).getByRole("combobox", { name: "Tenant" })).toHaveTextContent("Greta Petrauskas"))
    expect(within(back).getByLabelText("Room (optional)")).toHaveValue("Room 7")
  })

  describe("the property list", () => {
    const openProperty = async () => {
      const tomas = await db.createTenant(U, tenantInput("Tomas", "Vaitkus"))
      await db.createLease(U, leaseInput(tomas.id, { startDate: "2026-01-01", endDate: "2026-12-31" }))
      await db.createLease(U, leaseInput(tomas.id, { property: "Via Roma 12", startDate: "2026-01-01", endDate: "2026-12-31" }))
      show()
      fireEvent.click(await screen.findByRole("button", { name: "New Lease" }))
      const dialog = await screen.findByRole("dialog", { name: "New Lease" })
      const property = within(dialog).getByRole("combobox", { name: "Property" })
      fireEvent.change(property, { target: { value: "via" } })
      return { dialog, property }
    }

    it("keeps the New Lease dialog and what was typed when Escape closes the list", async () => {
      const { property } = await openProperty()
      property.focus() // the key goes to the focused input, as in a browser
      expect(screen.getByRole("listbox")).toBeInTheDocument()
      fireEvent.keyDown(property, { key: "Escape" })
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument()
      expect(screen.getByRole("dialog", { name: "New Lease" })).toBeInTheDocument()
      expect(property).toHaveValue("via")
      fireEvent.keyDown(property, { key: "Escape" }) // no list now: the dialog goes
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    })

    it("walks the options with the arrow keys and picks with Enter, without submitting", async () => {
      const { dialog, property } = await openProperty()
      fireEvent.keyDown(property, { key: "ArrowDown" })
      fireEvent.keyDown(property, { key: "ArrowDown" })
      const options = screen.getAllByRole("option")
      expect(property).toHaveAttribute("aria-activedescendant", options[1].id)
      expect(options[1]).toHaveAttribute("aria-selected", "true")
      fireEvent.keyDown(property, { key: "Enter" })
      expect(property).toHaveValue("Via Roma 12")
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument()
      expect(within(dialog).queryByText("Tenant is required")).not.toBeInTheDocument() // the form was not submitted
      fireEvent.change(property, { target: { value: "via" } })
      fireEvent.keyDown(property, { key: "ArrowUp" })
      expect(property).toHaveAttribute("aria-activedescendant", screen.getAllByRole("option").at(-1)?.id)
    })

    it("does not offer a new house for the name of one in another case", async () => {
      const { property } = await openProperty()
      fireEvent.change(property, { target: { value: "via roma 12" } })
      expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Via Roma 12· 1 lease"])
    })
  })

  it("saves an edited lease and an edited tenant", async () => {
    const elena = await db.createTenant(U, tenantInput("Elena", "Ivanova"))
    const lease = await db.createLease(U, leaseInput(elena.id, { startDate: "2026-01-01", endDate: "2026-12-31" }))
    show()

    fireEvent.click(await screen.findByRole("button", { name: "Edit lease of Elena Ivanova, Room 1" }))
    const edit = await screen.findByRole("dialog", { name: "Edit Lease" })
    fireEvent.change(within(edit).getByLabelText("Rent a Month"), { target: { value: "1200" } })
    fireEvent.click(within(edit).getByRole("button", { name: "Save" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    expect((await db.getLeases(U)).find((l) => l.id === lease.id)).toMatchObject({ rent: 1200, room: "Room 1" })
    expect(await screen.findByText("€1,200 + €150 contribution")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Edit lease of Elena Ivanova, Room 1" }))
    fireEvent.click(within(await screen.findByRole("dialog", { name: "Edit Lease" })).getByRole("button", { name: "Edit Tenant" }))
    const tenant = await screen.findByRole("dialog", { name: "Edit Tenant" })
    fireEvent.change(within(tenant).getByLabelText("City"), { target: { value: "Kaunas" } })
    fireEvent.click(within(tenant).getByRole("button", { name: "Save" }))
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit Tenant" })).not.toBeInTheDocument())
    expect(screen.getByRole("dialog", { name: "Edit Lease" })).toBeInTheDocument() // the lease it was opened from stays
    expect((await db.getTenants(U)).find((t) => t.id === elena.id)).toMatchObject({ city: "Kaunas", surname: "Ivanova" })
  })

  it("keeps the dialog open and says why when a save fails", async () => {
    const elena = await db.createTenant(U, tenantInput("Elena", "Ivanova"))
    await db.createLease(U, leaseInput(elena.id, { startDate: "2026-01-01", endDate: "2026-12-31" }))
    db.updateLease = () => Promise.reject(new Error("Permission denied"))
    show()

    fireEvent.click(await screen.findByRole("button", { name: "Edit lease of Elena Ivanova, Room 1" }))
    const edit = await screen.findByRole("dialog", { name: "Edit Lease" })
    fireEvent.click(within(edit).getByRole("button", { name: "Save" }))
    expect(await within(edit).findByRole("alert")).toHaveTextContent("Permission denied")
    expect(screen.getByRole("dialog", { name: "Edit Lease" })).toBeInTheDocument()
    expect(within(edit).getByRole("button", { name: "Save" })).toBeEnabled()
  })

  describe("who paid", () => {
    const marco = async () => {
      const t = await db.createTenant(U, tenantInput("Marco", "Gallo"))
      return db.createLease(U, leaseInput(t.id, { room: "Room 4", rent: 950, contribution: 150, startDate: "2026-09-01", endDate: "2027-08-31" }))
    }
    const paid = (leaseId: string, rentMonth: string, rentPart: "rent" | "contribution", amount: number, documentRef: string | null = "14/26"): RentMovement => ({
      id: `m-${rentMonth}-${rentPart}`, leaseId, rentMonth, rentPart, amount, documentRef, date: new Date(2026, 8, 7),
    })
    const cell = (month: string) => screen.findByRole("button", { name: new RegExp(`^Marco Gallo, ${month}:`) })

    it("counts a lease that ended last year in Owed, though the year shown has no lease", async () => {
      const t = await db.createTenant(U, tenantInput("Dana", "Kowalczyk"))
      await db.createLease(U, leaseInput(t.id, { rent: 500, contribution: 0, startDate: "2026-01-01", endDate: "2026-12-31" }))
      show({ today: "2027-01-10" })
      expect(await screen.findByText("Owed", { selector: "span" })).toHaveTextContent("Owed €6,000")
      expect(screen.getByText("No leases in 2027")).toBeInTheDocument()
      expect(screen.queryByText(/Click a month to record a payment/)).not.toBeInTheDocument()
    })

    it("counts the departed tenant's year in Owed when the house still has other tenants, and shows no row for them", async () => {
      const dana = await db.createTenant(U, tenantInput("Dana", "Kowalczyk"))
      const elena = await db.createTenant(U, tenantInput("Elena", "Ivanova"))
      await db.createLease(U, leaseInput(dana.id, { room: "Room 1", rent: 500, contribution: 0, startDate: "2026-01-01", endDate: "2026-12-31" }))
      const l2 = await db.createLease(U, leaseInput(elena.id, { room: "Room 2", rent: 500, contribution: 0, startDate: "2026-01-01", endDate: "2027-12-31" }))
      const months = [...Array.from({ length: 12 }, (_, i) => `2026-${String(i + 1).padStart(2, "0")}`), "2027-01"]
      show({ today: "2027-01-10", movements: months.map((m) => ({ ...paid(l2.id, m, "rent", 500), date: new Date(2026, 0, 5) })) })
      expect(await screen.findByText("Owed", { selector: "span" })).toHaveTextContent("Owed €6,000")
      expect(await screen.findByRole("button", { name: /^Elena Ivanova, January:/ })).toBeInTheDocument()
      expect(screen.queryByRole("button", { name: /Dana Kowalczyk/ })).not.toBeInTheDocument()
    })

    it("says each month in words: paid and not invoiced, not yet, due later; and hides the months before the first lease", async () => {
      const l = await marco()
      show({ movements: [paid(l.id, "2026-09", "rent", 950, null), paid(l.id, "2026-09", "contribution", 150, null)] })
      expect(await cell("September")).toHaveAccessibleName("Marco Gallo, September: paid, not invoiced")
      expect(await cell("October")).toHaveAccessibleName("Marco Gallo, October: not yet")
      expect(await cell("November")).toHaveAccessibleName("Marco Gallo, November: €1,100 due later")
      expect(screen.getByText("January to August are hidden: no lease ran then.")).toBeInTheDocument()
      expect(screen.getByText("Owed", { selector: "span" })).toHaveTextContent("Owed €0")
    })

    it("records a payment from a Missing cell as a rent row and a contribution row tagged with the lease and month", async () => {
      const l = await marco()
      show({ costs: [] })
      fireEvent.click(await cell("September")) // nothing paid, month ended: Missing
      const month = await screen.findByRole("dialog", { name: "September 2026" })
      expect(within(month).getByText("Missing")).toBeInTheDocument()
      fireEvent.click(within(month).getByRole("button", { name: "Record Payment" }))
      const dialog = await screen.findByRole("dialog", { name: "Record Payment" })
      expect(within(dialog).getByLabelText("Rent")).toHaveValue(950)
      expect(within(dialog).getByLabelText("Contribution")).toHaveValue(150)
      fireEvent.change(within(dialog).getByLabelText("Invoice Number (optional)"), { target: { value: "21/26" } })
      fireEvent.click(within(dialog).getByRole("button", { name: "Record Payment" }))
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())

      expect(savedMovements.map((m) => [m.rentPart, m.amount, m.rentMonth, m.leaseId, m.project, m.documentRef, m.kind, m.direction, m.accountId])).toEqual([
        ["rent", 950, "2026-09", l.id, "Via Aurora 7", "21/26", "income", "in", "a1"],
        ["contribution", 150, "2026-09", l.id, "Via Aurora 7", "21/26", "income", "in", "a1"],
      ])
      expect(savedCosts).toEqual([])
      expect(changed).toBe(1)
    })

    it("saves a rent offset as a cost of the house linked to the lease and month, beside the full payment", async () => {
      const l = await marco()
      show()
      fireEvent.click(await cell("October"))
      fireEvent.click(within(await screen.findByRole("dialog", { name: "October 2026" })).getByRole("button", { name: "Record Payment" }))
      const dialog = await screen.findByRole("dialog", { name: "Record Payment" })
      fireEvent.click(within(dialog).getByRole("checkbox", { name: "Less an Offset" }))
      fireEvent.change(within(dialog).getByLabelText("Offset Amount"), { target: { value: "520" } })
      fireEvent.change(within(dialog).getByLabelText("What For"), { target: { value: "His room during the works" } })
      expect(within(dialog).getByText("€580")).toBeInTheDocument() // on the bank: 950 + 150 − 520
      fireEvent.click(within(dialog).getByRole("button", { name: "Record Payment" }))
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())

      expect(savedMovements.map((m) => m.amount)).toEqual([950, 150])
      expect(savedCosts).toMatchObject([{ amount: 520, vat: 0, project: "Via Aurora 7", leaseId: l.id, forMonth: "2026-10", category: "other", accountId: "a1" }])
    })

    it("keeps what saved when the second row fails: tells the owner, refreshes, and cannot save the first row again", async () => {
      await marco()
      show({ failMovement: 1 })
      fireEvent.click(await cell("October"))
      fireEvent.click(within(await screen.findByRole("dialog", { name: "October 2026" })).getByRole("button", { name: "Record Payment" }))
      const dialog = await screen.findByRole("dialog", { name: "Record Payment" })
      fireEvent.click(within(dialog).getByRole("button", { name: "Record Payment" }))
      expect(await within(dialog).findByRole("alert")).toHaveTextContent("The rent is saved, but not the contribution: offline")
      expect(savedMovements.map((m) => m.rentPart)).toEqual(["rent"])
      expect(changed).toBe(1)
      expect(within(dialog).getByRole("button", { name: "Record Payment" })).toBeDisabled()
    })

    it("fills the amounts again for the month chosen in For Month", async () => {
      const t = await db.createTenant(U, tenantInput("Marco", "Gallo"))
      await db.createLease(U, leaseInput(t.id, { room: "Room 4", rent: 950, contribution: 150, startDate: "2026-09-01", endDate: "2027-08-31", agreedMonths: { "2026-09": { amount: 800, note: "Moved in" } } }))
      show()
      fireEvent.click(await cell("September"))
      fireEvent.click(within(await screen.findByRole("dialog", { name: "September 2026" })).getByRole("button", { name: "Record Payment" }))
      const dialog = await screen.findByRole("dialog", { name: "Record Payment" })
      expect(within(dialog).getByLabelText("Rent")).toHaveValue(800)
      fireEvent.keyDown(within(dialog).getByRole("combobox", { name: "For Month" }), { key: "Enter" })
      fireEvent.keyDown(await screen.findByRole("option", { name: "October 2026" }), { key: "Enter" })
      await waitFor(() => expect(within(dialog).getByLabelText("Rent")).toHaveValue(950))
      expect(within(dialog).getByLabelText("Contribution")).toHaveValue(150)
    })

    it("refuses an offset larger than the payment and saves nothing", async () => {
      await marco()
      show()
      fireEvent.click(await cell("October"))
      fireEvent.click(within(await screen.findByRole("dialog", { name: "October 2026" })).getByRole("button", { name: "Record Payment" }))
      const dialog = await screen.findByRole("dialog", { name: "Record Payment" })
      fireEvent.click(within(dialog).getByRole("checkbox", { name: "Less an Offset" }))
      fireEvent.change(within(dialog).getByLabelText("Offset Amount"), { target: { value: "2000" } })
      fireEvent.change(within(dialog).getByLabelText("What For"), { target: { value: "Works" } })
      fireEvent.click(within(dialog).getByRole("button", { name: "Record Payment" }))
      expect(await within(dialog).findByText("The offset cannot be more than the payment")).toBeInTheDocument()
      expect(savedMovements).toEqual([])
    })

    it("sets an agreed amount for one month from its cell, which then shows Paid at that amount, and removes it again", async () => {
      const l = await marco()
      show({ movements: [paid(l.id, "2026-09", "rent", 800)] })
      expect(await cell("September")).toHaveAccessibleName("Marco Gallo, September: €300 short")
      fireEvent.click(await cell("September"))
      const month = await screen.findByRole("dialog", { name: "September 2026" })
      fireEvent.change(within(month).getByLabelText("For This Month"), { target: { value: "800" } })
      fireEvent.change(within(month).getByLabelText("Note"), { target: { value: "Moved in on 26 Sep" } })
      fireEvent.click(within(month).getByRole("button", { name: "Save" }))
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
      expect((await db.getLeases(U))[0].agreedMonths).toEqual({ "2026-09": { amount: 800, note: "Moved in on 26 Sep" } })
      expect(await screen.findByRole("button", { name: "Marco Gallo, September: paid, agreed 800 euro" })).toBeInTheDocument()

      fireEvent.click(screen.getByRole("button", { name: "Marco Gallo, September: paid, agreed 800 euro" }))
      fireEvent.click(within(await screen.findByRole("dialog", { name: "September 2026" })).getByRole("button", { name: "Remove Agreed" }))
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
      expect((await db.getLeases(U))[0].agreedMonths).toEqual({})
    })

    it("shows one month at a time on a phone, with what is owed from earlier months", async () => {
      await marco()
      vi.stubGlobal("matchMedia", (q: string) => ({ matches: true, media: q, addEventListener: () => {}, removeEventListener: () => {} }))
      try {
        show()
        expect(await screen.findByText("October 2026")).toBeInTheDocument()
        expect(screen.queryByRole("table")).not.toBeInTheDocument()
        expect(screen.getByRole("button", { name: "Marco Gallo, October: not yet" })).toHaveTextContent("Room 4 · €1,100 due")
        expect(screen.getByText(/Owed from earlier months:/)).toHaveTextContent("Owed from earlier months: €1,100, Marco Gallo for September.")
        fireEvent.click(screen.getByRole("button", { name: "Edit lease of Marco Gallo, Room 4" }))
        expect(await screen.findByRole("dialog", { name: "Edit Lease" })).toBeInTheDocument()
        fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" })
        await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
        fireEvent.click(screen.getByRole("button", { name: "Next month" }))
        expect(await screen.findByText("November 2026")).toBeInTheDocument()
        expect(screen.getByRole("button", { name: "Marco Gallo, November: €1,100 due later" })).toBeInTheDocument()
      } finally {
        vi.unstubAllGlobals()
      }
    })
  })
})

describe("details that are not set", () => {
  const bare = { firstName: "Bea", surname: "Nodetail" }

  it("shows no room chip and one amber line, a header that counts only set rooms, and the lease opens from the line", async () => {
    const bea = await db.createTenant(U, bare)
    const full = await db.createTenant(U, tenantInput("Elena", "Ivanova"))
    await db.createLease(U, leaseInput(bea.id, { room: null, startDate: "2026-01-01", endDate: "2026-12-31" }))
    await db.createLease(U, leaseInput(full.id, { startDate: "2026-01-01", endDate: "2026-12-31" }))
    show()
    await screen.findByText("Bea Nodetail")
    expect(screen.getByText("2 leases · 1 room, 1 not set")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Edit lease of Bea Nodetail" })).toBeInTheDocument()
    expect(screen.getAllByText(/^Not set:/).map((e) => e.textContent)).toEqual(["Not set: room, tax ID, residence"])
    fireEvent.click(screen.getByRole("button", { name: "Bea Nodetail: Not set: room, tax ID, residence" }))
    const dialog = await screen.findByRole("dialog", { name: "Edit Lease" })
    expect(within(dialog).getByText("Bea Nodetail · Via Aurora 7")).toBeInTheDocument()
    expect(within(dialog).getByRole("button", { name: /Edit Tenant/ })).toHaveTextContent("Edit Tenant · Tax ID and residence not set")
  })

  it("says rooms not set when no lease has one, and names a half-filled address residence", async () => {
    const t = await db.createTenant(U, { ...bare, taxId: "TX1", street: "Via Test 1", city: "Turin" })
    await db.createLease(U, leaseInput(t.id, { room: null, startDate: "2026-01-01", endDate: "2026-12-31" }))
    show()
    expect(await screen.findByText("1 lease · room not set")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Bea Nodetail: Not set: room, residence" })).toBeInTheDocument()
  })

  it("shows no line for a complete row, and the same line under a row on a phone", async () => {
    const t = await db.createTenant(U, tenantInput("Elena", "Ivanova"))
    const bea = await db.createTenant(U, bare)
    await db.createLease(U, leaseInput(t.id, { startDate: "2026-01-01", endDate: "2026-12-31" }))
    await db.createLease(U, leaseInput(bea.id, { room: null, startDate: "2026-01-01", endDate: "2026-12-31" }))
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: true, media: q, addEventListener: () => {}, removeEventListener: () => {} }))
    try {
      show()
      expect(await screen.findByText("October 2026")).toBeInTheDocument()
      expect(screen.getAllByText(/^Not set:/).map((e) => e.textContent)).toEqual(["Not set: room, tax ID, residence"])
      expect(screen.getByRole("button", { name: "Bea Nodetail, October: not yet" })).toHaveTextContent("€1,200 due")
      expect(screen.getByRole("button", { name: "Bea Nodetail, October: not yet" })).not.toHaveTextContent("null")
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it("saves a new tenant from the names alone", async () => {
    show()
    fireEvent.click(await screen.findByRole("button", { name: "New Tenant" }))
    const dialog = await screen.findByRole("dialog", { name: "New Tenant" })
    fireEvent.change(within(dialog).getByLabelText("First Name"), { target: { value: "Bea" } })
    fireEvent.change(within(dialog).getByLabelText("Surname"), { target: { value: "Nodetail" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }))
    await waitFor(async () => expect(await db.getTenants(U)).toMatchObject([{ firstName: "Bea", taxId: null, street: null, country: null }]))
  })
})
