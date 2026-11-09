#!/usr/bin/env bash
# PreToolUse hook: block Edit/Write when the file's repo is on main — forces feature branches.
# Input is JSON on stdin (tool_input.file_path). Exit code 2 blocks the action.
# The branch is read from the file's own repo, so files outside any repo, or in a
# repo on another branch (agent memory, scratchpads, worktrees), pass.

file=$(jq -r '.tool_input.file_path // empty' 2>/dev/null) || exit 0
[ -n "$file" ] || exit 0

dir=$(dirname "$file")
while [ ! -d "$dir" ] && [ "$dir" != "/" ] && [ "$dir" != "." ]; do
  dir=$(dirname "$dir")
done

branch=$(git -C "$dir" rev-parse --abbrev-ref HEAD 2>/dev/null) || exit 0
if [ "$branch" = "main" ]; then
  echo "BLOCKED: Cannot edit repo files on main: $file. Create a feature branch first:" >&2
  echo "  git checkout -b feat/<description>" >&2
  exit 2
fi
exit 0
