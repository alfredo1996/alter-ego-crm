/**
 * The server-only half of the mock adapter: audit entries and the
 * (engagement, month) allocation lookup. These back the MCP tools on any
 * non-Firebase backend, and nothing else exercises them — the shared adapter
 * contract cannot, because it also runs against the client SDK, which
 * firestore.rules denies access to mcp_audit.
 */
import { beforeEach, describe, expect, it } from "vitest"

import { createMockAdapter, __resetMockState } from "../mock"

import type { AuditAdapter, CrmServerAdapter, DatabaseAdapter } from "../types"

const db = () =>
  createMockAdapter().db as unknown as DatabaseAdapter & AuditAdapter & CrmServerAdapter

const USER = "user-1"
const OTHER = "user-2"

beforeEach(() => {
  __resetMockState()
})

describe("capacity", () => {
  const doc = (yearMonth: string, daysOff = 5) => ({
    yearMonth,
    daysOff,
    availableDays: 22 - daysOff,
    reason: "vacation" as const,
    note: null,
  })

  it("stores and reads back a blocked month", async () => {
    await db().setCapacity(USER, doc("2026-08"))
    expect(await db().getCapacityDocs(USER, { from: "2026-08", to: "2026-08" })).toEqual([
      doc("2026-08"),
    ])
  })

  // Keyed by yearMonth: blocking the same month twice overwrites rather than
  // stacking, matching the Firestore doc-id behaviour the Admin adapter relies on.
  it("overwrites the same month instead of stacking", async () => {
    await db().setCapacity(USER, doc("2026-08", 5))
    await db().setCapacity(USER, doc("2026-08", 12))
    const stored = await db().getCapacityDocs(USER, { from: "2026-08", to: "2026-08" })
    expect(stored).toHaveLength(1)
    expect(stored[0].daysOff).toBe(12)
  })

  it("filters to the window, inclusive at both ends, in month order", async () => {
    for (const m of ["2026-07", "2026-08", "2026-09", "2026-10"]) await db().setCapacity(USER, doc(m))
    const got = await db().getCapacityDocs(USER, { from: "2026-08", to: "2026-09" })
    expect(got.map((d) => d.yearMonth)).toEqual(["2026-08", "2026-09"])
  })

  it("scopes to the owner", async () => {
    await db().setCapacity(USER, doc("2026-08"))
    expect(await db().getCapacityDocs(OTHER, { from: "2026-01", to: "2026-12" })).toEqual([])
  })
})

describe("addAuditEntry", () => {
  it("accepts both outcomes without throwing", async () => {
    await db().addAuditEntry(USER, {
      tool: "add_task",
      params: { title: "x" },
      result: "ok",
      documentIds: ["t1"],
      clientId: "client-1",
    })
    await expect(
      db().addAuditEntry(USER, {
        tool: "add_task",
        params: {},
        result: "error",
        errorMessage: "boom",
        clientId: "client-1",
      }),
    ).resolves.toBeUndefined()
  })
})

describe("getAllocationByKey", () => {
  it("finds the allocation for an (engagement, month) pair, and null when absent", async () => {
    const client = await db().createClient(USER, { name: "Acme" })
    const engagement = await db().createEngagement(USER, {
      clientId: client.id,
      dailyRate: 500,
      vatApplicable: true,
      defaultDaysPerMonth: 10,
    })
    await db().createAllocation(USER, {
      engagementId: engagement.id,
      yearMonth: "2026-08",
      days: 7,
    })

    expect((await db().getAllocationByKey(USER, engagement.id, "2026-08"))?.days).toBe(7)
    expect(await db().getAllocationByKey(USER, engagement.id, "2026-09")).toBeNull()
    expect(await db().getAllocationByKey(OTHER, engagement.id, "2026-08")).toBeNull()
  })
})

describe("settleInvoicePayment", () => {
  const day = new Date("2026-10-05T00:00:00")
  const invoice = async () => {
    const client = await db().createClient(USER, { name: "Acme" })
    return db().createInvoice(USER, { clientId: client.id, number: "15/2026", yearMonth: "2026-09", amount: 1000, vat: 220 })
  }

  it("pays the invoice into the account and books the fee on the same day and account", async () => {
    const i = await invoice()
    const { invoice: paid, fee } = await db().settleInvoicePayment(USER, { invoiceId: i.id, paidDate: day, paidAccountId: "acc-1", fee: 12.5 })
    expect(paid).toMatchObject({ paidDate: day, paidAccountId: "acc-1" })
    expect(fee).toMatchObject({
      id: `bank-fee-${i.id}`, description: "Bank fee on invoice 15/2026", category: "bank_fees", amount: 12.5, date: day, accountId: "acc-1",
    })
    expect(await db().getCompanyExpenses(USER)).toHaveLength(1)
  })

  it("without a fee writes the invoice alone", async () => {
    const i = await invoice()
    const { fee } = await db().settleInvoicePayment(USER, { invoiceId: i.id, paidDate: day, paidAccountId: "acc-1" })
    expect(fee).toBeNull()
    expect(await db().getCompanyExpenses(USER)).toEqual([])
  })

  it("a fee already booked for the invoice leaves it unpaid", async () => {
    const i = await invoice()
    await db().settleInvoicePayment(USER, { invoiceId: i.id, paidDate: day, paidAccountId: "acc-1", fee: 5 })
    await db().updateInvoice(USER, i.id, { paidDate: null })
    await expect(
      db().settleInvoicePayment(USER, { invoiceId: i.id, paidDate: day, paidAccountId: "acc-1", fee: 5 }),
    ).rejects.toThrow(/already booked/)
    expect((await db().getInvoices(USER))[0].paidDate).toBeNull()
  })

  it("a fee the schema refuses leaves the invoice unpaid", async () => {
    const i = await invoice()
    await expect(
      db().settleInvoicePayment(USER, { invoiceId: i.id, paidDate: day, paidAccountId: "acc-1", fee: Number.POSITIVE_INFINITY }),
    ).rejects.toThrow()
    expect((await db().getInvoices(USER))[0].paidDate).toBeNull()
  })

  it("refuses another user's invoice", async () => {
    const i = await invoice()
    await expect(db().settleInvoicePayment(OTHER, { invoiceId: i.id, paidDate: day, paidAccountId: "acc-1" })).rejects.toThrow(
      "Invoice not found",
    )
  })
})
