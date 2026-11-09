import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { ContractRemainingLines } from "../contract-remaining"

const props = { cells: [], today: "2026-10-19" }
const card = (hours: number) => [{ engagementId: "e1", date: "2026-10-05", hours }]

describe("ContractRemainingLines", () => {
  it("an hourly contract worked beyond its budget reads 3 h over budget of 100, and no plan reads 0 h not planned", () => {
    render(<ContractRemainingLines {...props} unit="hour" engagement={{ id: "e1", contractedDays: 12.5 }} timecards={card(103)} />)
    expect(screen.getByText(/3 h over budget/).parentElement?.textContent).toBe("3 h over budget of 100")
    expect(screen.getByText(/3 h over budget/).className).toContain("text-danger")
    expect(screen.getByText("0 h not planned")).toBeTruthy()
  })

  it("within the budget it still reads left of", () => {
    render(<ContractRemainingLines {...props} unit="hour" engagement={{ id: "e1", contractedDays: 12.5 }} timecards={card(100)} />)
    expect(screen.getByText(/left of 100/)).toBeTruthy()
  })

  it("over budget starts above half a hundredth of a day, as over plan does", () => {
    const day = { ...props, unit: "day" as const, engagement: { id: "e1", contractedDays: 12.5 } }
    const { unmount } = render(<ContractRemainingLines {...day} timecards={card(100.032)} />) // 0.004 d over
    expect(screen.getByText(/left of 12.5/)).toBeTruthy()
    unmount()
    render(<ContractRemainingLines {...day} timecards={card(100.048)} />) // 0.006 d over
    expect(screen.getByText(/0.01 d over budget/)).toBeTruthy()
  })
})
