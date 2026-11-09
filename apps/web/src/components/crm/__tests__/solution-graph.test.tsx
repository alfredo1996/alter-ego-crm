/**
 * The data model graph drawn, on the fictional Nordwind Retail S.p.A. "Product
 * knowledge graph". The layout's rules are lib/__tests__/solution-graph.test.ts;
 * this pins the drawing (a snapshot at a phone's width) and what a screen
 * reader and a hover are told.
 */
import { act, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { SolutionGraph } from "../solution-graph"

// happy-dom never lays out: the observer is driven by hand, as a resize would.
let resize: (width: number) => void
beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private cb: ResizeObserverCallback) {}
      observe() {
        resize = (width) => this.cb([{ contentRect: { width } } as ResizeObserverEntry], this as unknown as ResizeObserver)
      }
      disconnect() {}
    },
  )
})
afterEach(() => vi.unstubAllGlobals())

const entity = (name: string, source: string | null) => ({ name, source, notes: null })
const entities = [
  entity("Product", "SAP MARA"),
  entity("Category", "SAP T179"),
  entity("Supplier", "SAP LFA1"),
  entity("Order", "Shop orders"),
  entity("Customer", "CRM contacts"),
  entity("SearchQuery", null),
]
const relations = [
  { from: "Supplier", to: "Product", type: "SUPPLIES" },
  { from: "Product", to: "Category", type: "IN_CATEGORY" },
  { from: "Order", to: "Product", type: "CONTAINS" },
  { from: "Customer", to: "Order", type: "PLACED" },
  { from: "SearchQuery", to: "Product", type: "RETURNED" },
  { from: "Product", to: "Product", type: "SIMILAR_TO" },
]

function draw(width: number, e = entities, r = relations) {
  const view = render(<SolutionGraph entities={e} relations={r} />)
  act(() => resize(width))
  return view
}

describe("SolutionGraph", () => {
  it("draws nothing until its width is known", () => {
    const { container } = render(<SolutionGraph entities={entities} relations={relations} />)
    expect(container.querySelector("svg")).toBeNull()
  })

  it("draws the Nordwind model at a phone's width", () => {
    const { container } = draw(326)
    const svg = screen.getByRole("img", { name: "Data model graph: 6 entities, 6 relations" })
    expect(svg).toBe(container.querySelector("svg"))
    expect(svg).toMatchSnapshot()
  })

  it("draws at its container's width, its text 12 px and up", () => {
    const { container } = draw(326)
    const svg = container.querySelector("svg")!
    expect(svg.getAttribute("width")).toBe("326")
    expect(svg.getAttribute("viewBox")).toMatch(/^0 0 326 \d+/)
    const sizes = [...svg.querySelectorAll("text")].map((t) => Number(t.getAttribute("class")!.match(/text-\[(\d+)px\]/)![1]))
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(12)
  })

  it("names each entity with its source, each relation in words, and says the counts", () => {
    draw(700)
    const svg = screen.getByRole("img", { name: "Data model graph: 6 entities, 6 relations" })
    const titles = [...svg.querySelectorAll("title")].map((t) => t.textContent)
    expect(titles).toContain("Product, from SAP MARA")
    expect(titles).toContain("SearchQuery, derived")
    expect(titles).toContain("Supplier SUPPLIES Product")
    expect(titles).toContain("Product SIMILAR_TO Product")
    expect(svg.querySelector("desc")).toHaveTextContent("Supplier SUPPLIES Product. Product IN_CATEGORY Category.")
    // The name in the box, the source under it, "derived" where there is none.
    expect(svg).toHaveTextContent(/ProductSAP MARA/)
    expect(svg).toHaveTextContent(/SearchQueryderived/)
  })

  it("says one entity and one relation in the singular", () => {
    draw(700, [entity("Product", null)], [{ from: "Product", to: "Product", type: "SIMILAR_TO" }])
    expect(screen.getByRole("img", { name: "Data model graph: 1 entity, 1 relation" })).toBeInTheDocument()
  })

  it("fits its text to a canvas's widths where there is one, in the fonts it draws with", () => {
    const fonts = new Set<string>()
    // happy-dom has no canvas: this one says 20 px a character, so "Category" no longer fits a 160 px box.
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      set font(font: string) {
        fonts.add(font.split(" ").slice(0, 2).join(" "))
      },
      measureText: (text: string) => ({ width: [...text].length * 20 }),
    } as unknown as CanvasRenderingContext2D)
    const { container } = draw(700)
    const texts = [...container.querySelectorAll("text")].map((t) => t.textContent)
    expect(texts).toContain("Catego…")
    expect(texts).toContain("Product")
    // The name's weight and size; the source's and the label's.
    expect([...fonts].sort()).toEqual(["400 12px", "500 13px"])
    vi.restoreAllMocks()
  })

  it("scrolls in its own box, never the page, when not even one box fits", () => {
    const { container } = draw(90)
    const svg = container.querySelector("svg")!
    expect(Number(svg.getAttribute("width"))).toBeGreaterThan(90)
    expect(svg.parentElement).toHaveClass("overflow-x-auto")
  })
})
