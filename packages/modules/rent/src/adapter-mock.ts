import { byName, leaseFields, mergedLease, mergedTenant, tenantFields } from "./adapter"

import type { RentAdapter } from "./adapter"
import type { Lease, Tenant } from "./types"

/** In memory. `nextId` comes from the app's mock so ids stay unique across slices. */
export function createMockRent(nextId: () => string): { rent: RentAdapter; clear: () => void } {
  const tenants = new Map<string, Tenant>()
  const leases = new Map<string, Lease>()
  const mine = <T extends { userId: string }>(m: Map<string, T>, userId: string) => [...m.values()].filter((x) => x.userId === userId)
  const need = <T extends { userId: string }>(m: Map<string, T>, userId: string, id: string, what: string) => {
    const x = m.get(id)
    if (!x || x.userId !== userId) throw new Error(`${what} not found`)
    return x
  }

  const rent: RentAdapter = {
    async getTenants(userId) {
      return mine(tenants, userId).sort(byName)
    },
    async createTenant(userId, input) {
      const now = new Date()
      const t: Tenant = { id: nextId(), userId, ...tenantFields(input), createdAt: now, updatedAt: now }
      tenants.set(t.id, t)
      return t
    },
    async updateTenant(userId, tenantId, input) {
      const old = need(tenants, userId, tenantId, "Tenant")
      const t: Tenant = { ...old, ...mergedTenant(old, input), updatedAt: new Date() }
      tenants.set(t.id, t)
      return t
    },
    async getLeases(userId) {
      return mine(leases, userId).sort((a, b) => a.startDate.localeCompare(b.startDate))
    },
    async createLease(userId, input) {
      const now = new Date()
      const l: Lease = { id: nextId(), userId, ...leaseFields(input), createdAt: now, updatedAt: now }
      leases.set(l.id, l)
      return l
    },
    async updateLease(userId, leaseId, input) {
      const old = need(leases, userId, leaseId, "Lease")
      const l: Lease = { ...old, ...mergedLease(old, input), updatedAt: new Date() }
      leases.set(l.id, l)
      return l
    },
  }
  return { rent, clear: () => (tenants.clear(), leases.clear()) }
}
