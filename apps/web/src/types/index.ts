import type { Currency } from "@alter-ego/kernel/currency"

export type { Currency }

// ─── Core Entities ────────────────────────────────────────────────────────────

export interface User {
  id: string
  email: string
  displayName: string | null
  photoURL: string | null
  createdAt: Date
  updatedAt: Date
}

// ─── API Keys ─────────────────────────────────────────────────────────────────

export interface ApiKey {
  id: string
  userId: string
  keyHash: string
  prefix: string
  createdAt: Date
}

/**
 * One recorded MCP tool call. An LLM writes real business data through these
 * tools, so every attempt leaves a trace — successes and failures alike.
 */
export interface McpAuditEntry {
  tool: string
  params: unknown
  result: "ok" | "error"
  errorMessage?: string
  documentIds?: string[]
  clientId: string
  /** A preview-then-confirm tool called without confirm: it wrote nothing. */
  preview?: boolean
}

export * from "./crm"
