import { render, screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { ModulesSection } from "../modules-section"

const rows = () => {
  const card = screen.getByRole("region", { name: "Plugins" })
  return [...card.lastElementChild!.children].map((row) => row.textContent)
}

describe("ModulesSection", () => {
  it("lists the three plugins with what they add and a word for On or Off", () => {
    render(
      <ModulesSection isOn={(id) => id === "consulting"} selection={{ variable: "NEXT_PUBLIC_PLUGINS", value: "consulting" }} />,
    )
    expect(rows()).toEqual([
      "ConsultingPipeline, clients and contracts, collaborators, tasks, the Plan, deadlines and the solution catalog.On",
      "AccountingNeeds ConsultingInvoices and their files, the cash book, costs, the runway and Month End.Off",
      "RentNeeds AccountingTenants and yearly leases.Off",
      "Plugins ListedSet by NEXT_PUBLIC_PLUGINS where the app is deployed. A change applies on the next deploy.consulting",
    ])
  })

  it("lists every plugin when all are on", () => {
    render(<ModulesSection isOn={() => true} selection={{ variable: "NEXT_PUBLIC_PLUGINS", value: "consulting,accounting,rent" }} />)
    expect(within(screen.getByRole("region", { name: "Plugins" })).queryAllByText("Off")).toHaveLength(0)
    expect(screen.getByText("consulting,accounting,rent")).toBeInTheDocument()
  })
})
