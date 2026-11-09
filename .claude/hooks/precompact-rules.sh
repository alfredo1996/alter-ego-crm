#!/usr/bin/env bash
# PreCompact hook: re-inject critical project rules after context compaction
# These rules MUST survive compaction to prevent drift

printf 'CRITICAL RULES (re-injected after compaction):
1. AI is optional — app must be fully functional without AI features
2. Backend adapter pattern — NEVER import Firebase directly; use getBackend()
3. Package manager is pnpm (not npm/yarn)
4. File naming: kebab-case (use-accounts.ts, transaction-list.tsx)
5. Named exports only (no default exports except pages)
6. Use @/* path alias for all imports
7. Zod schemas for all external data boundaries
8. Styling: Tailwind CSS v4 + cn() utility for conditionals
9. Tests: Vitest (unit) colocated in __tests__/, Playwright (E2E) in e2e/
10. Commits: Conventional Commits format (feat:, fix:, refactor:, etc.)
11. Never edit .env files, lock files, node_modules, or .next/'
