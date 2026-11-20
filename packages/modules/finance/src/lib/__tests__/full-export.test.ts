import { describe, it, expect } from "vitest"

import { buildFullExport, fullExportFileName, FULL_EXPORT_VERSION, type FullExportData } from "../full-export"

const empty: FullExportData = {
  accounts: [], categories: [], transactions: [], budgets: [], savingsGoals: [],
  recurringTransactions: [], tags: [], categorizationRules: [], netWorthSnapshots: [],
}

describe("buildFullExport", () => {
  it("stamps version and ISO timestamp", () => {
    const out = buildFullExport(empty, new Date("2026-07-03T10:00:00.000Z"))
    expect(out.version).toBe(FULL_EXPORT_VERSION)
    expect(out.exportedAt).toBe("2026-07-03T10:00:00.000Z")
  })

  it("passes every collection through unchanged", () => {
    const data: FullExportData = {
      ...empty,
      accounts: [{ id: "a1" } as never],
      transactions: [{ id: "t1" }, { id: "t2" }] as never,
      tags: [{ id: "tag1" }] as never,
    }
    const out = buildFullExport(data, new Date("2026-07-03T00:00:00.000Z"))
    expect(out.accounts).toHaveLength(1)
    expect(out.transactions).toHaveLength(2)
    expect(out.tags).toHaveLength(1)
    expect(out.budgets).toEqual([])
  })

  it("serializes to valid JSON with Dates as ISO strings", () => {
    const data: FullExportData = { ...empty, transactions: [{ id: "t1", date: new Date("2026-01-01T00:00:00.000Z") } as never] }
    const json = JSON.parse(JSON.stringify(buildFullExport(data, new Date("2026-07-03T00:00:00.000Z"))))
    expect(json.transactions[0].date).toBe("2026-01-01T00:00:00.000Z")
  })

  it("builds a dated file name", () => {
    expect(fullExportFileName(new Date("2026-07-03T18:30:00.000Z"))).toBe("alter-ego-backup-2026-07-03.json")
  })

  // Regression: the name came from toISOString, so a backup taken at 00:30 in Rome
  // was stamped with the previous day. The run pins TZ=Europe/Rome.
  it("names the file after the local day", () => {
    expect(fullExportFileName(new Date(2026, 6, 3, 0, 30))).toBe("alter-ego-backup-2026-07-03.json")
  })
})
