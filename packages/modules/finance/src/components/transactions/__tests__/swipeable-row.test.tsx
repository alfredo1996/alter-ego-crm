import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { SwipeableRow } from "../swipeable-row"

function drag(el: HTMLElement, path: [number, number][]) {
  const [[x0, y0], ...rest] = path
  fireEvent.touchStart(el, { touches: [{ clientX: x0, clientY: y0 }] })
  for (const [x, y] of rest) fireEvent.touchMove(el, { touches: [{ clientX: x, clientY: y }] })
  fireEvent.touchEnd(el)
}

describe("SwipeableRow", () => {
  it("deletes on a leftward swipe", () => {
    const onDelete = vi.fn()
    render(<SwipeableRow onDelete={onDelete}><p>Coffee</p></SwipeableRow>)
    drag(screen.getByText("Coffee").parentElement!, [[200, 100], [180, 102], [100, 104]])
    expect(onDelete).toHaveBeenCalledOnce()
  })

  it("never deletes on a scroll, even one that drifts sideways", () => {
    const onDelete = vi.fn()
    render(<SwipeableRow onDelete={onDelete}><p>Coffee</p></SwipeableRow>)
    // Mostly down, 90 px to the left by the end: the axis locked to vertical on the first move.
    drag(screen.getByText("Coffee").parentElement!, [[200, 100], [196, 120], [150, 220], [110, 320]])
    expect(onDelete).not.toHaveBeenCalled()
  })

  it("leaves vertical panning to the browser", () => {
    render(<SwipeableRow onDelete={() => {}}><p>Coffee</p></SwipeableRow>)
    expect(screen.getByText("Coffee").parentElement!.className).toContain("touch-pan-y")
  })
})
