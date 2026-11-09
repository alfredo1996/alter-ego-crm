"use client"

import { getBackend } from "@/lib/backend"

import {
  createListHook,
  createMutationHook,
  createUpdateHook,
  createDeleteHook,
} from "./create-crud-hooks"

import type { CreateCompanyDeadlineInput, UpdateCompanyDeadlineInput } from "@/types"

const DEADLINES_KEY = ["companyDeadlines"] as const

export const useCompanyDeadlines = createListHook(DEADLINES_KEY, (userId) =>
  getBackend().db.getCompanyDeadlines(userId),
)

export const useCreateCompanyDeadline = createMutationHook<CreateCompanyDeadlineInput>(
  DEADLINES_KEY,
  (userId, input) => getBackend().db.createCompanyDeadline(userId, input),
)

export const useUpdateCompanyDeadline = createUpdateHook<UpdateCompanyDeadlineInput>(
  DEADLINES_KEY,
  (userId, deadlineId, input) => getBackend().db.updateCompanyDeadline(userId, deadlineId, input),
)

export const useDeleteCompanyDeadline = createDeleteHook(DEADLINES_KEY, (userId, deadlineId) =>
  getBackend().db.deleteCompanyDeadline(userId, deadlineId),
)
