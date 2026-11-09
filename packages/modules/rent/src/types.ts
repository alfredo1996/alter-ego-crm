/** A person who rents a room. Not a CRM Client: never in revenue or the pipeline. */
export interface Tenant {
  id: string
  userId: string
  firstName: string
  surname: string
  /** Free text, no checksum: foreign tenants carry foreign IDs. */
  taxId: string | null
  street: string | null
  postcode: string | null
  city: string | null
  province: string | null
  country: string | null
  createdAt: Date
  updatedAt: Date
}

export interface CreateTenantInput {
  firstName: string
  surname: string
  taxId?: string | null
  street?: string | null
  postcode?: string | null
  city?: string | null
  province?: string | null
  country?: string | null
}

export type UpdateTenantInput = Partial<CreateTenantInput>

/** One tenant in one room of one house for a stretch of time (a year). Rent is fixed for the lease. */
export interface Lease {
  id: string
  userId: string
  tenantId: string
  /** The cost-centre name; there is no Property record. Stored trimmed. */
  property: string
  /** null = not set (yet). */
  room: string | null
  /** € a month. */
  rent: number
  /** € a month the tenant pays toward expenses, kept apart from rent. null = none. */
  contribution: number | null
  /** yyyy-MM-dd, both ends inclusive. */
  startDate: string
  endDate: string
  /** Who sends the money when it is not the tenant. The invoice still goes to the tenant. */
  paidBy: string | null
  /** A month's agreed amount in place of rent + contribution, by "YYYY-MM". Empty when none. */
  agreedMonths: Record<string, AgreedMonth>
  createdAt: Date
  updatedAt: Date
}

/** What was agreed for one month of a lease, and why ("Moved in on 26 Sep"). */
export interface AgreedMonth {
  amount: number
  note: string
}

export interface CreateLeaseInput {
  tenantId: string
  property: string
  room?: string | null
  rent: number
  contribution?: number | null
  startDate: string
  endDate: string
  paidBy?: string | null
  agreedMonths?: Record<string, AgreedMonth>
}

export type UpdateLeaseInput = Partial<CreateLeaseInput>
