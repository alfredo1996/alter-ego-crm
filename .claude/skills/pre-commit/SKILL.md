---
model: haiku
description: Full pre-commit verification pipeline
user_invocable: true
---

# /pre-commit — Pre-Commit Pipeline

Run the full verification pipeline before committing. All checks must pass.

## Steps (run sequentially, stop on first failure)

1. **TypeScript**: `pnpm typecheck`
   - Check for type errors without emitting files
2. **Lint**: `pnpm lint`
   - Check for ESLint violations
3. **Test**: `pnpm test --run`
   - Run all unit tests
4. **Build**: `pnpm build`
   - Verify production build succeeds

## On Failure

- Report which step failed
- Show the specific errors
- Suggest or implement fixes
- Re-run the failing step to verify
- Continue the pipeline from where it left off

## On Success

- Report all checks passed
- Show summary of what was verified
