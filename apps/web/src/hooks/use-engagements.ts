"use client"

import { getBackend } from "@/lib/backend"

import {
  createListHook,
  createMutationHook,
  createUpdateHook,
  createDeleteHook,
} from "./create-crud-hooks"

import type { CreateEngagementInput, Engagement, UpdateEngagementInput } from "@/types"

const ENGAGEMENTS_KEY = ["engagements"] as const

export const useEngagements = createListHook(
  ENGAGEMENTS_KEY,
  (userId) => getBackend().db.getEngagements(userId),
)

// Named result type: winning an opportunity needs the new contract's id to link
// the two together.
export const useCreateEngagement = createMutationHook<CreateEngagementInput, Engagement>(
  ENGAGEMENTS_KEY,
  (userId, input) => getBackend().db.createEngagement(userId, input),
)

// Moving a contract to another client moves its tasks, verbali and solutions too
// (the adapter rewrites their clientId), so each query has to hear about it.
export const useUpdateEngagement = createUpdateHook<UpdateEngagementInput>(
  ENGAGEMENTS_KEY,
  (userId, engagementId, input) => getBackend().db.updateEngagement(userId, engagementId, input),
  [["tasks"], ["meetings"], ["solutions"]],
)

// The adapter refuses a contract with hours (close it instead), deletes its
// allocations, hands its tasks, verbali and invoices to the client and unlinks its
// solutions — each reads from its own query, which has to be told or it keeps
// rendering rows that are already gone or moved.
export const useDeleteEngagement = createDeleteHook(
  ENGAGEMENTS_KEY,
  (userId, engagementId) => getBackend().db.deleteEngagement(userId, engagementId),
  [["allocations"], ["tasks"], ["invoices"], ["meetings"], ["solutions"]],
)
