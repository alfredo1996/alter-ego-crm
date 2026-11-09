---
name: issue
description: Create a GitHub issue in the house shape (problem, reproduction, cause, expected, a default fix the owner can override, required tests).
model: haiku
user_invocable: true
disable-model-invocation: true
allowed-tools: Bash(gh *)
---

# /issue — Create GitHub Issue

File an issue for $ARGUMENTS in `alfredo1996/alter-ego-crm`. Act as `alfredo1996` (`gh auth switch --user alfredo1996`): the wrong account drops labels and milestones silently.

## Labels

One of the repo's real labels: `bug`, `enhancement`, `documentation`. Set the milestone when a release is active. Verify both afterwards (`gh issue view N --json labels,milestone`).

`gh issue edit` and `gh pr edit` fail on this repo (a Projects classic GraphQL error) and set nothing. To change an issue afterwards:

- labels: `gh api -X POST repos/alfredo1996/alter-ego-crm/issues/N/labels -f 'labels[]=bug'`
- milestone, body: `gh api -X PATCH repos/alfredo1996/alter-ego-crm/issues/N -F milestone=<number>`

## Title

`type(scope): what is wrong, in user terms` (Conventional Commits).

## Body

```markdown
## Problem

What happens, who it hits, how it was found. Evidence: error text, counts.

## Reproduction

Numbered steps a stranger can follow.

## Cause

What the code does and why, naming file and function. If unknown: "not yet known", hypotheses ranked.

## Expected

The behaviour after the fix.

## Fix (default; the owner can override in a comment)

- The change, made where every caller routes.
- Not chosen: the alternative, and why.
- Out of scope.

## Required tests

Layer by layer, each saying what it asserts. A test that still passes with the fix reverted does not count.
```

Create with `gh issue create --title "..." --label bug --body-file <file>`.

## Rules

- One issue, one PR. A bug found while on a release is its own issue in that release's patch milestone.
- Never chain a command that posts as a fallback (`cmd || gh issue comment`).

$ARGUMENTS = description of the issue to create.
