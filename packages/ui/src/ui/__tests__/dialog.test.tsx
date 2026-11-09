import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { Button } from "../button"
import { Dialog, DialogContent, DialogFooter, DialogTitle } from "../dialog"

// happy-dom has no layout: these pin the classes the phone behaviour rests on;
// e2e/mobile.spec.ts checks the result in a real browser.
function open(footerClass?: string) {
  render(
    <Dialog open>
      <DialogContent aria-describedby={undefined}>
        <DialogTitle>New Cost</DialogTitle>
        <form>
          <DialogFooter className={footerClass}>
            <Button type="submit">Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>,
  )
  return screen.getByRole("button", { name: "Save" }).parentElement!
}

describe("DialogFooter", () => {
  it("sticks to the bottom of the dialog's scroll at every width, across its padding, as a hairline bar", () => {
    const footer = open()
    for (const c of ["sticky", "-bottom-6", "-mx-6", "-mb-6", "bg-background", "border-t", "border-hairline"]) {
      expect(footer).toHaveClass(c)
    }
    // The negative margins cancel exactly the content's p-6.
    expect(screen.getByRole("dialog")).toHaveClass("p-6")
  })

  it("lays its buttons out in a row at every width, not a stack", () => {
    const footer = open()
    expect(footer).toHaveClass("flex", "flex-wrap", "justify-end", "gap-2")
    expect(footer).not.toHaveClass("flex-col-reverse")
  })

  it("keeps a caller's layout classes", () => {
    expect(open("justify-between")).toHaveClass("justify-between")
  })
})

describe("DialogContent", () => {
  it("uses a minmax(0,1fr) column, so a long nowrap child cannot widen the dialog", () => {
    open()
    expect(screen.getByRole("dialog")).toHaveClass("grid-cols-[minmax(0,1fr)]")
  })

  it("is rounded at every width and has a 44 px close button", () => {
    open()
    expect(screen.getByRole("dialog")).toHaveClass("rounded-2xl")
    expect(screen.getByRole("button", { name: "Close" })).toHaveClass("size-11")
  })
})
