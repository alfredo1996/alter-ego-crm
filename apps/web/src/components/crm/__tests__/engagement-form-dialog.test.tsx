/**
 * Edit Contract once amendments exist, over a fixed clock (7 Oct 2026): the day
 * rate locks once hours are logged (owner decision, as update_engagement), the
 * budget reads as signed days plus the amendments', and a change that reprices
 * past months says which ones before Save.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

import { EngagementFormDialog } from "../engagement-form-dialog"

import type { Allocation, Engagement, Timecard } from "@/types"

const at = new Date(2026, 0, 1)
const PCM: Engagement = {
  id: "e1", userId: "u1", clientId: "c1", name: "PCM", opportunityId: null, dailyRate: 700, vatApplicable: false,
  contractedDays: 80, defaultDaysPerMonth: 10, startMonth: "2026-03", endMonth: null, endDate: null, isActive: true,
  notes: null, createdAt: at, updatedAt: at,
  amendments: [
    { from: "2026-10", dailyRate: null, addedDays: 40, lastDay: null, lastDayBefore: null, note: null },
    { from: "2027-01", dailyRate: 800, addedDays: null, lastDay: null, lastDayBefore: null, note: null },
  ],
}
const HOURS: Timecard = {
  id: "t1", userId: "u1", engagementId: "e1", collaboratorId: null, date: "2026-09-15", hours: 8, notes: null, createdAt: at, updatedAt: at,
}
// Mar–May confirmed with Use; Jun–Sep still priced by Days/month.
const USED: Allocation[] = ["2026-03", "2026-04", "2026-05"].map((yearMonth) => ({
  id: `e1_${yearMonth}`, userId: "u1", engagementId: "e1", yearMonth, days: 10, notes: null, createdAt: at, updatedAt: at,
}))

beforeAll(() => vi.setSystemTime(new Date(2026, 9, 7, 12)))
afterAll(() => vi.useRealTimers())

function edit(o: { timecards?: Timecard[]; allocations?: Allocation[]; engagement?: Engagement } = {}) {
  const onSubmit = vi.fn()
  const dialogFor = (timecards: Timecard[]) => (
    <EngagementFormDialog
      open
      onOpenChange={vi.fn()}
      engagement={o.engagement ?? PCM}
      allocations={o.allocations ?? []}
      timecards={timecards}
      clients={[{ id: "c1", name: "Lumon Limited" } as never]}
      onCreateClient={vi.fn()}
      onSubmit={onSubmit}
      isPending={false}
    />
  )
  const { rerender } = render(dialogFor(o.timecards ?? []))
  return {
    dialog: screen.getByRole("dialog", { name: "Edit Contract" }),
    onSubmit,
    withHours: (timecards: Timecard[]) => rerender(dialogFor(timecards)),
  }
}

describe("EngagementFormDialog, editing an amended contract", () => {
  it("locks the day rate once hours exist, and says where a new rate goes", () => {
    const { dialog } = edit({ timecards: [HOURS] })
    const rate = within(dialog).getByLabelText("Day rate")
    expect(rate).toHaveAttribute("readonly")
    expect(rate).toHaveValue("€700/day signed")
    expect(dialog).toHaveTextContent(
      "Amended: €800 from Jan 2027. Change it with Amend Contract, from a month on, so invoiced months keep their price.",
    )
  })

  it("sends the signed rate once hours lock it, whatever was typed before they arrived", async () => {
    const { dialog, onSubmit, withHours } = edit()
    fireEvent.change(within(dialog).getByLabelText("Day rate"), { target: { value: "800" } })
    // The hours land while the dialog is open (a refetch): the field now shows the signed rate.
    withHours([HOURS])
    expect(within(dialog).getByLabelText("Day rate")).toHaveValue("€700/day signed")
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce())
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ dailyRate: 700 })
  })

  it("refuses an end before an amendment, as Remove refuses to strand one", async () => {
    const ending = { ...PCM, endMonth: "2027-03", endDate: "2027-03-31" }
    const { dialog, onSubmit } = edit({ timecards: [HOURS], engagement: ending })
    const endDate = within(dialog).getByLabelText("End date")
    fireEvent.change(endDate, { target: { value: "2026-11-30" } })
    const refusal =
      "The end moves before the Jan 2027 amendment: it would never apply. Remove it with Amend Contract first."
    // Shown under the field as it is typed, and Save does not go through.
    expect(endDate).toHaveAccessibleDescription(refusal)
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }))
    await waitFor(() => expect(endDate).toHaveFocus())
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it("keeps the day rate editable before any hours: a typo fix", () => {
    const { dialog } = edit()
    const rate = within(dialog).getByLabelText("Day rate")
    expect(rate).not.toHaveAttribute("readonly")
    expect(rate).toHaveValue(700)
  })

  it("reads the budget as signed days plus the amendments', and refuses to clear it", async () => {
    // With hours, as an amended contract usually has (happy-dom also fails 700 against step 0.01, blocking the submit).
    const { dialog, onSubmit } = edit({ timecards: [HOURS] })
    const days = within(dialog).getByLabelText("Signed days")
    expect(days).toHaveValue(80)
    expect(dialog).toHaveTextContent("+40 from amendments = 120")
    fireEvent.change(days, { target: { value: "" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }))
    expect(
      await within(dialog).findByText(
        "Amendments add 40 days to this budget, so it can't become time and materials. Remove them with Amend Contract first.",
      ),
    ).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it("lists the past months a new Days/month reprices: those never confirmed with Use", () => {
    const { dialog } = edit({ allocations: USED })
    expect(dialog).not.toHaveTextContent("Changes every past month")
    fireEvent.change(within(dialog).getByLabelText("Days/month"), { target: { value: "12" } })
    expect(dialog).toHaveTextContent(
      "Changes every past month not confirmed with Use: Jun 2026–Sep 2026. Confirm them in the Plan first.",
    )
  })

  it("warns that a VAT change reprices every month since the start", () => {
    const { dialog } = edit()
    fireEvent.click(within(dialog).getByRole("switch", { name: "VAT applicable" }))
    expect(dialog).toHaveTextContent("Changes VAT on every month since the start; a VAT change is usually a new contract.")
  })
})

// happy-dom fails a whole-euro rate against step 0.01 (floating point) and blocks the submit: the form's own
// checks are the zod schema, which these tests do exercise.
const submitFor = (dialog: HTMLElement, name: string) => {
  dialog.querySelector("form")!.noValidate = true
  fireEvent.click(within(dialog).getByRole("button", { name }))
}

describe("EngagementFormDialog, a contract in hours", () => {
  function create() {
    const onSubmit = vi.fn()
    render(
      <EngagementFormDialog
        open
        onOpenChange={vi.fn()}
        prefill={{ clientId: "c1" }}
        clients={[{ id: "c1", name: "Lumon Limited" } as never]}
        onCreateClient={vi.fn()}
        onSubmit={onSubmit}
        isPending={false}
      />,
    )
    return { dialog: screen.getByRole("dialog", { name: "New Contract" }), onSubmit }
  }

  it("names the unit choice \"Unit\", by a visible label tied to the group", () => {
    const { dialog } = create()
    expect(within(dialog).getByRole("group", { name: "Unit" })).toContainElement(within(dialog).getByRole("button", { name: "Hours" }))
    expect(within(dialog).queryByText("Signed in")).toBeNull()
  })

  it("takes €75/h for 100 h, 40 h a month, and stores €600/day for 12.5 days, 5 a month", async () => {
    const { dialog, onSubmit } = create()
    // Days is the default: the labels follow the choice.
    expect(within(dialog).getByLabelText("Day rate")).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole("button", { name: "Hours" }))
    fireEvent.change(within(dialog).getByLabelText("Hourly rate"), { target: { value: "75" } })
    fireEvent.change(within(dialog).getByLabelText("Hours/month"), { target: { value: "40" } })
    fireEvent.change(within(dialog).getByLabelText("Contracted hours"), { target: { value: "100" } })
    submitFor(dialog, "Create Contract")
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce())
    // The bug read this as €75/day, 100 days: 10 h billed €93.75.
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ unit: "hour", dailyRate: 600, contractedDays: 12.5, defaultDaysPerMonth: 5 })
  })

  it("switching unit keeps what was typed worth the same: €500/day, 10 days is €62.5/h, 80 h", () => {
    const { dialog } = create()
    fireEvent.click(within(dialog).getByRole("button", { name: "Hours" }))
    expect(within(dialog).getByLabelText("Hourly rate")).toHaveValue(62.5)
    expect(within(dialog).getByLabelText("Hours/month")).toHaveValue(80)
  })

  it("edits an hourly contract in hours and sends it back in days, with no unit choice", async () => {
    const hourly: Engagement = { ...PCM, unit: "hour", dailyRate: 600, contractedDays: 12.5, defaultDaysPerMonth: 5, amendments: [] }
    const { dialog, onSubmit } = edit({ engagement: hourly })
    expect(within(dialog).queryByRole("button", { name: "Hours" })).not.toBeInTheDocument()
    expect(within(dialog).getByLabelText("Hourly rate")).toHaveValue(75)
    expect(within(dialog).getByLabelText("Hours/month")).toHaveValue(40)
    expect(within(dialog).getByLabelText("Signed hours")).toHaveValue(100)
    submitFor(dialog, "Save")
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce())
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ unit: "hour", dailyRate: 600, contractedDays: 12.5, defaultDaysPerMonth: 5 })
  })
})
