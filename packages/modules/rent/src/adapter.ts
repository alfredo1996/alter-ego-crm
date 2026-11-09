import { createLeaseSchema, createTenantSchema } from "./schemas"

import type { CreateLeaseInput, CreateTenantInput, Lease, Tenant, UpdateLeaseInput, UpdateTenantInput } from "./types"

/**
 * The rent slice of the database. The app's DatabaseAdapter extends it. No delete:
 * a lease ends with End Tenancy or is renewed, and a tenant stays (the rules refuse both).
 */
export interface RentAdapter {
  getTenants(userId: string): Promise<Tenant[]>
  createTenant(userId: string, input: CreateTenantInput): Promise<Tenant>
  updateTenant(userId: string, tenantId: string, input: UpdateTenantInput): Promise<Tenant>
  getLeases(userId: string): Promise<Lease[]>
  createLease(userId: string, input: CreateLeaseInput): Promise<Lease>
  updateLease(userId: string, leaseId: string, input: UpdateLeaseInput): Promise<Lease>
}

/** The two cash-book writes Record Payment makes. The app's `db` has both; the types are the few fields rent sets. */
export interface RentCashBook {
  createCompanyMovement(userId: string, input: RentMovementInput): Promise<unknown>
  createCompanyExpense(userId: string, input: RentCostInput): Promise<unknown>
}

/** A rent or contribution payment: income into an account, tagged with its lease, month and part. */
export interface RentMovementInput {
  kind: "income"
  direction: "in"
  amount: number
  date: Date
  accountId: string
  description: string
  documentRef: string | null
  /** The house: the cost centre. */
  project: string
  counterparty: string | null
  leaseId: string
  rentMonth: string
  rentPart: "rent" | "contribution"
}

/** A rent offset: a cost of the house, linked to the lease; its month is `forMonth`. */
export interface RentCostInput {
  description: string
  category: "other"
  amount: number
  vat: 0
  date: Date
  accountId: string
  project: string
  leaseId: string
  forMonth: string
}

type TenantFields = ReturnType<typeof createTenantSchema.parse>
type LeaseFields = ReturnType<typeof createLeaseSchema.parse>

/** The stored fields of a tenant, every one present (the rules require each). Throws on invalid input, like the rules would. */
export const tenantFields = (input: CreateTenantInput): TenantFields => createTenantSchema.parse(input)

export const leaseFields = (input: CreateLeaseInput): LeaseFields => createLeaseSchema.parse(input)

/** An update merges onto what is stored and is checked whole, so a lease can never end up with an end before its start. */
export const mergedTenant = (old: Tenant, input: UpdateTenantInput): TenantFields => tenantFields({ ...old, ...input })
export const mergedLease = (old: Lease, input: UpdateLeaseInput): LeaseFields => leaseFields({ ...old, ...input })

export const byName = (a: Tenant, b: Tenant) => a.surname.localeCompare(b.surname) || a.firstName.localeCompare(b.firstName)
