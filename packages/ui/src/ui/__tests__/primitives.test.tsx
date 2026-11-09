import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { Badge } from "../badge"
import { Button } from "../button"
import { Card, CardContent } from "../card"
import { Command, CommandInput } from "../command"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem } from "../dropdown-menu"
import { Input } from "../input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../table"
import { Textarea } from "../textarea"

// happy-dom has no layout: these pin the classes the redesign's promises rest on
// (Components.dc); e2e/mobile.spec.ts checks the phone results in a real browser.
describe("redesigned primitives", () => {
  it("Badge: the shadcn names map onto the soft tones, and the tones exist", () => {
    render(
      <>
        <Badge variant="destructive">Overdue</Badge>
        <Badge variant="secondary">Draft</Badge>
        <Badge variant="success">Paid</Badge>
      </>,
    )
    expect(screen.getByText("Overdue")).toHaveClass("rounded-full", "bg-danger-soft", "text-danger-soft-foreground")
    expect(screen.getByText("Draft")).toHaveClass("bg-muted", "text-subtle-foreground")
    expect(screen.getByText("Paid")).toHaveClass("bg-success-soft", "text-success-soft-foreground")
  })

  it("Button: a 44 px icon size with a mouse too, and the touch floor on the others", () => {
    render(
      <>
        <Button size="icon-lg" aria-label="More" />
        <Button size="sm">Small</Button>
      </>,
    )
    expect(screen.getByRole("button", { name: "More" })).toHaveClass("size-11")
    expect(screen.getByRole("button", { name: "Small" })).toHaveClass("h-9", "pointer-coarse:min-h-11")
  })

  it("Button: a caller's text size beats the small size's responsive one", () => {
    render(
      <Button size="sm" className="text-xs">
        Tiny
      </Button>,
    )
    const button = screen.getByRole("button", { name: "Tiny" })
    expect(button).toHaveClass("text-xs")
    expect(button.className).not.toContain("--button-sm-text")
  })

  it("Input, Textarea, CommandInput: a caller's text-sm never takes a touch screen under 16 px", () => {
    // iOS zooms into a text field under 16 px on focus; Playwright's Pixel 5 cannot see it. Important,
    // so a parent's [&_input]:text-sm (0,1,1) cannot beat it either (e2e: the Cash Book on a touch tablet).
    render(
      <>
        <Input aria-label="Task" className="h-8 text-sm" />
        <Textarea aria-label="Notes" className="text-sm" />
        <Command>
          <CommandInput aria-label="Search" className="text-sm" />
        </Command>
      </>,
    )
    for (const name of ["Task", "Notes", "Search"]) {
      expect(screen.getByLabelText(name)).toHaveClass("text-sm", "pointer-coarse:text-base!")
    }
  })

  it("Table: 48 px rows from sm up only, so a phone keeps its compact rows", () => {
    render(
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Amount</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>€42.10</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    )
    const cell = screen.getByRole("cell", { name: "€42.10" })
    expect(cell).toHaveClass("p-2", "sm:h-12", "sm:px-4")
    expect(cell.className).not.toMatch(/(^|\s)h-12(\s|$)/)
    expect(screen.getByRole("table")).toHaveClass("tabular-nums")
  })

  it("Card: a caller's padding still beats the card padding token", () => {
    render(
      <Card>
        <CardContent className="p-0">body</CardContent>
      </Card>,
    )
    expect(screen.getByText("body").className).toBe("p-0")
  })

  it("DropdownMenuItem: a destructive variant, the menu's one red item", () => {
    render(
      <DropdownMenu open>
        <DropdownMenuContent>
          <DropdownMenuItem>Edit</DropdownMenuItem>
          <DropdownMenuItem variant="destructive">Delete</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    )
    expect(screen.getByRole("menuitem", { name: "Delete" })).toHaveClass("text-danger-soft-foreground")
    expect(screen.getByRole("menuitem", { name: "Edit" })).not.toHaveClass("text-danger-soft-foreground")
  })
})
