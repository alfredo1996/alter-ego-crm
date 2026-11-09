"use client"

import { getBackend } from "@/lib/backend"

import {
  createListHook,
  createMutationHook,
  createUpdateHook,
  createDeleteHook,
} from "./create-crud-hooks"

import type { CreateCompanyMovementInput, UpdateCompanyMovementInput } from "@/types"

const MOVEMENTS_KEY = ["companyMovements"] as const

export const useCompanyMovements = createListHook(
  MOVEMENTS_KEY,
  (userId) => getBackend().db.getCompanyMovements(userId),
)

export const useCreateCompanyMovement = createMutationHook<CreateCompanyMovementInput>(
  MOVEMENTS_KEY,
  (userId, input) => getBackend().db.createCompanyMovement(userId, input),
)

export const useUpdateCompanyMovement = createUpdateHook<UpdateCompanyMovementInput>(
  MOVEMENTS_KEY,
  (userId, id, input) => getBackend().db.updateCompanyMovement(userId, id, input),
)

export const useDeleteCompanyMovement = createDeleteHook(
  MOVEMENTS_KEY,
  (userId, id) => getBackend().db.deleteCompanyMovement(userId, id),
)
