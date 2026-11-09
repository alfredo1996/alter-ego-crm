import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { DateRangePicker } from "../date-range-picker"

function phone(on: boolean) {
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query) => ({ matches: on && query === "(max-width: 639px)" }) as MediaQueryList,
  )
}
afterEach(() => vi.restoreAllMocks())

describe("DateRangePicker", () => {
  it("opens one month in a dialog on a phone, and gives focus back to its button", async () => {
    phone(true)
    const onChange = vi.fn()
    render(<DateRangePicker onChange={onChange} placeholder="Filter by date range" />)
    const trigger = screen.getByRole("button", { name: "Filter by date range" })
    fireEvent.click(trigger)

    // A Dialog, not the popover: it has a title and the dialog's Close button.
    const dialog = await screen.findByRole("dialog", { name: "Date Range" })
    expect(within(dialog).getByRole("button", { name: "Close" })).toBeInTheDocument()
    expect(within(dialog).getAllByRole("grid")).toHaveLength(1)

    fireEvent.click(within(dialog).getByRole("button", { name: "Last 7 days" }))
    expect(onChange).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    expect(trigger).toHaveFocus()
  })

  it("keeps the popover beside the trigger on a wider screen, with two months", async () => {
    phone(false)
    render(<DateRangePicker />)
    fireEvent.click(screen.getByRole("button", { name: "Pick a date range" }))

    const popover = await screen.findByRole("dialog")
    expect(within(popover).queryByRole("button", { name: "Close" })).not.toBeInTheDocument()
    expect(within(popover).getAllByRole("grid")).toHaveLength(2)
    // A fixed presets column: at its max-content it was all eight buttons in one line wide.
    expect(within(popover).getByRole("button", { name: "Today" }).parentElement).toHaveClass("sm:w-36", "sm:shrink-0", "sm:flex-col")
  })
})
