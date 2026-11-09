---
name: code
description: Implement features, fix bugs and refactor in Alter Ego. An issue or a planned PR goes through the implementer, adversarial-reviewer and test-runner agents; a small change with no issue is done directly, test-first, in a worktree.
allowed-tools: Read, Write, Edit, MultiEdit, Agent, SendMessage, Bash(pnpm *), Bash(git *), Bash(gh *), Bash(cat *), Bash(ls *), Bash(find *), Bash(grep *), Bash(head *), Bash(tail *), Bash(mkdir *)
---

# Code — Alter Ego

## State

- Branch: !`git branch --show-current`
- Status: !`git status --short`
- Base (empty means no open release branch: ask the owner, never use `main`): !`T=$(git ls-remote --tags origin | sed 's|.*refs/tags/||'); git ls-remote --heads origin 'release/*' | sed 's|.*refs/heads/||' | while read -r b; do v=${b#release/}; [ "$(echo "$v" | tr -cd . | wc -c)" -lt 2 ] && v=$v.0; echo "$T" | grep -qx "v$v" || echo "$b"; done | sort -V | tail -1`

## Before coding

1. **Issue:** read it with `gh issue view <N> --repo alfredo1996/alter-ego-crm --json title,body,labels,comments`. Owner decisions live in the comments, each opening `**Decision (owner, YYYY-MM-DD, where):**`. See `github-workflow` for the read forms that work here; act as `alfredo1996` (`gh auth switch --user alfredo1996`).
2. **Drill (minimal):** does it need to exist; is the helper, type or pattern already in the codebase; root cause or symptom (grep every caller and fix once, where they all route). Offer extras in one line instead of building them.
3. **Existing PR:** read its conversation with `gh pr view <N> --repo alfredo1996/alter-ego-crm --json comments,reviews`, plus its inline comments with `gh api repos/alfredo1996/alter-ego-crm/pulls/<N>/comments`.
4. **The split:** before touching `apps/web/src/lib`, `apps/web/src/types` or the MCP layer, read "The Module Registry" in CLAUDE.md. The registry tests and `firestore-rules-build` enforce it, and `firestore.rules` is generated from `firestore/*.rules` by `pnpm rules:build`.
5. **A planned PR** (a redesign step, say) means the owner approved its design and said go. Build what the plan section and its boards show; a decision the plan did not take goes to the owner as a question, not into the diff.

## Who implements

- **An issue or a planned PR:** delegate it, in sequence, never in parallel. Several PRs at once means several agents: confirm the budget with the owner first.

  **Calling the agents.** Every step is an `Agent` call by `subagent_type` (`implementer`, `adversarial-reviewer`, `test-runner`), so the model, effort and tools come from `.claude/agents/*.md`. An issue never becomes an inline `Workflow` script, and never a generic agent told to "read implementer.md". The `Workflow` tool is only for the owner asking for several issues at once, and then every `agent()` passes `agentType`.
  1. `implementer` works in its own worktree (`isolation: "worktree"`) and commits without pushing. Its prompt gives the issue number or the plan section, the base branch, a free test port (3400 or above) and any notes.
  2. `adversarial-reviewer` (Opus, read-only) reviews the commit.
  3. **Fixer:** every finding, minors included, goes to a FRESH `implementer`, spawned without isolation. Its prompt gives the issue number or plan section, the base branch, a free test port (3400 or above), the worktree path, the branch, every finding and the diff (`git -C <worktree> diff origin/<base>...HEAD`). It fixes each finding test-first, or dismisses it with evidence. Do not resume the first implementer through `SendMessage`, unless a finding needs its reasoning. Before asking for the merge, read the fixed and dismissed lists: a dismissed finding is a decision, and some are the owner's.
  4. `test-runner` (Haiku) runs the whole local gate on the final head: tsc, lint, the unit tests, the builds, the emulator suite and E2E where the change touches them. Brief it: which suites this diff does not need (they count as a pass without running), and that its own emulator container on 18080/19099/19299 (Firestore, Auth, Storage: all three hosts set, per the Emulator suite recipe in `test`, from an image built after Storage was added) needs no approval.
  5. `pr` opens the PR. It never merges without the owner's ok.

  Visual evidence comes from `pnpm shots` before and after (see `test`), not throwaway Playwright specs. `settings.json` sets `CLAUDE_CODE_SUBAGENT_MODEL=sonnet`; the reviewer and the runner pin their own models in their definitions.

- **A small change with no issue:** do it yourself in a worktree, never on the main checkout, because other sessions work there:

  ```bash
  BASE=$(T=$(git ls-remote --tags origin | sed 's|.*refs/tags/||'); git ls-remote --heads origin 'release/*' | sed 's|.*refs/heads/||' | while read -r b; do v=${b#release/}; [ "$(echo "$v" | tr -cd . | wc -c)" -lt 2 ] && v=$v.0; echo "$T" | grep -qx "v$v" || echo "$b"; done | sort -V | tail -1)  # empty: ask the owner, never main
  git fetch -q origin "$BASE"
  git worktree add .claude/worktrees/<name> -b <type>/<slug> "origin/$BASE"
  ```

  A fresh worktree needs `pnpm install --frozen-lockfile`, then `pnpm --filter @alter-ego/web exec fumadocs-mdx`. Never symlink `node_modules`.

## TDD (mandatory)

1. **Red:** write a failing test for the behaviour, run it, and see it fail for the right reason.
2. **Green:** write the minimum code that passes.
3. **Refactor:** tidy up with the tests still green.

A test that still passes with the change reverted doesn't count; ask of every assertion what wrong implementation would still pass it. UI changes include the affected E2E spec.

## Standards

- Backend adapter pattern: all data access through `getBackend()` from `@/lib/backend`; never import Firebase in feature code. Server-only adapters (`mcp_audit`, `capacity`) go through `getServerDb()`.
- AI is optional: never gate functionality behind it.
- The app never computes taxes (cash flow only).
- The modules (`NEXT_PUBLIC_DISABLED_MODULES`): a module switched off leaves the rest building and running.
- The whole app is English: Title Case for buttons, dialog titles and headings, sentence case for body text, hints, toasts and errors.
- TypeScript strict. Any `any` gets a comment explaining why, because lint runs with `--max-warnings 0`.
- kebab-case file names, named exports (pages excepted), `@/*` imports, zod at every external boundary, `cn()` for conditional classes, forwardRef and displayName on UI components.
- Money is `eur` (en-IE), formatted through `@alter-ego/kernel/currency`, never a hardcoded `Intl.NumberFormat`.

## After coding

Run what you touched (see `test`): the specific test files, `pnpm typecheck`, `pnpm exec eslint --max-warnings 0 <files>`, and the affected E2E spec. Work done directly, with no issue, also runs the whole gate from `test` before `pr`.

## Base branch

The base is the `release/*` branch whose version has no `v<version>` tag yet (the State line; it reads both `release/0.9` and `release/0.10.0` as `v0.9.0` and `v0.10.0`). If there is none, ask the owner; never fall back to `main`. Branch from it, never commit on it, and never on `main`. A patch for an older release names its base explicitly (`release/X.Y.Z` sorts below a newer `release/X.(Y+1)`, so the State line would pick the minor branch). The main checkout sits on the active release branch, so sessions load these skills from it. Promotion to `main` is the owner's (`release`).

$ARGUMENTS = an issue number, a planned PR, or a task description.
