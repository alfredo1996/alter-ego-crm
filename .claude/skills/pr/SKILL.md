---
name: pr
description: Open an Alter Ego pull request against the active release branch, and merge it only on the owner's explicit ok (one ok per merge) at the full bar. Use when a branch is ready for a PR or a PR is ready to merge.
allowed-tools: Bash(gh *), Bash(git *), Bash(pnpm *)
---

# PR — Alter Ego

## State

- Branch: !`git branch --show-current`
- PR base (empty means no open release branch: ask the owner, never use `main`): !`T=$(git ls-remote --tags origin | sed 's|.*refs/tags/||'); git ls-remote --heads origin 'release/*' | sed 's|.*refs/heads/||' | while read -r b; do v=${b#release/}; [ "$(echo "$v" | tr -cd . | wc -c)" -lt 2 ] && v=$v.0; echo "$T" | grep -qx "v$v" || echo "$b"; done | sort -V | tail -1`

## Open

Branching, committing, pushing and opening the PR need no ok. Merging does (below).

1. **Base:** the active release branch: the `release/*` branch whose version has no `v<version>` tag yet (the State line). If there is none, ask the owner; never fall back to `main`. A stacked PR's base is its parent's branch. A patch PR (`release/X.Y.Z` cut after `release/X.(Y+1)` exists) names its base explicitly: the State line sorts the minor branch last.
2. **Pre-flight on the branch:** read `git status`, run `git fetch origin && git rebase origin/<base>`, then the gate for what changed (see `test`; for an issue, the `test-runner` report on this head is the evidence).
3. **Push:** `git push -u origin HEAD`, as the `alfredo1996` gh account (`gh auth switch --user alfredo1996`). The wrong account fails silently: 403 on push, labels and milestone dropped.
4. **Create:** pass labels and milestone at creation when the issue has them. They work there; `gh pr edit` and `gh issue edit` fail on this repo (a Projects classic GraphQL error) and set nothing.

   ```bash
   gh pr create --repo alfredo1996/alter-ego-crm --base <base> --head <branch> \
     --title "<type>(<scope>): <what now happens>" --body-file pr.md
   ```

   The title is a Conventional Commit in user terms, under 70 characters, with no number: the squash merge appends the PR number. To change a PR afterwards: `gh api -X PATCH repos/alfredo1996/alter-ego-crm/pulls/<N> -F body=@pr.md` (or `-f base=<base>`); labels: `gh api -X POST repos/alfredo1996/alter-ego-crm/issues/<N>/labels -f 'labels[]=<label>'`; milestone: `gh api -X PATCH repos/alfredo1996/alter-ego-crm/issues/<N> -F milestone=<number>`.

   Body:

   ```markdown
   Closes #<N>

   ## What was wrong

   One paragraph in user terms, and how it was found.

   ## The fix

   The smallest visual that makes the change clear: a pseudocode block, a call or component tree, a shallow file tree. Then the prose, brief.

   ## Drill (minimal)

   The decisions taken and why: why it exists, what already existed, cause not symptom. Owner questions left open.

   ## Merge danger

   Door: one-way or two-way (can it be rolled back cleanly?).
   Blast radius: one phrase, then what it can break: consumers, layout, data, migrations. Anything the owner has not seen goes here.

   ## Tests

   Red-then-green evidence. What ran locally (modes, suites, the head it ran on), what CI covers, and every step skipped, named.

   🤖 Generated with [Claude Code](https://claude.com/claude-code)
   ```

   - A planned PR with no issue opens with one line naming the plan section and the base branch instead of `Closes #<N>`.
   - A visual change adds `## Evidence` before Merge danger: the before and after screenshots from `pnpm shots`, both themes, desktop and phone. GitHub has no attachment API, so the section names the files.
   - Get the body right first time. `Closes #<N>` closes the issue only when the PR merges into the default branch: a PR into `release/X.Y` leaves it open, so close it by hand after the merge (below).

