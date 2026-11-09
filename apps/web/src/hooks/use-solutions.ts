"use client"

import { getBackend } from "@/lib/backend"

import {
  createListHook,
  createMutationHook,
  createUpdateHook,
  createDeleteHook,
} from "./create-crud-hooks"

import type { CreateSolutionInput, Solution, UpdateSolutionInput } from "@/types"

const SOLUTIONS_KEY = ["solutions"] as const

export const useSolutions = createListHook(
  SOLUTIONS_KEY,
  (userId) => getBackend().db.getSolutions(userId),
)

export const useCreateSolution = createMutationHook<CreateSolutionInput, Solution>(
  SOLUTIONS_KEY,
  (userId, input) => getBackend().db.createSolution(userId, input),
)

export const useUpdateSolution = createUpdateHook<UpdateSolutionInput>(
  SOLUTIONS_KEY,
  (userId, solutionId, input) => getBackend().db.updateSolution(userId, solutionId, input),
)

export const useDeleteSolution = createDeleteHook(
  SOLUTIONS_KEY,
  (userId, solutionId) => getBackend().db.deleteSolution(userId, solutionId),
)
