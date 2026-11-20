"use client"

import type { FinanceAdapter, FinanceAI } from "./adapter"

/** What finance needs from the app that runs it: data access and the signed-in user. */
export interface FinanceHost {
  getBackend(): { db: FinanceAdapter }
  useAuth(): { user: { id: string; displayName: string | null } | null; loading: boolean }
  /** The app's AI suggestion for a description. The app decides whether AI is on; null means no suggestion. */
  categorize: FinanceAI["categorize"]
}

/** Finance code ran before the app called provideFinanceHost. */
export class FinanceHostNotProvidedError extends Error {
  constructor() {
    super("FinanceHostNotProvidedError: call provideFinanceHost({ getBackend, useAuth, categorize }) before using @alter-ego/finance")
    this.name = "FinanceHostNotProvidedError"
  }
}

// ponytail: one host per page load, set once by the app's providers (and the vitest setup).
// This module must stay "use client": the server and client layers load separate copies of a module,
// so a call made in a server file would never reach the copy the client components read.
let host: FinanceHost | null = null

export function provideFinanceHost(next: FinanceHost): void {
  host = next
}

function provided(): FinanceHost {
  if (!host) throw new FinanceHostNotProvidedError()
  return host
}

/** The app's backend adapter. Finance code calls it where it used to call `@/lib/backend`. */
export const getBackend: FinanceHost["getBackend"] = () => provided().getBackend()

/** The app's auth state. Finance code calls it where it used to call `@/hooks/use-auth`. */
export const useAuth: FinanceHost["useAuth"] = () => provided().useAuth()

/** The app's AI categorizer. Finance code calls it where it used to read the AI mode and call the backend's `ai`. */
export const categorize: FinanceHost["categorize"] = (description) => provided().categorize(description)
