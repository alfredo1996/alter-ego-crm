---
name: github-workflow
description: GitHub conventions — branching, commits, labels for Alter Ego.
model: haiku
user_invocable: true
---

# /github-workflow — Alter Ego Conventions

## Branch Naming

Prefix branches with the change type:

- `feat/` — new features
- `fix/` — bug fixes
- `refactor/` — code restructuring
- `test/` — test additions/updates
- `docs/` — documentation
- `chore/` — maintenance tasks

Example: `feat/transaction-filters`, `fix/account-balance-calc`

## Commit Format

Conventional Commits: `type(scope): description`

### Types

`feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `style`, `perf`

### Scopes (optional, use when change is domain-specific)

`crm`, `invoicing`, `books`, `solutions`, `rent`, `mcp`, `backend`, `settings`, `ui`, `docs`

### Examples

- `feat(invoicing): add a credit note`
- `fix(books): correct the date range filter`
- `refactor(backend): extract auth adapter interface`
- `chore: update dependencies`

## Labels

The repo has `bug`, `enhancement` and `documentation` for the change type; use those. There are no `area:*` or `priority:*` labels.

## Reading and editing here

Act as `alfredo1996` (`gh auth switch --user alfredo1996`). Read with `--json` (`gh issue view <N> --repo alfredo1996/alter-ego-crm --json title,body,labels,comments`). `gh issue edit` and `gh pr edit` fail on this repo: use `gh api -X PATCH` for body, milestone and base, and `gh api -X POST .../labels` for labels.

## PR Title

Same format as commits: `type(scope): description` (under 70 chars)
