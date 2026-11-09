/**
 * Returns the server-side database accessor.
 *
 * When NEXT_PUBLIC_BACKEND=firebase, this is the Admin SDK module (bypasses
 * Firestore rules). When NEXT_PUBLIC_BACKEND=mock, it's the mock adapter's db.
 *
 * Use this from Next.js API routes and the MCP server only. Browser code should keep using
 * getBackend() from "./index".
 */

import { getBackend } from "@/lib/backend"
import * as firebaseAdmin from "@/lib/backend/firebase-admin"
import { env } from "@/lib/env"

import type { AuditAdapter, CrmServerAdapter, DatabaseAdapter, FilesAdapter } from "./types"

/**
 * Common subset of DatabaseAdapter methods exposed by both the mock adapter
 * and the admin-SDK module. The MCP tools and the OAuth routes target this
 * surface so they don't care which backend is wired in.
 */
export type ServerDb = AuditAdapter &
  CrmServerAdapter & {
    /** Server-only (#342): the key is valid only while its visible document exists. */
    validateApiKey(keyHash: string): Promise<string | null>
  } &
  Pick<
    DatabaseAdapter,
    | "createApiKey"
    | "deleteApiKey"
    | "getClients"
    | "createClient"
    | "updateClient"
    | "getOpportunities"
    | "createOpportunity"
    | "updateOpportunity"
    | "getEngagements"
    | "createEngagement"
    | "updateEngagement"
    | "getTasks"
    | "createTask"
    | "updateTask"
    | "deleteTask"
    | "getTimecards"
    | "getCollaborators"
    | "createCollaborator"
    | "updateCollaborator"
    | "getAssignments"
    | "createAssignment"
    | "updateAssignment"
    | "deleteAssignment"
    | "setTimecard"
    | "deleteTimecard"
    | "getMeetings"
    | "createMeeting"
    | "updateMeeting"
    | "getSolutions"
    | "createSolution"
    | "updateSolution"
    | "getInvoices"
    | "createInvoice"
    | "updateInvoice"
    | "deleteInvoice"
    | "getCompanyAccounts"
    | "updateCompanyAccount"
    | "getCompanyMovements"
    | "createCompanyMovement"
    | "updateCompanyMovement"
    | "deleteCompanyMovement"
    | "getCompanyExpenses"
    | "createCompanyExpense"
    | "updateCompanyExpense"
    | "deleteCompanyExpense"
    | "getCompanyLoans"
    | "createCompanyLoan"
    | "updateCompanyLoan"
    | "deleteCompanyLoan"
    | "getCompanyDeadlines"
    | "createCompanyDeadline"
    | "updateCompanyDeadline"
    | "getAllocations"
    | "getCapacityDocs"
    | "setCapacity"
    | "createAllocation"
    | "updateAllocation"
    | "getTenants"
    | "createTenant"
    | "updateTenant"
    | "getLeases"
    | "createLease"
    | "updateLease"
  >

/** The invoice files on the server: Admin Storage on Firebase (it makes storage.rules' checks itself), the mock's otherwise. */
export function getServerFiles(): FilesAdapter {
  return env.NEXT_PUBLIC_BACKEND === "firebase" ? firebaseAdmin.createFirebaseFiles() : getBackend().files
}

export function getServerDb(): ServerDb {
  if (env.NEXT_PUBLIC_BACKEND === "firebase") {
    return firebaseAdmin as unknown as ServerDb
  }
  // The mock db does implement the server-only halves — BackendAdapter just types
  // `db` as DatabaseAdapter, which deliberately excludes them so the client-side
  // Firebase adapter is not asked for collections its rules deny.
  return getBackend().db as unknown as ServerDb
}
