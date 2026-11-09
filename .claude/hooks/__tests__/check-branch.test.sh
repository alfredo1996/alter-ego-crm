#!/usr/bin/env bash
# Self-check for check-branch.sh. Run: bash .claude/hooks/__tests__/check-branch.test.sh
# Uses throwaway git repos so the assertions do not depend on the current branch.

set -uo pipefail

HOOK="$(cd "$(dirname "$0")/.." && pwd)/check-branch.sh"
TMP=$(cd "$(mktemp -d)" && pwd -P)
OUT=$(cd "$(mktemp -d)" && pwd -P)
trap 'rm -rf "$TMP" "$OUT"' EXIT

git -C "$TMP" init -q -b main
git -C "$TMP" -c user.email=t@t -c user.name=t commit -q --allow-empty -m init
mkdir -p "$TMP/apps/web/src/lib"
fail=0

check() { # name expected_exit branch file
  local name=$1 expected=$2 branch=$3 file=$4
  git -C "$TMP" checkout -q -B "$branch"
  printf '{"tool_input":{"file_path":"%s"}}' "$file" | bash "$HOOK" >/dev/null 2>&1
  local actual=$?
  if [ "$actual" != "$expected" ]; then
    echo "FAIL: $name — expected exit $expected, got $actual"
    fail=1
  else
    echo "ok: $name"
  fi
}

check "repo file on main is blocked"          2 main    "$TMP/apps/web/src/lib/foo.ts"
check "new file in a new dir on main blocked" 2 main    "$TMP/apps/web/src/new/dir/foo.ts"
check "outside file on main passes"           0 main    "$OUT/note.md"
check "repo file on a branch passes"          0 feat/x  "$TMP/apps/web/src/lib/foo.ts"
check "outside file on a branch passes"       0 feat/x  "$OUT/note.md"
check "no path in the input passes"           0 main    ""

# a worktree on a feature branch passes while the main checkout is on main
WT="$TMP-wt"; trap 'rm -rf "$TMP" "$OUT" "$WT"' EXIT
git -C "$TMP" checkout -q -B main
git -C "$TMP" worktree add -q -b feat/wt "$WT"
mkdir -p "$WT/apps/web/src/lib"
printf '{"tool_input":{"file_path":"%s"}}' "$WT/apps/web/src/lib/foo.ts" | (cd "$TMP" && bash "$HOOK") >/dev/null 2>&1
if [ $? = 0 ]; then echo "ok: worktree file passes while the main checkout is on main"; else echo "FAIL: worktree file blocked"; fail=1; fi

[ "$fail" = 0 ] && echo "all passed"
exit "$fail"
