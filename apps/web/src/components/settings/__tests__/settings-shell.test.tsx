import { render, screen, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { useSettingsStore } from "@/stores/settings-store"

import { SettingsShell } from "../settings-shell"

import type * as Modules from "@/modules"

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ user: { id: "u1", email: "a@example.com", displayName: "Dana" }, loading: false, refreshUser: vi.fn() }),
}))
vi.mock("@alter-ego/ui/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }))
vi.mock("@/components/settings/api-keys-section", () => ({ ApiKeysSection: () => null }))
vi.mock("@/components/settings/connectors-section", () => ({ ConnectorsSection: () => null }))

// Whether Personal Finance is listed is the one thing each case sets; every other plugin follows the default.
const finance = vi.hoisted(() => ({ on: false }))
vi.mock("@/modules", async (orig) => {
  const mod = await orig<typeof Modules>()
  return { ...mod, isModuleOn: (id: Parameters<typeof mod.isModuleOn>[0]) => (id === "finance" ? finance.on : mod.isModuleOn(id)) }
})
// The package's own sections need its host, a query client and a backend; their own tests cover them.
vi.mock("@alter-ego/finance/settings", () => ({
  FinancePreferenceRows: () => <div>Finance preference rows</div>,
  FinanceSettings: ({ children }: { children?: React.ReactNode }) => (
    <>
      <section aria-labelledby="sorting-h">
        <h2 id="sorting-h">Categories &amp; Tags</h2>
      </section>
      <section aria-labelledby="data-h">
        <h2 id="data-h">Data</h2>
        {children}
      </section>
      <section aria-labelledby="danger-h">
        <h2 id="danger-h">Danger Zone</h2>
      </section>
    </>
  ),
}))

describe("SettingsShell", () => {
  beforeEach(() => {
    useSettingsStore.setState({ theme: "system" })
    finance.on = false
  })

  it("offers the theme alone under Preferences: nothing reads a currency, a locale or an AI mode", () => {
    render(<SettingsShell />)
    expect(screen.getByRole("group", { name: "Theme" })).toBeInTheDocument()
    for (const name of ["Currency", "AI Features"]) expect(screen.queryByRole("group", { name })).toBeNull()
    expect(screen.queryByText("Language and Format")).toBeNull()
  })

  it("gives every section its own heading and an index link to it, Plugins after Preferences", () => {
    render(<SettingsShell />)
    const index = screen.getByRole("navigation", { name: "On this page" })
    const names = ["Profile", "Preferences", "Plugins", "Data"]
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual(names)
    for (const name of names) {
      expect(within(index).getByRole("link", { name })).toBeInTheDocument()
    }
    expect(within(index).getByRole("link", { name: "Plugins" })).toHaveAttribute("href", "#modules")
  })

  it("has no company switch: the company side is the only product", () => {
    render(<SettingsShell />)
    expect(screen.queryByRole("switch", { name: "Show company features" })).toBeNull()
  })

  it("shows nothing of Personal Finance while it is off", () => {
    render(<SettingsShell />)
    expect(screen.queryByText("Finance preference rows")).toBeNull()
    expect(screen.queryByRole("heading", { name: "Danger Zone" })).toBeNull()
  })

  describe("with Personal Finance on", () => {
    beforeEach(() => {
      finance.on = true
    })

    it("adds its preference rows to Preferences, and its Categories & Tags, Data and Danger Zone sections after Plugins", () => {
      render(<SettingsShell />)
      expect(screen.getByText("Finance preference rows")).toBeInTheDocument()
      const names = ["Profile", "Preferences", "Plugins", "Categories & Tags", "Data", "Danger Zone"]
      expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual(names)
    })

    it("lists the Plugins row of Personal Finance as On", () => {
      render(<SettingsShell />)
      const row = screen.getByText("Personal Finance").closest("div")!.parentElement!
      expect(within(row).getByText("On")).toBeInTheDocument()
    })

    it("hands its Data section the app's own rows, instead of a second Data section", () => {
      render(<SettingsShell />)
      expect(screen.getAllByRole("heading", { name: "Data" })).toHaveLength(1)
    })

    it("gives the index a link to each section", () => {
      render(<SettingsShell />)
      const index = screen.getByRole("navigation", { name: "On this page" })
      expect(within(index).getAllByRole("link").map((l) => l.textContent)).toEqual(["Profile", "Preferences", "Plugins", "Categories & Tags", "Data", "Danger Zone"])
    })
  })
})
