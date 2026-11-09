"use client"

import { getBackend } from "@/lib/backend"

import { createListHook } from "./create-crud-hooks"

// The keys the Rent module's own hooks use, so one cache serves the Rent page and the cash-book dialogs.
export const useLeases = createListHook(["rent", "leases"], (userId) => getBackend().db.getLeases(userId))
export const useTenants = createListHook(["rent", "tenants"], (userId) => getBackend().db.getTenants(userId))
