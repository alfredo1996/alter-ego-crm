"use client"

import { getBackend } from "../host"
import {
  createListHook,
  createMutationHook,
  createUpdateHook,
  createDeleteHook,
} from "./create-crud-hooks"

import type { CreateCategorizationRuleInput } from "../types"

const RULES_KEY = ["categorization-rules"] as const

export const useCategorizationRules = createListHook(
  RULES_KEY,
  (userId) => getBackend().db.getCategorizationRules(userId),
)

export const useCreateCategorizationRule = createMutationHook<CreateCategorizationRuleInput>(
  RULES_KEY,
  (userId, input) => getBackend().db.createCategorizationRule(userId, input),
)

export const useUpdateCategorizationRule = createUpdateHook<
  Partial<CreateCategorizationRuleInput & { isActive: boolean }>
>(
  RULES_KEY,
  (userId, ruleId, input) => getBackend().db.updateCategorizationRule(userId, ruleId, input),
)

export const useDeleteCategorizationRule = createDeleteHook(
  RULES_KEY,
  (userId, ruleId) => getBackend().db.deleteCategorizationRule(userId, ruleId),
)
