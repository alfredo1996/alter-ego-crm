/**
 * Which emulator test files run in parallel and which run alone, after them.
 * Plain data: vitest.emulator.ts reads it, and a unit test checks it
 * (src/lib/backend/__tests__/emulator-files.test.ts).
 */
export const parallelFiles = [
  "src/lib/backend/__tests__/firebase.adapter.test.ts",
  "src/lib/backend/__tests__/firebase.freshness.test.ts",
  "src/lib/backend/__tests__/firebase.budgets.test.ts",
  "src/lib/backend/__tests__/firebase.dashboard.test.ts",
  "src/lib/backend/__tests__/firebase.files.test.ts",
  "src/lib/backend/__tests__/firebaseadmin.adapter.test.ts",
  "src/lib/backend/__tests__/firebase.api-keys.test.ts",
  "src/lib/backend/__tests__/firestore-rules.test.ts",
  "src/lib/backend/__tests__/firestore-rules-finance.test.ts",
  "src/lib/backend/__tests__/firestore-rules-owner.test.ts",
  "src/lib/oauth/__tests__/flow.emulator.test.ts",
  "src/lib/backend/__tests__/firebaseadmin.crm.test.ts",
  "src/lib/mcp/__tests__/tools-read.emulator.test.ts",
  "src/lib/mcp/__tests__/tools-write.emulator.test.ts",
  "src/lib/mcp/__tests__/cash-book.emulator.test.ts",
  "src/lib/mcp/__tests__/solutions.emulator.test.ts",
  "src/lib/mcp/__tests__/collaborators.emulator.test.ts",
  "src/lib/mcp/__tests__/rent.emulator.test.ts",
  "src/lib/mcp/__tests__/finance-read.emulator.test.ts",
  "src/lib/mcp/__tests__/finance-write.emulator.test.ts",
  "src/lib/mcp/__tests__/invoice-files.emulator.test.ts",
] as string[]

// Files that replace the Storage rules of the WHOLE emulator (no per-project isolation).
export const aloneFiles = [
  "src/lib/backend/__tests__/storage-rules.test.ts",
] as string[]
