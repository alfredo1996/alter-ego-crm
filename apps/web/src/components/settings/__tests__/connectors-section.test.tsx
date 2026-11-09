import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ConnectorsSection } from "../connectors-section"

const toast = vi.fn()
vi.mock("@alter-ego/ui/use-toast", () => ({ useToast: () => ({ toast }) }))
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ getIdToken: async () => "id-token" }) }))

const fetchMock = vi.fn()

beforeEach(() => {
  toast.mockClear()
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
})

async function disconnect() {
  render(<ConnectorsSection />)
  fireEvent.click(screen.getByRole("button", { name: "Disconnect All Connectors" }))
  const dialog = screen.getByRole("alertdialog", { name: "Disconnect All Connectors" })
  fireEvent.click(dialog.querySelector("button:last-of-type")!)
}

describe("ConnectorsSection", () => {
  it("asks first, then posts the ID token and reports the count", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ revoked: 4 }), { status: 200 }))
    render(<ConnectorsSection />)
    fireEvent.click(screen.getByRole("button", { name: "Disconnect All Connectors" }))
    expect(fetchMock).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("alertdialog").querySelector("button:last-of-type")!)

    await waitFor(() => expect(toast).toHaveBeenCalledWith({ title: "Connectors disconnected", description: "4 tokens revoked." }))
    expect(fetchMock).toHaveBeenCalledWith("/api/oauth/disconnect", {
      method: "POST",
      headers: { authorization: "Bearer id-token" },
    })
  })

  it("says so when the request fails", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 500 }))
    await disconnect()
    await waitFor(() => expect(toast).toHaveBeenCalledWith({ title: "Failed to disconnect connectors", variant: "destructive" }))
  })
})
