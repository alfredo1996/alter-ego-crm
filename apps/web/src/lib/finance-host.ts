"use client"

import { provideFinanceHost } from "@alter-ego/finance/host"

import { useAuth } from "@/hooks/use-auth"
import { getBackend } from "@/lib/backend"

// The one place the app hands Personal Finance its services: data and the signed-in user. Imported by the
// providers (and the vitest setup) so it runs before any finance component renders.
provideFinanceHost({
  getBackend,
  useAuth,
  // This app has no AI adapter, so finance is never offered a suggestion.
  categorize: async () => null,
})
