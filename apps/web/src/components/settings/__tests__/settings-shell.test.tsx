import { render, screen, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { useSettingsStore } from "@/stores/settings-store"

import { SettingsShell } from "../settings-shell"

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ user: { id: "u1", email: "a@example.com", displayName: "Dana" }, loading: false, refreshUser: vi.fn() }),
}))
vi.mock("@alter-ego/ui/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }))
vi.mock("@/components/settings/api-keys-section", () => ({ ApiKeysSection: () => null }))
vi.mock("@/components/settings/connectors-section", () => ({ ConnectorsSection: () => null }))

describe("SettingsShell", () => {
  beforeEach(() => {
    useSettingsStore.setState({ theme: "system" })
  })

  it("offers the theme alone under Preferences: nothing reads a currency, a locale or an AI mode", () => {
    render(<SettingsShell />)
    expect(screen.getByRole("group", { name: "Theme" })).toBeInTheDocument()
    for (const name of ["Currency", "AI Features"]) expect(screen.queryByRole("group", { name })).toBeNull()
    expect(screen.queryByText("Language and Format")).toBeNull()
  })

  it("gives every section its own heading and an index link to it, Modules after Preferences", () => {
    render(<SettingsShell />)
    const index = screen.getByRole("navigation", { name: "On this page" })
    const names = ["Profile", "Preferences", "Modules", "Data"]
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual(names)
    for (const name of names) {
      expect(within(index).getByRole("link", { name })).toBeInTheDocument()
    }
    expect(within(index).getByRole("link", { name: "Modules" })).toHaveAttribute("href", "#modules")
  })

  it("has no company switch: the company side is the only product", () => {
    render(<SettingsShell />)
    expect(screen.queryByRole("switch", { name: "Show company features" })).toBeNull()
  })
})
