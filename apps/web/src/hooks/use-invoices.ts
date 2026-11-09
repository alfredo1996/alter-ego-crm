"use client"

import { getBackend } from "@/lib/backend"

import {
  createListHook,
  createMutationHook,
  createUpdateHook,
  createDeleteHook,
} from "./create-crud-hooks"

import type { CreateInvoiceInput, Invoice, UpdateInvoiceInput } from "@/types"

const INVOICES_KEY = ["invoices"] as const

export const useInvoices = createListHook(
  INVOICES_KEY,
  (userId) => getBackend().db.getInvoices(userId),
)

export const useCreateInvoice = createMutationHook<CreateInvoiceInput, Invoice>(
  INVOICES_KEY,
  (userId, input) => getBackend().db.createInvoice(userId, input),
)

export const useUpdateInvoice = createUpdateHook<UpdateInvoiceInput>(
  INVOICES_KEY,
  (userId, invoiceId, input) => getBackend().db.updateInvoice(userId, invoiceId, input),
)

export const useDeleteInvoice = createDeleteHook(
  INVOICES_KEY,
  (userId, invoiceId) => getBackend().db.deleteInvoice(userId, invoiceId),
)
