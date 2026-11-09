import type { BackendAdapter } from "@/lib/backend"
import type { Page } from "@playwright/test"

/**
 * A client with more than six of everything the client page and the Pipeline summarise: 8 meetings,
 * 10 deals (3 open, 7 closed), 8 solutions and 4 contracts (1 active, 3 closed). Sign in first: a page
 * load wipes the mock.
 */
export async function seedSummaries(page: Page, name: string): Promise<void> {
  await page.evaluate(async (name) => {
    const backend = (window as Window & { __mockBackend?: BackendAdapter }).__mockBackend
    if (!backend) throw new Error("window.__mockBackend is missing: the e2e server must run the mock backend")
    const user = await backend.auth.getCurrentUser()
    if (!user) throw new Error("not signed in")
    const u = user.id
    const db = backend.db
    const { id: clientId } = await db.createClient(u, { name })
    const contract = (title: string) => ({ clientId, name: title, dailyRate: 500, vatApplicable: true, defaultDaysPerMonth: 5 })
    await db.createEngagement(u, contract("Live"))
    for (const n of [1, 2, 3]) {
      const old = await db.createEngagement(u, contract(`Old ${n}`))
      await db.updateEngagement(u, old.id, { isActive: false })
    }
    for (let n = 1; n <= 8; n++) {
      await db.createMeeting(u, { clientId, engagementId: null, date: `2026-01-0${n}`, time: null, health: null, text: `Call ${n}` })
      await db.createSolution(u, { clientId, name: `Solution ${n}` })
    }
    for (let n = 1; n <= 10; n++) {
      const open = n <= 3
      const deal = await db.createOpportunity(u, {
        clientId, title: `Deal ${n}`, stage: open ? "proposal" : "lost", probability: open ? 40 : 0,
        dailyRate: 500, estimatedDaysPerMonth: 5, estimatedDurationMonths: 3, vatApplicable: true,
      })
      if (!open) await db.updateOpportunity(u, deal.id, { closedAt: new Date(2026, 0, n) })
    }
    // Another client's deal and solution: the View All targets must leave them out.
    const { id: otherId } = await db.createClient(u, { name: "Elsewhere Ltd" })
    await db.createOpportunity(u, {
      clientId: otherId, title: "Other Deal", stage: "proposal", probability: 40,
      dailyRate: 500, estimatedDaysPerMonth: 5, estimatedDurationMonths: 3, vatApplicable: true,
    })
    await db.createSolution(u, { clientId: otherId, name: "Other Solution" })
  }, name)
}
