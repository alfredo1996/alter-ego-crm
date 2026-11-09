"use client"

import { getBackend } from "@/lib/backend"

import {
  createListHook,
  createMutationHook,
  createUpdateHook,
  createDeleteHook,
} from "./create-crud-hooks"

import type { CompanyExpense, CreateCompanyExpenseInput, UpdateCompanyExpenseInput } from "@/types"

const EXPENSES_KEY = ["companyExpenses"] as const

export const useCompanyExpenses = createListHook(
  EXPENSES_KEY,
  (userId) => getBackend().db.getCompanyExpenses(userId),
)

export const useCreateCompanyExpense = createMutationHook<CreateCompanyExpenseInput, CompanyExpense>(
  EXPENSES_KEY,
  (userId, input) => getBackend().db.createCompanyExpense(userId, input),
)

export const useUpdateCompanyExpense = createUpdateHook<UpdateCompanyExpenseInput>(
  EXPENSES_KEY,
  (userId, id, input) => getBackend().db.updateCompanyExpense(userId, id, input),
)

export const useDeleteCompanyExpense = createDeleteHook(
  EXPENSES_KEY,
  (userId, id) => getBackend().db.deleteCompanyExpense(userId, id),
)
