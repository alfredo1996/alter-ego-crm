import { byName, leaseFields, mergedLease, mergedTenant, tenantFields } from "./adapter"

import type { RentAdapter } from "./adapter"
import type { Lease, Tenant } from "./types"

type Doc = { id: string; data(): Record<string, unknown> | undefined }

/**
 * What the app's Firestore adapter hands in, so the package imports no SDK and reads
 * through the same helpers (server-fresh reads, offline errors) as everything else.
 * Method signatures on purpose: the app passes functions typed with the SDK's own refs.
 */
export interface FirestoreContext {
  col(userId: string, name: string): object
  docRef(userId: string, name: string, id: string): object
  /** The server timestamp sentinel. */
  now(): unknown
  getDocs(query: object): Promise<{ docs: Doc[] }>
  readBack(ref: object): Promise<Doc>
  addDoc(col: object, data: Record<string, unknown>): Promise<object>
  updateDoc(ref: object, data: Record<string, unknown>): Promise<void>
  toDate(value: unknown): Date
  isPermissionDenied(err: unknown): boolean
}

export function createFirebaseRent(fx: FirestoreContext): RentAdapter {
  const row = (d: Doc) => ({ id: d.id, ...d.data() }) as Record<string, unknown> & { id: string }
  const tenant = (d: Doc) => {
    const r = row(d)
    return { ...r, createdAt: fx.toDate(r.createdAt), updatedAt: fx.toDate(r.updatedAt) } as unknown as Tenant
  }
  const lease = (d: Doc) => {
    const r = row(d)
    return { ...r, agreedMonths: r.agreedMonths ?? {}, createdAt: fx.toDate(r.createdAt), updatedAt: fx.toDate(r.updatedAt) } as unknown as Lease
  }
  // A bundle deployed before the rules still renders.
  const list = async <T>(userId: string, name: string, map: (d: Doc) => T): Promise<T[]> => {
    try {
      return (await fx.getDocs(fx.col(userId, name))).docs.map(map)
    } catch (err) {
      if (fx.isPermissionDenied(err)) return []
      throw err
    }
  }

  return {
    async getTenants(userId) {
      return (await list(userId, "tenants", tenant)).sort(byName)
    },
    async createTenant(userId, input) {
      const ref = await fx.addDoc(fx.col(userId, "tenants"), { userId, ...tenantFields(input), createdAt: fx.now(), updatedAt: fx.now() })
      return tenant(await fx.readBack(ref))
    },
    async updateTenant(userId, tenantId, input) {
      const ref = fx.docRef(userId, "tenants", tenantId)
      const old = tenant(await fx.readBack(ref))
      await fx.updateDoc(ref, { ...mergedTenant(old, input), updatedAt: fx.now() })
      return tenant(await fx.readBack(ref))
    },
    async getLeases(userId) {
      return (await list(userId, "leases", lease)).sort((a, b) => a.startDate.localeCompare(b.startDate))
    },
    async createLease(userId, input) {
      const ref = await fx.addDoc(fx.col(userId, "leases"), { userId, ...leaseFields(input), createdAt: fx.now(), updatedAt: fx.now() })
      return lease(await fx.readBack(ref))
    },
    async updateLease(userId, leaseId, input) {
      const ref = fx.docRef(userId, "leases", leaseId)
      const old = lease(await fx.readBack(ref))
      await fx.updateDoc(ref, { ...mergedLease(old, input), updatedAt: fx.now() })
      return lease(await fx.readBack(ref))
    },
  }
}
