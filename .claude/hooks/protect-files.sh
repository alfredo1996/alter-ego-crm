#!/usr/bin/env bash
# PreToolUse hook: block edits to protected files.
# Input is JSON on stdin (tool_input.file_path). Exit code 2 blocks the action.

. "$(dirname "$0")/locate.sh"
locate || exit 0

# An env file anywhere in the tree is protected; the other checks are repo-relative.
case "${file##*/}" in
  .env|.env.*)
    echo "BLOCKED: Cannot edit environment file: $rel" >&2; exit 2 ;;
esac
case "$rel" in
  pnpm-lock.yaml|package-lock.json|yarn.lock)
    echo "BLOCKED: Cannot edit lock file: $rel" >&2; exit 2 ;;
  node_modules/*)
    echo "BLOCKED: Cannot edit node_modules: $rel" >&2; exit 2 ;;
  .next/*)
    echo "BLOCKED: Cannot edit .next build output: $rel" >&2; exit 2 ;;
esac
exit 0
