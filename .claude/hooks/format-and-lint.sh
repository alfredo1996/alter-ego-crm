#!/usr/bin/env bash
# PostToolUse hook: format and lint the one file that was edited, as lint-staged does:
# prettier for json/md/css, eslint --fix for code (the repo has no Prettier config for ts).
# Input is JSON on stdin (tool_input.file_path). Never blocks.

. "$(dirname "$0")/locate.sh"
locate || exit 0
[ -f "$file" ] || exit 0

cd "$root" || exit 0
# The file's own worktree binaries only: no network fetch on every edit.
bin=node_modules/.bin

case "$file" in
  *.json|*.md|*.css)
    [ -x "$bin/prettier" ] && "$bin/prettier" --write --ignore-unknown "$file" >/dev/null 2>&1 ;;
  *.ts|*.tsx|*.js|*.jsx)
    [ -x "$bin/eslint" ] && "$bin/eslint" --fix "$file" >/dev/null 2>&1 ;;
esac
exit 0
