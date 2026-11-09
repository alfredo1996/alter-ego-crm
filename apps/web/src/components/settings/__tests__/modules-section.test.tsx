import { render, screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { ModulesSection } from "../modules-section"

const rows = () => {
  const card = screen.getByRole("region", { name: "Modules" })
  return [...card.lastElementChild!.children].map((row) => row.textContent)
}

describe("ModulesSection", () => {
  it("lists the five modules with what they add and a word for On or Off", () => {
    render(<ModulesSection isOn={(id) => id !== "invoicing" && id !== "solutions"} leftOut={{ variable: "NEXT_PUBLIC_DISABLED_MODULES", value: "invoicing,solutions" }} />)
    expect(rows()).toEqual([
      "CRMPipeline, clients and contracts, collaborators, tasks, the Plan and deadlines.On",
      "InvoicingNeeds CRMInvoices and credit notes, unbilled hours, invoice files.Off",
      "BooksCash book, costs, the runway and Month End.On",
      "SolutionsNeeds CRMThe solution catalog and its data model graph.Off",
      "RentNeeds BooksTenants and yearly leases.On",
      "Left OutSet by NEXT_PUBLIC_DISABLED_MODULES where the app is deployed. A change applies on the next deploy.invoicing,solutions",
    ])
  })

  it("says none when nothing is left out", () => {
    render(<ModulesSection isOn={() => true} leftOut={{ variable: "NEXT_PUBLIC_DISABLED_MODULES", value: "none" }} />)
    expect(within(screen.getByRole("region", { name: "Modules" })).queryAllByText("Off")).toHaveLength(0)
    expect(screen.getByText("none")).toBeInTheDocument()
  })
})
