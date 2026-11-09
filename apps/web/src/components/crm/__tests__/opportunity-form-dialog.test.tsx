/**
 * New Opportunity in hours: the form takes €/h and hours a month, and stores the deal in days, so its
 * contract and the projection read the same money (#249).
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { OpportunityFormDialog } from "../opportunity-form-dialog"

import type { Opportunity } from "@/types"

function open(opportunity?: Opportunity) {
  const onSubmit = vi.fn()
  render(
    <OpportunityFormDialog
      open
      onOpenChange={vi.fn()}
      opportunity={opportunity}
      defaultClientId="c1"
      clients={[{ id: "c1", name: "Lumen Srl" } as never]}
      onCreateClient={vi.fn()}
      onSubmit={onSubmit}
      isPending={false}
    />,
  )
  const dialog = screen.getByRole("dialog", { name: opportunity ? "Edit Opportunity" : "New Opportunity" })
  // happy-dom fails a whole-euro rate against step 0.01 (floating point) and blocks the submit: the zod schema is the check.
  dialog.querySelector("form")!.noValidate = true
  return { dialog, onSubmit }
}

describe("OpportunityFormDialog, in hours", () => {
  it("names the unit choice \"Unit\", by a visible label tied to the group", () => {
    const { dialog } = open()
    expect(within(dialog).getByRole("group", { name: "Unit" })).toContainElement(within(dialog).getByRole("button", { name: "Hours" }))
    expect(within(dialog).queryByText("Quoted in")).toBeNull()
  })

  it("takes €75/h for 40 h a month and stores €600/day for 5 days", async () => {
    const { dialog, onSubmit } = open()
    fireEvent.change(within(dialog).getByLabelText("Title"), { target: { value: "Support" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Hours" }))
    fireEvent.change(within(dialog).getByLabelText("Hourly rate"), { target: { value: "75" } })
    fireEvent.change(within(dialog).getByLabelText("Hours/month"), { target: { value: "40" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Create Opportunity" }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce())
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ unit: "hour", dailyRate: 600, estimatedDaysPerMonth: 5 })
  })

  it("edits a stored hourly deal in hours, with no unit choice", () => {
    const deal = {
      id: "o1", userId: "u1", clientId: "c1", title: "Support", stage: "lead", probability: 20, unit: "hour", dailyRate: 600,
      estimatedDaysPerMonth: 5, estimatedDurationMonths: 6, expectedStartMonth: null, vatApplicable: true,
      nextActionDate: null, nextActionNote: null, notes: null, lostReason: null,
    } as unknown as Opportunity
    const { dialog } = open(deal)
    expect(within(dialog).queryByRole("button", { name: "Hours" })).not.toBeInTheDocument()
    expect(within(dialog).getByLabelText("Hourly rate")).toHaveValue(75)
    expect(within(dialog).getByLabelText("Hours/month")).toHaveValue(40)
  })
})