5. **Review:** for an issue that went through `code`, the `adversarial-reviewer` report and the fixer's fixed and dismissed lists are the evidence; do not order a second review. A branch that skipped `code` runs `adversarial-reviewer` now, and every finding, minors included, goes to a FRESH `implementer` (not the one that wrote it), which fixes it test-first or dismisses it with evidence, as in `code`. In the reviewer's list of untouched callers, one with no reason counts as a finding; the list goes in the PR's Drill section.

## Merging needs the owner's ok

**No merge without the owner's explicit ok, one ok per merge.** That covers `gh pr merge`, enabling auto-merge, a local merge into a shared branch and a direct push to one. A standing permission, when the owner gives one, names its scope and covers nothing outside it. **Promotion to `main` is the owner's:** work lands on the release branch and the owner promotes it. Ask in chat with the PR number, its head, what the checks say and the Merge danger. When the owner decides something about the PR, record it on the PR or the issue as a comment opening `**Decision (owner, YYYY-MM-DD, in chat):**`.

## Merge bar: all of it, checked live, right after the ok

1. **Every check passed, none pending:** `gh pr checks <N> --repo alfredo1996/alter-ego-crm`. They are `Vitest Unit Tests` (lint, tsc, unit, build) and `Playwright E2E`, plus `Firebase Adapter Contract Tests` when the paths in `firebase-emulator.yml` changed and the docs build when `content/docs/` or `docs-site/` did. Right after a push GitHub can report CLEAN before any check has registered, so count them.
   - **CI may not have run at all.** A check that fails in about 2 seconds with no steps never started; its annotation says why (`gh api repos/alfredo1996/alter-ego-crm/check-runs/<job id>/annotations --jq '.[].message'`, the job id being the last segment of the URL in `gh pr checks`). If Actions cannot start (it could not on 2026-10-16: payments failed), the PR is UNSTABLE by construction, and the bar becomes the local gate on the exact head: the `test-runner` report all green, the whole E2E suite included. The PR says "CI did not run" under Tests, and the exception is the owner's to grant in that merge's ok.
2. **The merge state is `CLEAN`:** `gh pr view <N> --repo alfredo1996/alter-ego-crm --json mergeStateStatus`. Never merge on `UNSTABLE`, `BLOCKED` or `UNKNOWN`, except as point 1 describes and the owner granted.
3. **No E2E test passed only on retry.** Playwright retries once locally and twice on CI, so a test that fails and then passes still leaves the run green, and CI's `html` reporter prints no per-test lines to the log. The zero-retry local run is the gate: a failure there is root-caused, and filed if it isn't this PR's. Never re-run until it goes green.
4. **The base is not red:** the last PR merged into the base passed its checks, or failed only for the reason in point 1 (`gh pr list --repo alfredo1996/alter-ego-crm --base <base> --state merged --limit 1 --json number,statusCheckRollup`). A push to `release/*` triggers no run; `main` and `dev` pushes do.
5. **Comments:** read every PR comment and inline review comment, bot or human: `gh pr view <N> --repo alfredo1996/alter-ego-crm --json comments,reviews` and `gh api repos/alfredo1996/alter-ego-crm/pulls/<N>/comments`.
6. **The base moved after the gate ran:** rebase, push, and re-run the gate on the new head. Skip that only when the two changes touch different files and cannot interact, and say why in the PR.
7. **Stacked PRs:** retarget the child to the base before merging its parent, or GitHub closes it (`gh api -X PATCH repos/alfredo1996/alter-ego-crm/pulls/<child> -f base=<base>`). After a squash merge, rebase the child `--onto` the base and push it with `--force-with-lease`.

Merge, pinned to the head that was checked:

```bash
gh pr view <N> --repo alfredo1996/alter-ego-crm --json headRefOid,mergeStateStatus
gh pr merge <N> --repo alfredo1996/alter-ego-crm --squash --delete-branch --match-head-commit <headRefOid>
```

Then:

- Close the issue by hand: a comment naming the merge commit, then `gh api -X PATCH repos/alfredo1996/alter-ego-crm/issues/<N> -f state=closed -f state_reason=completed`. Verify with `gh issue view <N> --repo alfredo1996/alter-ego-crm --json state`.
- Remove the worktree and the local branch you created.
- Do not pull or check out in the main checkout: other sessions work there.

$ARGUMENTS = the PR number, or context for a new PR.
