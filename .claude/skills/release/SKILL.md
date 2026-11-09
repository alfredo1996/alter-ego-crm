---
name: release
description: Cut an Alter Ego release (version bump, release PR to main, squash merge, tag and notes, rules deploy, next release branch). Run on purpose, because the merge is the production deploy.
disable-model-invocation: true
allowed-tools: Read, Edit, Bash(gh *), Bash(git *), Bash(pnpm *), Bash(node *)
---

# Release — Alter Ego

Every step that publishes (the merge into `main`, the tag, a rules deploy) needs the owner's explicit go in this session, one go per step. $ARGUMENTS = the version, e.g. `0.13.0`. Act as `alfredo1996` (`gh auth switch --user alfredo1996`).

App Hosting deploys `main` on merge, so the release merge is the production deploy. Actions runs again since 2026-11-02 (#433 was the first green run), so the gate is CI's checks on the release PR, at `pr`'s merge bar. If Actions cannot start (a check that fails in about 2 seconds with a billing annotation, as `pr` describes), the gate is the local one from `test`, plus each PR's own.

## State

- Release branch (empty means none open: ask the owner): !`T=$(git ls-remote --tags origin | sed 's|.*refs/tags/||'); git ls-remote --heads origin 'release/*' | sed 's|.*refs/heads/||' | while read -r b; do v=${b#release/}; [ "$(echo "$v" | tr -cd . | wc -c)" -lt 2 ] && v=$v.0; echo "$T" | grep -qx "v$v" || echo "$b"; done | sort -V | tail -1`
- Last tag: !`git fetch -q origin; git describe --tags --abbrev=0 origin/main`

## 1. Ready?

- **Milestone:** the release's milestone has no open issue, and each PR in it merged on the owner's ok.
- **Gate:** the last PR merged into the release branch passed its CI checks (`gh pr list --repo alfredo1996/alter-ego-crm --base <release-branch> --state merged --limit 1 --json number,statusCheckRollup`); a push to `release/*` triggers no run of its own. If Actions cannot start, the `test` gate passes on the release branch's head instead (tsc, lint, unit, builds, and the emulator suite and E2E if the release touched them).
- **Rules:** did `firestore.rules`, `storage.rules` or `firestore.indexes.json` change since the last tag? `git fetch origin` first, then `git diff <last-tag>..origin/<release-branch> --stat -- firestore.rules storage.rules firestore.indexes.json`. If yes, step 5 applies.

## 2. Bump (a PR into the release branch)

The release branch is shared and is what ships, so the bump lands on it: cut `chore/release-X.Y.Z` from `origin/<release-branch>`, set `version` in `package.json` to X.Y.Z, set `target-branch` in `.github/dependabot.yml` to the next release branch (`release/X.(Y+1)`, the one step 6 creates), commit `chore(release): X.Y.Z`, and open a PR with `--base <release-branch>` (merged on the owner's ok, as `pr` says). There is no CHANGELOG file. Anything merged into the release branch after this cut must be in it before step 3.

## 3. The release PR (owner's go to merge)

1. Open it with head `<release-branch>` and base `main`, titled `chore(release): X.Y.Z`, with `pr`'s body shape: the issues and PRs it ships by number, grouped as Highlights / CRM / reliability / upgrade notes (MCP version, renamed output keys), then Merge danger and Tests. Use `gh pr create --base main --head <release-branch>`. If `main` moved (a hotfix), merge it into the release branch first.
2. Gate the head that actually merges: read `headRefOid` (`gh pr view <N> --json headRefOid`); CI's checks must have run on exactly that commit and passed, at `pr`'s merge bar. If Actions cannot start, run the `test` gate on that commit instead.
   2a. **The release that first ships the `apps/web` layout (the pnpm workspace, #422) only:** App Hosting installs from the backend's root directory, so change it in the console as an explicit step: App Hosting, backend `my-web-app`, Settings, root directory `/` to `apps/web`. Do it after the release PR's gate and immediately before step 3's merge: earlier breaks the rollouts of today's `main`, later fails the merge's own rollout. Then watch that rollout. The CRM backend does not exist yet (`apps/web/apphosting.crm.yaml`), so there is nothing to switch for it. App Hosting installs at the repo root only because `turbo.json` marks it as the monorepo root (its Turborepo support; without it the build stops at "Missing dependency lock file at path '/workspace/apps/web'", see #422), then builds with `turbo run build --filter=@alter-ego/web`.
3. Merge only on the owner's ok, pinned to it: `gh pr merge <N> --squash --match-head-commit <headRefOid>`. Auto-merge is off in repo settings.
4. Read the squash sha with `gh pr view <N> --json mergeCommit`, then `git fetch origin` (`gh pr merge` does not update local refs).

## 4. Tag and notes (owner's go)

```bash
gh release create vX.Y.Z --repo alfredo1996/alter-ego-crm --target <squash sha> --title "vX.Y.Z" --notes-file notes.md
```

`notes.md` is the PR body minus Tests and Merge danger. Check the release page afterwards. There is no image tag.

## 5. Rules (only if step 1 says they changed; owner's go)

App Hosting goes live at the merge, so the order matters; decide it per release. Deploy the rules BEFORE the merge when the new rules still accept the old code's writes (the usual case for added collections; `storage.rules` is new with the first release that has invoice files, and the old code writes no object, so it too goes before; #281 went this way before v0.11.0). Otherwise deploy right after the merge, before the tag. This repository has no deploy workflow (deploys live elsewhere), so deploy by hand from a checkout whose rules equal the release head (before the merge) or `origin/main` (after); fetch and diff first:

```bash
git fetch origin
git diff origin/<release-branch or main> -- firestore.rules storage.rules firestore.indexes.json   # must print nothing
pnpm exec firebase deploy --only firestore:rules,storage --project <project-id>
```

Always pass `--project`: `.firebaserc` defaults to `demo-alter-ego`. For indexes use `--only firestore:indexes`. The first release with invoice files also needs the bucket's CORS set once (owner, `gcloud storage buckets update gs://<project-id>.firebasestorage.app --cors-file=cors.json`; see `docs/DEPLOYMENT.md`), or the View and Download buttons fail in production. App Hosting's rollout status is in the console only.

## 6. After

1. Create the next branch from the squash sha, not from a local `origin/main`: `git push origin <squash sha>:refs/heads/release/X.Y` (the next minor, two-part like `release/0.14`). A patch branch `release/X.Y.Z` cut later sorts below it, so patch PRs name their base explicitly. The State lines of `code`, `pr` and `test` pick it up as the base.
2. Close the milestone and move leftovers to the next one.
3. Keep the released branch; the base rule skips versions that have a tag.
4. Update the memory `project_release_process.md` with the version, PR, squash sha and any rules deploy.
