---
model: haiku
description: Stage and commit changes using Conventional Commits format
user_invocable: true
disable-model-invocation: true
allowed-tools: Bash(git *)
---

# /commit — Conventional Commits

Create a well-structured git commit following Conventional Commits format.

## State

- Status: !`git status --short`
- Recent: !`git log --oneline -5`
- Branch: !`git branch --show-current`

## Steps

1. Run `git status` to see all changes
2. Run `git diff --cached` to see staged changes (if any)
3. Run `git diff` to see unstaged changes
4. Run `git log --oneline -5` to see recent commit style
5. Stage relevant files (prefer specific files over `git add .`)
6. Create commit with Conventional Commits format:
   - `feat:` — new feature
   - `fix:` — bug fix
   - `refactor:` — code restructuring
   - `test:` — adding/updating tests
   - `docs:` — documentation changes
   - `chore:` — maintenance tasks
   - `style:` — formatting, no logic change
   - `perf:` — performance improvement
7. Use scoped commits when the change is isolated to a domain:
   - `feat(crm):` `fix(invoicing):` `refactor(books):`
   - `feat(solutions):` `fix(rent):` `refactor(backend):`
   - `feat(mcp):` `fix(settings):` `chore(ui):`
   - `chore(docs):` `refactor(types):` `fix(lib):`
8. Keep the subject line under 72 characters
9. Add a body if the change needs explanation

## Rules

- Never commit `.env` files or secrets
- Never use `--no-verify`
- Stage specific files, not `git add .`
- If nothing is staged or changed, inform the user
- Do NOT push

$ARGUMENTS = guidance for commit message.
