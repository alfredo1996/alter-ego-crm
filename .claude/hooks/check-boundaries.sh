#!/usr/bin/env bash
# PostToolUse hook: enforce the adapter boundary.
# - No direct Firebase imports outside the places that own them (exit 2 reports it)
# - MCP tools and the MCP route may not reach the Firebase adapters either
# - Warn (not block) on edits to packages/ui/src/ui/
# Input is JSON on stdin (tool_input.file_path).

. "$(dirname "$0")/locate.sh"
locate || exit 0
[ -f "$file" ] || exit 0

case "$rel" in
  packages/ui/src/ui/*)
    echo "WARNING: Editing shadcn/ui primitive: $rel. Keep its API: add a variant, never rename one." >&2 ;;
esac

case "$rel" in
  # MCP code must stay adapter-neutral (see adapter-boundary.test.ts)
  apps/web/src/lib/mcp/tools/*|apps/web/src/app/api/mcp/*)
    pattern="['\"](@?firebase|firebase-admin|@/lib/backend/firebase(-admin)?|@/lib/firebase(-admin)?-client)([/'\"])" ;;
  # places that own the Firebase SDK, and the emulator tests that exercise it
  apps/web/src/lib/backend/*|apps/web/src/lib/firebase-client.ts|apps/web/src/lib/firebase-admin-client.ts|apps/web/scripts/*|*.emulator.test.ts) exit 0 ;;
  *.ts|*.tsx) pattern="['\"](@?firebase|firebase-admin)([/'\"])" ;;
  *) exit 0 ;;
esac

if grep -qE "(from|import|require)[[:space:]]*\(?[[:space:]]*$pattern" "$file" 2>/dev/null; then
  echo "BOUNDARY VIOLATION: $rel imports Firebase directly." >&2
  echo "Use the backend adapter instead: import { getBackend } from '@/lib/backend'" >&2
  exit 2
fi
exit 0
