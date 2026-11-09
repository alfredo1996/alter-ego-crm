import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../alert-dialog"

describe("AlertDialogContent", () => {
  it("keeps a gutter on a phone and scrolls inside itself, left-aligned like Dialog", () => {
    render(
      <AlertDialog open>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Cost</AlertDialogTitle>
            <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>,
    )
    const dialog = screen.getByRole("alertdialog")
    expect(dialog).toHaveClass("w-[calc(100%-2rem)]", "max-w-[420px]", "rounded-2xl", "max-h-[calc(100dvh-2rem)]", "overflow-y-auto")
    expect(dialog).not.toHaveClass("w-full")
    expect(screen.getByText("Delete Cost").parentElement).toHaveClass("text-left")
  })
})
