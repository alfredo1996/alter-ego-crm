"use client"

import { getBackend } from "@/lib/backend"

import {
  createListHook,
  createMutationHook,
  createUpdateHook,
  createDeleteHook,
} from "./create-crud-hooks"

import type { CreateOpportunityInput, UpdateOpportunityInput } from "@/types"

const OPPORTUNITIES_KEY = ["opportunities"] as const

export const useOpportunities = createListHook(OPPORTUNITIES_KEY, (userId) =>
  getBackend().db.getOpportunities(userId),
)

// Winning an opportunity creates a contract, so the engagements list goes stale too.
export const useCreateOpportunity = createMutationHook<CreateOpportunityInput>(
  OPPORTUNITIES_KEY,
  (userId, input) => getBackend().db.createOpportunity(userId, input),
)

export const useUpdateOpportunity = createUpdateHook<UpdateOpportunityInput>(
  OPPORTUNITIES_KEY,
  (userId, opportunityId, input) =>
    getBackend().db.updateOpportunity(userId, opportunityId, input),
  [["engagements"]],
)

export const useDeleteOpportunity = createDeleteHook(OPPORTUNITIES_KEY, (userId, opportunityId) =>
  getBackend().db.deleteOpportunity(userId, opportunityId),
)
