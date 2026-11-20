"use client"

import { getBackend } from "../host"
import { createListHook, createMutationHook, createDeleteHook } from "./create-crud-hooks"

import type { CreateDismissedSubscriptionPatternInput } from "../types"

const DISMISSED_KEY = ["dismissedSubscriptions"] as const

export const useDismissedSubscriptionPatterns = createListHook(
  DISMISSED_KEY,
  (userId) => getBackend().db.getDismissedSubscriptionPatterns(userId),
)

export const useCreateDismissedSubscriptionPattern =
  createMutationHook<CreateDismissedSubscriptionPatternInput>(
    DISMISSED_KEY,
    (userId, input) => getBackend().db.createDismissedSubscriptionPattern(userId, input),
  )

export const useDeleteDismissedSubscriptionPattern = createDeleteHook(
  DISMISSED_KEY,
  (userId, id) => getBackend().db.deleteDismissedSubscriptionPattern(userId, id),
)
