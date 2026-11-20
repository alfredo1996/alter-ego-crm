import { act, render } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { InOutChart } from "../in-out-chart"
import { NetWorthChart } from "../net-worth-chart"

import type { MonthlySummary } from "../../../types"

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

const month = (i: number, income: number, expenses: number): MonthlySummary => ({
  month: `2026-${String(i).padStart(2, "0")}`,
  income,
  expenses,
  net: income - expenses,
})
const four = [month(7, 2850, 1660.83), month(8, 3450, 1772.73), month(9, 2850, 1840.88), month(10, 2850, 1488.93)]
const year = Array.from({ length: 12 }, (_, i) => month(i + 1, 3000, 1000 + i * 50))
const eur = (n: number) => `€${n.toFixed(2)}`
const compact = (n: number) => (n === 0 ? "€0" : `€${n / 1000}K`)
const whole = (n: number) => `€${Math.round(n).toLocaleString("en-US")}`
const labels = (c: HTMLElement) => [...c.querySelectorAll("text")].map((t) => t.textContent)

describe("InOutChart", () => {
  it("draws a green and a dark bar per month, rounded ticks, and the net under each month", () => {
    const { container } = render(<InOutChart months={four} focusMonth="2026-10" focusLabel="Oct · to 15th" format={eur} whole={whole} compact={compact} />)
    act(() => resize(620))
    expect(container.querySelectorAll("path.fill-income")).toHaveLength(4)
    expect(container.querySelectorAll("path.fill-foreground")).toHaveLength(4)
    // 3,450 at most: 0 to 4K in 1K steps, not 862 apiece.
    expect(labels(container).filter((t) => /^€\dK$/.test(t!))).toEqual(["€1K", "€2K", "€3K", "€4K"])
    expect(labels(container)).toEqual(expect.arrayContaining(["Jul", "Aug", "Sep", "Oct · to 15th", "+€1,189", "+€1,677", "+€1,009", "+€1,361"]))
    // The focus month names its two bars.
    expect(labels(container)).toEqual(expect.arrayContaining(["€2,850", "€1,489"]))
  })

  it("is one picture with the whole story as its name", () => {
    const { container } = render(<InOutChart months={four} format={eur} whole={whole} compact={compact} />)
    expect(container.querySelector("svg")!.getAttribute("aria-label")).toBe(
      "Money in and out by month. Jul: in €2850.00, out €1660.83, net +€1189.17. Aug: in €3450.00, out €1772.73, net +€1677.27. Sep: in €2850.00, out €1840.88, net +€1009.12. Oct: in €2850.00, out €1488.93, net +€1361.07.",
    )
  })

  it("labels every other month of a year on a phone, every month on a desktop card", () => {
    const { container } = render(<InOutChart months={year} format={eur} whole={whole} compact={compact} />)
    act(() => resize(293))
    const names = (c: HTMLElement) => labels(c).filter((t) => /^[A-Z][a-z]{2}$/.test(t!))
    expect(container.querySelector("svg")!.getAttribute("viewBox")).toMatch(/^0 0 293 /)
    expect(names(container)).toHaveLength(6)
    act(() => resize(620))
    expect(names(container)).toHaveLength(12)
  })

  it("keeps a month with nothing in it as an empty column, and a negative net signed", () => {
    const { container } = render(<InOutChart months={[month(8, 0, 0), month(9, 100, 250)]} format={eur} whole={whole} compact={compact} />)
    act(() => resize(620))
    expect(labels(container)).toEqual(expect.arrayContaining(["Aug", "Sep", "€0", "−€150"]))
  })
})

describe("NetWorthChart", () => {
  const snap = (i: number, netWorth: number) => ({ id: String(i), userId: "u", date: new Date(2026, i, 28), netWorth, totalAssets: 0, totalLiabilities: 0 })
  it("draws at its card's width, a dot per snapshot, every other date on a phone, the first value and the last date as Today", () => {
    const data = [snap(6, 12719.22), snap(7, 14396.49), snap(8, 15405.61), { ...snap(9, 16766.68), date: new Date() }]
    const { container } = render(<NetWorthChart data={data as never} format={eur} whole={whole} compact={compact} />)
    act(() => resize(293))
    expect(container.querySelector("svg")!.getAttribute("viewBox")).toMatch(/^0 0 293 /)
    expect(container.querySelectorAll("circle")).toHaveLength(4)
    expect(labels(container)).toEqual(expect.arrayContaining(["28 Jul", "28 Sep", "Today", "€12,719"]))
  })
})
