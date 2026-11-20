import { renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { useAccountActions } from "../account-actions"

import type { Account } from "../../../types"

const mutate = vi.fn()
const toast = vi.fn()


vi.mock("../../../host", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: "u1" } }),
}))
vi.mock("../../../hooks/use-currency", () => ({ useCurrency: () => ({ format: (n: number) => `€${n.toFixed(2)}` }) }))
vi.mock("@alter-ego/ui/use-toast", () => ({ useToast: () => ({ toast }) }))
vi.mock("../../../hooks/use-accounts", () => ({
  useAccounts: () => ({ data: [] }),
  useCreateAccount: () => ({ mutate: vi.fn() }),
  useUpdateAccount: () => ({ mutate }),
  useDeleteAccount: () => ({ mutate: vi.fn() }),
}))

const account = (balance: number) =>
  ({ id: "a", name: "Main", currency: "EUR", balance, isArchived: false }) as Account

beforeEach(() => vi.clearAllMocks())

describe("archive: the balance has to be zero to the cent (#314)", () => {
  it("archives an account whose float residue reads 0.00, with no toast", () => {
    const { result } = renderHook(() => useAccountActions())
    result.current.archive(account(0.1 + 0.2 - 0.3))
    expect(mutate).toHaveBeenCalledWith({ id: "a", input: { isArchived: true } }, expect.anything())
    expect(toast).not.toHaveBeenCalled()
  })

  it("refuses an account at 12.50 and says so", () => {
    const { result } = renderHook(() => useAccountActions())
    result.current.archive(account(12.5))
    expect(mutate).not.toHaveBeenCalled()
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Move the balance out before archiving" }))
  })
})
