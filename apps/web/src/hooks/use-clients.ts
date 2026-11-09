"use client"

import { getBackend } from "@/lib/backend"

import {
  createListHook,
  createMutationHook,
  createUpdateHook,
  createDeleteHook,
} from "./create-crud-hooks"

import type { Client, CreateClientInput, UpdateClientInput } from "@/types"

const CLIENTS_KEY = ["clients"] as const

export const useClients = createListHook(CLIENTS_KEY, (userId) =>
  getBackend().db.getClients(userId),
)

// The result type is named so the combobox can use the new client's id to create
// and select in one step.
export const useCreateClient = createMutationHook<CreateClientInput, Client>(
  CLIENTS_KEY,
  (userId, input) => getBackend().db.createClient(userId, input),
)

export const useUpdateClient = createUpdateHook<UpdateClientInput>(
  CLIENTS_KEY,
  (userId, clientId, input) => getBackend().db.updateClient(userId, clientId, input),
)

// Deleting a client takes its opportunities, contracts, tasks, verbali, solutions
// and invoices down with it in the adapter, and the contracts take their allocations
// and timecards. It is the one path that still deletes invoices.
// None of those caches would hear about it otherwise, so the pipeline and the
// plan would keep rendering rows whose records are already gone.
export const useDeleteClient = createDeleteHook(
  CLIENTS_KEY,
  (userId, clientId) => getBackend().db.deleteClient(userId, clientId),
  [["opportunities"], ["engagements"], ["allocations"], ["tasks"], ["invoices"], ["meetings"], ["solutions"], ["timecards"]],
)
