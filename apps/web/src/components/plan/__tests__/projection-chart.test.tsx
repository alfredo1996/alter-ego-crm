import { act, render } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ProjectionChart } from "../projection-chart"

import type { ProjectionMonth } from "@/lib/projection"

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

const months: ProjectionMonth[] = Array.from({ length: 24 }, (_, i) => ({
  yearMonth: `${2026 + Math.floor((i + 9) / 12)}-${String(((i + 9) % 12) + 1).padStart(2, "0")}`,
  lines: [],
  revenue: 10_000 + i * 100,
  costs: 2_000,
  collaborators: 0,
  otherCosts: 2_000,
}))

describe("ProjectionChart", () => {
  it("draws at its container's width, so a phone gets real 11 px labels and no side scroll", () => {
    const { container } = render(<ProjectionChart timeline={months} />)
    act(() => resize(325))
    const svg = container.querySelector("svg")!
    expect(svg.getAttribute("viewBox")).toBe("0 0 325 226")
    expect(svg.getAttribute("style")).toBeNull()
    expect(container.querySelector(".overflow-x-auto")).toBeNull()
    const labels = [...svg.querySelectorAll("text")]
    expect(labels.every((t) => t.getAttribute("class")!.includes("text-[11px]"))).toBe(true)
    // 265 px of plot holds nine 28 px month labels: every third of 24 months.
    const monthLabels = labels.filter((t) => /^\d\d$/.test(t.textContent!))
    expect(monthLabels).toHaveLength(8)
  })

  it("labels every month when the width allows", () => {
    const { container } = render(<ProjectionChart timeline={months.slice(0, 12)} />)
    act(() => resize(900))
    const monthLabels = [...container.querySelectorAll("text")].filter((t) => /^\d\d$/.test(t.textContent!))
    expect(monthLabels).toHaveLength(12)
  })

  it("draws one bar a month, Net under Costs, the whole bar the Gross, on € ticks", () => {
    const { container } = render(<ProjectionChart timeline={months.slice(0, 2)} />)
    act(() => resize(700))
    // 10,000 and 10,100 gross: ticks at 4k, 8k, 12k.
    const ticks = [...container.querySelectorAll("text")].map((t) => t.textContent).filter((t) => t!.startsWith("€"))
    expect(ticks).toEqual(["€0", "€4k", "€8k", "€12k"])
    const [costs, net] = [...container.querySelectorAll("g > rect")].slice(0, 2).map((r) => Number(r.getAttribute("height")))
    // 180 px for 12,000: 2,000 of costs is 30 px, 8,000 of net 120 px.
    expect(costs).toBeCloseTo(30)
    expect(net).toBeCloseTo(120)
  })

  it("draws a month whose costs pass its gross as all Costs, never a negative bar", () => {
    const loss = [{ ...months[0], revenue: 1_000, costs: 2_000 }]
    const { container } = render(<ProjectionChart timeline={loss} />)
    act(() => resize(700))
    const heights = [...container.querySelectorAll("g > rect")].map((r) => Number(r.getAttribute("height")))
    expect(heights.every((h) => h >= 0)).toBe(true)
    expect(heights[1]).toBe(0)
  })
})
