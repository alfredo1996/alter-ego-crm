"use client"

import { getBackend } from "@/lib/backend"

import {
  createListHook,
  createMutationHook,
  createUpdateHook,
  createDeleteHook,
} from "./create-crud-hooks"

import type { CreateCompanyLoanInput, UpdateCompanyLoanInput } from "@/types"

const LOANS_KEY = ["companyLoans"] as const

export const useCompanyLoans = createListHook(
  LOANS_KEY,
  (userId) => getBackend().db.getCompanyLoans(userId),
)

export const useCreateCompanyLoan = createMutationHook<CreateCompanyLoanInput>(
  LOANS_KEY,
  (userId, input) => getBackend().db.createCompanyLoan(userId, input),
)

export const useUpdateCompanyLoan = createUpdateHook<UpdateCompanyLoanInput>(
  LOANS_KEY,
  (userId, id, input) => getBackend().db.updateCompanyLoan(userId, id, input),
)

export const useDeleteCompanyLoan = createDeleteHook(
  LOANS_KEY,
  (userId, id) => getBackend().db.deleteCompanyLoan(userId, id),
)
