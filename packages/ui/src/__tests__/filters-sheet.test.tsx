import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { FiltersSheet } from "../filters-sheet"

describe("FiltersSheet", () => {
  it("counts the filters that are set, and mounts them only while open", () => {
    render(<FiltersSheet active={2}><label>Status<input /></label></FiltersSheet>)
    expect(screen.queryByLabelText("Status")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Filters (2)" }))
    const sheet = screen.getByRole("dialog", { name: "Filters" })
    expect(sheet).toContainElement(screen.getByLabelText("Status"))
    fireEvent.click(screen.getByRole("button", { name: "Done" }))
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("takes focus inside the sheet, and gives it back to the button on Done", async () => {
    render(<FiltersSheet active={0}><label>Status<input /></label></FiltersSheet>)
    const button = screen.getByRole("button", { name: "Filters" })
    button.focus()
    fireEvent.click(button)
    // The sheet itself, not the close X or the first control: the trap holds from here.
    expect(document.activeElement).toBe(screen.getByRole("dialog", { name: "Filters" }))
    fireEvent.click(screen.getByRole("button", { name: "Done" }))
    // Radix hands it back a tick after the sheet unmounts.
    await waitFor(() => expect(document.activeElement).toBe(button))
  })

  it("reads plain Filters when none is set", () => {
    render(<FiltersSheet active={0}>x</FiltersSheet>)
    expect(screen.getByRole("button", { name: "Filters" })).toBeInTheDocument()
  })
})
