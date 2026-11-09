#!/usr/bin/env bash
# Self-check for protect-files, format-and-lint and check-boundaries.
# Run: bash .claude/hooks/__tests__/stdin-hooks.test.sh
# They take JSON on stdin, as Claude Code sends it; a throwaway repo keeps the real one untouched.

set -uo pipefail
HOOKS="$(cd "$(dirname "$0")/.." && pwd)"
REPO="$(cd "$HOOKS/../.." && pwd)"
TMP=$(cd "$(mktemp -d)" && pwd -P)
trap 'rm -rf "$TMP"' EXIT
git -C "$TMP" init -q -b feat/x
mkdir -p "$TMP/apps/web/src/components" "$TMP/apps/web/src/lib/backend"
# a stand-in node_modules/.bin that borrows the real prettier (a symlinked node_modules would leave the repo)
mkdir -p "$TMP/node_modules/.bin" "$TMP/apps/web/src/lib/mcp/tools" "$TMP/apps/web/src/lib/mcp/__tests__" "$TMP/functions" "$TMP/scripts"
printf '#!/bin/sh\nexec "%s/node_modules/.bin/prettier" "$@"\n' "$REPO" > "$TMP/node_modules/.bin/prettier"
chmod +x "$TMP/node_modules/.bin/prettier"
# a worktree of the repo, and a second repo to run the hooks from (the session's cwd)
git -C "$TMP" -c user.email=t@t -c user.name=t commit -q --allow-empty -m init
WT="$TMP-wt"; ELSEWHERE=$(cd "$(mktemp -d)" && pwd -P)
git -C "$TMP" worktree add -q -b feat/wt "$WT"
mkdir -p "$WT/apps/web/src/lib/backend"
trap 'rm -rf "$TMP" "$WT" "$ELSEWHERE"' EXIT
fail=0

run() { # hook path -> exit code (stdout/stderr in $TMP/out); cwd is $CWD, default the repo
  ( cd "${CWD:-$TMP}" && printf '{"tool_input":{"file_path":"%s"}}' "$2" | bash "$HOOKS/$1" ) >"$TMP/out" 2>&1
}
expect() { # name expected actual
  if [ "$2" = "$3" ]; then echo "ok: $1"; else echo "FAIL: $1 (expected $2, got $3)"; fail=1; fi
}

run protect-files.sh ".env.local";                    expect "protect .env.local" 2 $?
run protect-files.sh "$TMP/.env";                     expect "protect absolute .env" 2 $?
run protect-files.sh "pnpm-lock.yaml";                expect "protect lock file" 2 $?
run protect-files.sh "node_modules/x/index.js";       expect "protect node_modules" 2 $?
run protect-files.sh ".next/a.js";                    expect "protect .next" 2 $?
run protect-files.sh "src/lib/foo.ts";                expect "source edit allowed" 0 $?
run protect-files.sh ".env.example.md";               expect "(.env.* is blocked, as the deny rule)" 2 $?

printf '{"a":1}\n' > "$TMP/fmt.json"
printf '{"z":1}\n' > "$TMP/other.json"
printf 'const   a  =  {b:1}\n' > "$TMP/apps/web/src/lib/keep.ts"
run format-and-lint.sh "$TMP/fmt.json"
expect "format: edited json is formatted" '{ "a": 1 }' "$(head -1 "$TMP/fmt.json")"
expect "format: other json untouched" '{"z":1}' "$(head -1 "$TMP/other.json")"
run format-and-lint.sh "$TMP/apps/web/src/lib/keep.ts"
expect "format: ts is not restyled by prettier" 'const   a  =  {b:1}' "$(head -1 "$TMP/apps/web/src/lib/keep.ts")"

printf 'import { getDoc } from "firebase/firestore";\n' > "$TMP/apps/web/src/components/bad.tsx"
printf 'import { getDoc } from "firebase/firestore";\n' > "$TMP/apps/web/src/lib/backend/ok.ts"
printf 'import { getBackend } from "@/lib/backend";\n' > "$TMP/apps/web/src/components/good.tsx"
run check-boundaries.sh "$TMP/apps/web/src/components/bad.tsx";   expect "boundary: component importing firebase" 2 $?
run check-boundaries.sh "$TMP/apps/web/src/lib/backend/ok.ts";    expect "boundary: adapter may import firebase" 0 $?
run check-boundaries.sh "$TMP/apps/web/src/components/good.tsx";  expect "boundary: clean component" 0 $?

# emulator tests and SDK init may use firebase; MCP tools may not reach the adapters
printf 'import { getDoc } from "firebase/firestore";\n' > "$TMP/apps/web/src/lib/mcp/__tests__/x.emulator.test.ts"
printf 'import { getDoc } from "firebase/firestore";\n' > "$TMP/apps/web/src/lib/firebase-client.ts"
printf 'import * as admin from "@/lib/backend/firebase-admin";\n' > "$TMP/apps/web/src/lib/mcp/tools/crm-x.ts"
printf 'import { getBackend } from "@/lib/backend";\n' > "$TMP/apps/web/src/lib/mcp/tools/ok.ts"
run check-boundaries.sh "$TMP/apps/web/src/lib/mcp/__tests__/x.emulator.test.ts"; expect "boundary: emulator test may import firebase" 0 $?
run check-boundaries.sh "$TMP/apps/web/src/lib/firebase-client.ts";                expect "boundary: SDK init module may import firebase" 0 $?
run check-boundaries.sh "$TMP/apps/web/src/lib/mcp/tools/crm-x.ts";                expect "boundary: MCP tool importing the admin adapter" 2 $?
run check-boundaries.sh "$TMP/apps/web/src/lib/mcp/tools/ok.ts";                   expect "boundary: MCP tool using getBackend" 0 $?

# run from another repo (the session's checkout) on a path in the worktree and in nested dirs
CWD=$ELSEWHERE
printf 'x\n' > "$WT/.env.local"
printf 'import { getDoc } from "firebase/firestore";\n' > "$WT/apps/web/src/lib/backend/firebase.ts"
printf 'import { getDoc } from "firebase/firestore";\n' > "$WT/apps/web/src/lib/bad.ts"
run protect-files.sh "$WT/.env.local";                 expect "worktree: .env.local blocked" 2 $?
run protect-files.sh "$WT/pnpm-lock.yaml";             expect "worktree: lock file blocked" 2 $?
run protect-files.sh "$TMP/functions/.env";            expect "nested .env blocked" 2 $?
run check-boundaries.sh "$WT/apps/web/src/lib/backend/firebase.ts"; expect "worktree: adapter may import firebase" 0 $?
run check-boundaries.sh "$WT/apps/web/src/lib/bad.ts";          expect "worktree: non-adapter importing firebase" 2 $?
unset CWD

[ "$fail" = 0 ] && echo "all passed"
exit "$fail"
