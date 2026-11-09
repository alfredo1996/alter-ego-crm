"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import type { RentAdapter } from "./adapter"
import type { CreateLeaseInput, CreateTenantInput, UpdateLeaseInput, UpdateTenantInput } from "./types"

/** Everything the page reads and writes, over the `db` the app hands in. */
export function useRent(db: RentAdapter, userId: string) {
  const queryClient = useQueryClient()
  const tenants = useQuery({ queryKey: ["rent", "tenants", userId], queryFn: () => db.getTenants(userId) })
  const leases = useQuery({ queryKey: ["rent", "leases", userId], queryFn: () => db.getLeases(userId) })
  const onSuccess = () => queryClient.invalidateQueries({ queryKey: ["rent"] })

  return {
    tenants,
    leases,
    createTenant: useMutation({ mutationFn: (input: CreateTenantInput) => db.createTenant(userId, input), onSuccess }),
    updateTenant: useMutation({ mutationFn: (a: { id: string; input: UpdateTenantInput }) => db.updateTenant(userId, a.id, a.input), onSuccess }),
    createLease: useMutation({ mutationFn: (input: CreateLeaseInput) => db.createLease(userId, input), onSuccess }),
    updateLease: useMutation({ mutationFn: (a: { id: string; input: UpdateLeaseInput }) => db.updateLease(userId, a.id, a.input), onSuccess }),
  }
}
