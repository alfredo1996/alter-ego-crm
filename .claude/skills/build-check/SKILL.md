---
model: haiku
description: Run the production build and report errors
user_invocable: true
---

# /build-check — Build Verification

Build the app, as the gate does.

## Steps

1. Run `NEXT_PUBLIC_BACKEND=mock pnpm build`.
2. If it succeeds, report success.
3. If it fails:
   - Parse the error output for file paths and error messages
   - Read the failing files
   - Suggest fixes or implement them
   - Re-run the build to verify

## Notes

- A module switched off can break a build that works with everything on: build with `NEXT_PUBLIC_DISABLED_MODULES=invoicing,solutions` too (the `test:e2e:modules` config does).
- TypeScript errors surface during `next build`.
- Builds write `.next/`; do not run two in parallel.
