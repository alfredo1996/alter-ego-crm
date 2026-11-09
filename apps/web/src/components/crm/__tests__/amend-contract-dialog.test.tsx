/**
 * The Amend Contract dialog over a fixed clock (7 Oct 2026), on the design's
 * examples: Lumon's Migration (80 days from Jan 2026, ends 31 Dec 2026) and
 * Globex's Platform (time and materials, €1,000/day, September invoiced). The
 * rules and the sentences are amendContract's and amendmentEffects' (their own
 * tests in lib/__tests__); this checks the dialog shows them, sends what they
 * return, and asks before an invoiced month moves.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

import { amendContract } from "@/lib/engagements"

import { AmendContractDialog, inDialogWords } from "../amend-contract-dialog"

import type { ContractAmendment, Engagement, Invoice, Timecard } from "@/types"

const at = new Date(2026, 0, 1)
const contract = (o: Partial<Engagement>): Engagement => ({
  id: "e1", userId: "u1", clientId: "c1", name: "Migration", opportunityId: null, dailyRate: 700, vatApplicable: false,
  contractedDays: 80, defaultDaysPerMonth: 10, startMonth: "2026-01", endMonth: "2026-12", endDate: null, isActive: true,
  notes: null, createdAt: at, updatedAt: at, ...o,
})
const ADDENDUM_2: ContractAmendment = {
  from: "2026-10", dailyRate: null, addedDays: 40, lastDay: "2027-01-31", lastDayBefore: "2026-12-31", note: "Addendum 2",
}
const RATE_2027: ContractAmendment = {
  from: "2027-01", dailyRate: 800, addedDays: null, lastDay: null, lastDayBefore: null, note: "Rate 2027",
}
const MIGRATION = contract({})
const AMENDED = contract({ endMonth: "2027-01", endDate: "2027-01-31", amendments: [ADDENDUM_2] })
// Jan 2027 lies past the end Addendum 2 extended: removing Addendum 2 first would strand it.
const STACKED = contract({ endMonth: "2027-01", endDate: "2027-01-31", amendments: [ADDENDUM_2, RATE_2027] })
const PLATFORM = contract({
  id: "e2", name: "Platform", dailyRate: 1000, contractedDays: null, defaultDaysPerMonth: 8, endMonth: null,
})
const SEP_HOURS: Timecard = {
  id: "t1", userId: "u1", engagementId: "e2", collaboratorId: null, date: "2026-09-15", hours: 64, notes: null, createdAt: at, updatedAt: at,
}
const SEP_INVOICE: Invoice = {
  id: "i1", userId: "u1", clientId: "c1", engagementId: null, number: "9/2026", fromMonth: null, yearMonth: "2026-09",
  amount: 8000, vat: 0, dueDate: null, paidDate: null, paidAccountId: null, createdAt: at, updatedAt: at,
}

beforeAll(() => vi.setSystemTime(new Date(2026, 9, 7, 12)))
afterAll(() => vi.useRealTimers())

function open(
  engagement: Engagement,
  o: { timecards?: Timecard[]; invoices?: Invoice[]; isPending?: boolean; onCloseAutoFocus?: (ev: Event) => void } = {},
) {
  const onSubmit = vi.fn()
  render(
    <AmendContractDialog
      engagement={engagement}
      clientName="Lumon Limited"
      onOpenChange={vi.fn()}
      engagements={[engagement]}
      allocations={[]}
      invoices={o.invoices ?? []}
      timecards={o.timecards ?? []}
      isPending={o.isPending ?? false}
      onSubmit={onSubmit}
      onCloseAutoFocus={o.onCloseAutoFocus}
    />,
  )
  return { dialog: screen.getByRole("dialog", { name: "Amend Contract" }), onSubmit }
}
const type = (dialog: HTMLElement, label: string, value: string) =>
  fireEvent.change(within(dialog).getByLabelText(label), { target: { value } })

describe("AmendContractDialog", () => {
  it("tells the history as a story: what was signed, then one line per amendment", () => {
    const { dialog } = open(AMENDED)
    const history = within(dialog).getByRole("region", { name: "History" })
    const rows = within(history).getAllByRole("listitem")
    // The signed end is the one Addendum 2 moved, not today's.
    expect(rows[0]).toHaveTextContent("Signed · €700/day · 80 days · from Jan 2026 · until 31 Dec 2026")
    expect(rows[1]).toHaveTextContent("Oct 2026 · +40 days · until 31 Jan 2027 · Addendum 2")
    expect(within(dialog).getByLabelText("From")).toHaveValue("2026-11")
    expect(dialog).toHaveTextContent("Months before Nov 2026 keep their terms. Amendments start on the 1st.")
  })

  it("previews the amended contract in one sentence, and sends amendContract's changes", () => {
    const { dialog, onSubmit } = open(AMENDED)
    expect(within(dialog).getByRole("button", { name: "Save Amendment" })).toBeDisabled()
    type(dialog, "From", "2027-01")
    type(dialog, "New Day Rate", "800")
    expect(dialog).toHaveTextContent("From Jan 2027: €800/day · 120 days (80 + 40) · runs out Jan 2027 · ends 31 Jan 2027")
    fireEvent.click(within(dialog).getByRole("button", { name: "Save Amendment" }))
    const expected = amendContract(AMENDED, { from: "2027-01", dailyRate: 800 }, { today: "2026-10-07", allocations: [] })
    expect(onSubmit).toHaveBeenCalledWith("changes" in expected ? expected.changes : null, expect.any(Function))
  })

  it("says nothing about running out once the contract is worked past its budget, until days are added", () => {
    const over = contract({ contractedDays: 10, startMonth: "2026-01", endMonth: "2027-06" })
    // 15 days (120 h) worked against 10.
    const hours: Timecard = { ...SEP_HOURS, id: "t2", engagementId: "e1", hours: 120 }
    const { dialog } = open(over, { timecards: [hours] })
    type(dialog, "From", "2027-01")
    type(dialog, "New Day Rate", "800")
    expect(dialog).toHaveTextContent("From Jan 2027: €800/day · 10 days · ends 30 Jun 2027")
    // 10 more days: budget 20, 15 used, so the days run out again.
    type(dialog, "Add Days", "10")
    expect(dialog).toHaveTextContent("From Jan 2027: €800/day · 20 days (10 + 10) · ran out Jan 2026 · ends 30 Jun 2027")
  })

  it.each([
    [80.032, true],
    [80.048, false],
  ])("draws the over-budget line at isOverBudget's rounding: %s h on 10 days, run-out shown: %s", (h, shown) => {
    const c = contract({ contractedDays: 10, startMonth: "2026-01", endMonth: "2027-06" })
    const { dialog } = open(c, { timecards: [{ ...SEP_HOURS, id: "t2", engagementId: "e1", hours: h }] })
    type(dialog, "From", "2027-01")
    type(dialog, "New Day Rate", "800")
    if (shown) expect(dialog).toHaveTextContent(/From Jan 2027: €800\/day · 10 days · (ran|runs) out \w{3} \d{4} · ends/)
    else expect(dialog).toHaveTextContent("From Jan 2027: €800/day · 10 days · ends 30 Jun 2027")
  })

  it("dates a renewal from the month after the end when only the new end is filled in", () => {
    const { dialog } = open(MIGRATION)
    type(dialog, "New End Date", "2027-06-30")
    expect(within(dialog).getByLabelText("From")).toHaveValue("2027-01")
    // The month moved on its own, so the help says why.
    expect(dialog).toHaveTextContent(
      "Months before Jan 2027 keep their terms. Amendments start on the 1st. Set to Jan 2027, the month after the current end: change it if the new terms start earlier.",
    )
    expect(dialog).toHaveTextContent("From Jan 2027: €700/day · 80 days · ran out Aug 2026 · ends 30 Jun 2027")
    // The budget ran out in August: amendmentEffects' warning, its month and its engine word in the dialog's.
    expect(dialog).toHaveTextContent(
      "The budget runs out before the end: Oct 2026–Jun 2027 bill less than planned. Add days from Oct 2026 if the contract includes them.",
    )
  })

  it("keeps From where it showed once a rate is typed: a new end typed next does not move it", () => {
    const { dialog, onSubmit } = open(MIGRATION)
    type(dialog, "New Day Rate", "800")
    type(dialog, "New End Date", "2027-06-30")
    expect(within(dialog).getByLabelText("From")).toHaveValue("2026-11")
    expect(dialog).toHaveTextContent("From Nov 2026: €800/day")
    fireEvent.click(within(dialog).getByRole("button", { name: "Save Amendment" }))
    expect(onSubmit.mock.calls[0][0].amendments[0]).toMatchObject({ from: "2026-11", dailyRate: 800, lastDay: "2027-06-30" })
  })

  it("starts From at the start of a contract not begun yet, which amendContract would otherwise refuse", () => {
    const { dialog } = open(contract({ startMonth: "2027-03", endMonth: "2027-12" }))
    expect(within(dialog).getByLabelText("From")).toHaveValue("2027-03")
    type(dialog, "Add Days", "20")
    expect(within(dialog).queryByRole("alert")).toBeNull()
    expect(dialog).toHaveTextContent("From Mar 2027: €700/day · 100 days (80 + 20)")
  })

  it("leaves a cleared From empty to retype, with the default it falls back to in its help", () => {
    const { dialog } = open(MIGRATION)
    type(dialog, "From", "")
    expect(within(dialog).getByLabelText("From")).toHaveValue("")
    expect(dialog).toHaveTextContent("Months before Nov 2026 keep their terms.")
    type(dialog, "Add Days", "10")
    expect(dialog).toHaveTextContent("From Nov 2026: €700/day · 90 days (80 + 10)")
  })

  it("shows amendContract's refusals inline, in the dialog's words, and keeps Save off", () => {
    const { dialog } = open(MIGRATION)
    type(dialog, "New Day Rate", "700")
    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      "The day rate in force in Nov 2026 is already €700/day: nothing to amend.",
    )
    expect(within(dialog).getByRole("button", { name: "Save Amendment" })).toBeDisabled()

    type(dialog, "New Day Rate", "")
    type(dialog, "New End Date", "2026-11-30")
    const alert = within(dialog).getByRole("alert")
    // Dates as the rest of the dialog writes them, never ISO.
    expect(alert).toHaveTextContent("The new end 30 Nov 2026 is not later than the current one (31 Dec 2026)")
    expect(alert).toHaveTextContent("To shorten it use Edit Contract.")
    expect(alert).not.toHaveTextContent("update_engagement")
  })

  it("disables Add Days on time and materials and New End Date on an open-ended contract", () => {
    const { dialog } = open(PLATFORM)
    expect(within(dialog).getByLabelText("Add Days")).toBeDisabled()
    expect(dialog).toHaveTextContent("Time and materials has no budget to add to.")
    expect(within(dialog).getByLabelText("New End Date")).toBeDisabled()
    expect(dialog).toHaveTextContent("It has no end to extend.")
  })

  it("says what Add Days adds to, and names the end only on a contract that has one", () => {
    const { dialog } = open(AMENDED)
    expect(dialog).toHaveTextContent(
      "Added to the 120 days, from Nov 2026. If they won't fit by 31 Jan 2027, also set a New End Date.",
    )
  })

  it("on an open-ended contract, never asks to extend an end it does not have", () => {
    const { dialog } = open(contract({ endMonth: null }))
    expect(dialog).toHaveTextContent("Added to the 80 days, from Nov 2026.")
    expect(dialog).not.toHaveTextContent("also set a New End Date")
  })

  it("asks before repricing an invoiced month: the € sentence, and Save and Reprice", () => {
    const { dialog, onSubmit } = open(PLATFORM, { timecards: [SEP_HOURS], invoices: [SEP_INVOICE] })
    type(dialog, "From", "2026-09")
    type(dialog, "New Day Rate", "1050")
    expect(dialog).toHaveTextContent(
      "Sep 2026 is invoiced (€8,000 across the client's contracts); this contract's 8 days there at €1,050/day instead of €1,000: €400 more to invoice (a top-up).",
    )
    expect(dialog).toHaveTextContent("To leave invoiced months alone, start from Oct 2026.")
    // The outcome sits beside the button in the pinned footer, and the button is described by it.
    const save = within(dialog).getByRole("button", { name: "Save and Reprice" })
    const summary =
      "Saving reprices Sep 2026, already invoiced: €400 more for this contract. Issued invoices stay as they are; the difference shows in your next invoice suggestion."
    expect(save.parentElement?.parentElement).toHaveTextContent(summary)
    expect(save).toHaveAccessibleDescription(expect.stringContaining(summary))
    expect(save).toHaveAccessibleDescription(expect.stringContaining("€400 more to invoice (a top-up)"))
    fireEvent.click(save)
    expect(onSubmit).toHaveBeenCalledOnce()

    // October touches nothing invoiced: a plain save.
    type(dialog, "From", "2026-10")
    expect(within(dialog).getByRole("button", { name: "Save Amendment" })).toBeEnabled()
    expect(dialog).not.toHaveTextContent("is invoiced")
    expect(dialog).not.toHaveTextContent("Saving reprices")
  })

  it("removes an amendment only through a confirm that says what the removal does", () => {
    const { dialog, onSubmit } = open(AMENDED)
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove the Oct 2026 amendment" }))
    const confirm = screen.getByRole("alertdialog", { name: "Remove Amendment" })
    expect(confirm).toHaveTextContent(
      "Removes the Oct 2026 amendment: +40 days · until 31 Jan 2027 · Addendum 2. The end goes back to 31 Dec 2026. " +
        "No invoiced month changes.",
    )
    expect(onSubmit).not.toHaveBeenCalled()
    fireEvent.click(within(confirm).getByRole("button", { name: "Remove Amendment" }))
    expect(onSubmit).toHaveBeenCalledWith(
      { amendments: [], endDate: "2026-12-31", endMonth: "2026-12" },
      expect.any(Function),
    )
  })

  it("says the rate a removal puts back", () => {
    open(STACKED)
    fireEvent.click(screen.getByRole("button", { name: "Remove the Jan 2027 amendment" }))
    expect(screen.getByRole("alertdialog", { name: "Remove Amendment" })).toHaveTextContent(
      "Removes the Jan 2027 amendment: €800/day · Rate 2027. From Jan 2027 the rate goes back to €700/day.",
    )
  })

  it("refuses a removal that would strand a later amendment, naming which goes first, with OK alone", () => {
    const { onSubmit } = open(STACKED)
    fireEvent.click(screen.getByRole("button", { name: "Remove the Oct 2026 amendment" }))
    const refusal = screen.getByRole("alertdialog", { name: "Can't Remove Oct 2026 Yet" })
    expect(refusal).toHaveTextContent(
      "Remove the Jan 2027 amendment first: without Oct 2026 the contract ends 31 Dec 2026, before Jan 2027.",
    )
    expect(within(refusal).getAllByRole("button").map((b) => b.textContent)).toEqual(["OK"])
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it("puts focus back on the row's Remove when the confirm is cancelled", async () => {
    open(AMENDED)
    const remove = screen.getByRole("button", { name: "Remove the Oct 2026 amendment" })
    fireEvent.click(remove)
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Cancel" }))
    await waitFor(() => expect(remove).toHaveFocus())
  })

  it("holds Remove while a write lands: a second one would rewrite the list from before the first", () => {
    const { dialog } = open(AMENDED, { isPending: true })
    expect(within(dialog).getByRole("button", { name: "Remove the Oct 2026 amendment" })).toBeDisabled()
  })

  it("hands focus back to its caller when it closes: it has no trigger of its own", async () => {
    const onCloseAutoFocus = vi.fn()
    const props = {
      clientName: "Lumon Limited", onOpenChange: vi.fn(), engagements: [AMENDED], allocations: [], invoices: [],
      timecards: [], isPending: false, onSubmit: vi.fn(), onCloseAutoFocus,
    }
    const { rerender } = render(<AmendContractDialog engagement={AMENDED} {...props} />)
    // The shell closes it by dropping the contract, on Escape, Cancel or a save.
    rerender(<AmendContractDialog engagement={null} {...props} />)
    await waitFor(() => expect(onCloseAutoFocus).toHaveBeenCalledOnce())
  })
})

describe("inDialogWords", () => {
  it("names the dialog's fields and Edit Contract instead of the tool's parameters", () => {
    expect(inDialogWords("dailyRate is more than 0 and at most 100000 €/day.")).toBe(
      "New Day Rate is more than 0 and at most 100000 €/day.",
    )
    expect(inDialogWords("…would never apply. Pass a new end (endDate or endMonth) to extend it too.")).toBe(
      "…would never apply. Set a New End Date to extend it too.",
    )
  })

  it("writes ISO dates as the dialog does, and the engine's words as the owner's", () => {
    expect(
      inDialogWords(
        "The contract ends on 2027-01-31: extending it from Mar 2027 leaves a gap that would fill with default days. " +
          "Start the renewal from 2027-02 and set the gap months to 0 in the Plan, or make it a new contract.",
      ),
    ).toBe(
      "The contract ends on 31 Jan 2027: extending it from Mar 2027 leaves a gap that would fill with default days. " +
        "Start the renewal from Feb 2027 and set the months in between to 0 in the Plan, or make it a new contract.",
    )
    expect(inDialogWords("Jan 2027 stays capped. Add days from 2027-01 if the contract includes them.")).toBe(
      "Jan 2027 bills less than planned. Add days from Jan 2027 if the contract includes them.",
    )
    // A browser without a month picker hands over what is typed so far.
    expect(inDialogWords('from is a month as YYYY-MM, 01 to 12: "2026-1" is not one.')).toBe(
      'From is a month as YYYY-MM: "2026-1" is not one.',
    )
    expect(inDialogWords("€650 less, so €650 reads as invoiced ahead: issue a credit note")).toBe(
      "€650 less, so €650 is invoiced ahead: issue a credit note",
    )
  })
})

describe("AmendContractDialog on an hourly contract", () => {
  // €75/h for 100 h, stored as €600/day for 12.5 days; ends Dec 2026.
  const HOURLY = contract({ unit: "hour", dailyRate: 600, contractedDays: 12.5, defaultDaysPerMonth: 5, startMonth: "2026-01" })

  it("asks in hours and €/h, previews in them, and sends days and €/day", () => {
    const { dialog, onSubmit } = open(HOURLY)
    expect(dialog).toHaveTextContent("Signed · €75/h · 100 hours · from Jan 2026 · until 31 Dec 2026")
    expect(within(dialog).getByLabelText("New Hourly Rate")).toHaveAttribute("placeholder", "75")
    type(dialog, "New Hourly Rate", "80")
    type(dialog, "Add Hours", "40")
    expect(dialog).toHaveTextContent("From Nov 2026: €80/h · 140 hours (100 + 40)")
    fireEvent.click(within(dialog).getByRole("button", { name: "Save Amendment" }))
    // €80/h is €640/day and 40 h is 5 days: what amendContract and every money path read.
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ amendments: [expect.objectContaining({ from: "2026-11", dailyRate: 640, addedDays: 5 })] }),
      expect.any(Function),
    )
  })
})
