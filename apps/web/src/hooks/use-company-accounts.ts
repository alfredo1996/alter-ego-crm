"use client"

import { getBackend } from "@/lib/backend"

import {
  createListHook,
  createMutationHook,
  createUpdateHook,
  createDeleteHook,
} from "./create-crud-hooks"

import type { CreateCompanyAccountInput, UpdateCompanyAccountInput } from "@/types"

const ACCOUNTS_KEY = ["companyAccounts"] as const

export const useCompanyAccounts = createListHook(
  ACCOUNTS_KEY,
  (userId) => getBackend().db.getCompanyAccounts(userId),
)

export const useCreateCompanyAccount = createMutationHook<CreateCompanyAccountInput>(
  ACCOUNTS_KEY,
  (userId, input) => getBackend().db.createCompanyAccount(userId, input),
)

export const useUpdateCompanyAccount = createUpdateHook<UpdateCompanyAccountInput>(
  ACCOUNTS_KEY,
  (userId, id, input) => getBackend().db.updateCompanyAccount(userId, id, input),
)

export const useDeleteCompanyAccount = createDeleteHook(
  ACCOUNTS_KEY,
  (userId, id) => getBackend().db.deleteCompanyAccount(userId, id),
)
