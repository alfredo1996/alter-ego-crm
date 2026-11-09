---
name: review
description: Review changes for code quality, security, and Alter Ego conventions.
model: sonnet
user_invocable: true
allowed-tools: Read, Bash(gh *), Bash(git *), Grep(*), Glob(*)
---

# /review — Code Review

## State

- Branch: !`git branch --show-current`
- Changed: !`BASE=$(T=$(git ls-remote --tags origin | sed 's|.*refs/tags/||'); git ls-remote --heads origin 'release/*' | sed 's|.*refs/heads/||' | while read -r b; do v=${b#release/}; [ "$(echo "$v" | tr -cd . | wc -c)" -lt 2 ] && v=$v.0; echo "$T" | grep -qx "v$v" || echo "$b"; done | sort -V | tail -1); [ -n "$BASE" ] && git diff --name-only "origin/$BASE...HEAD" || echo "no open release branch: ask the owner"`

## Checklist

### Architecture (BLOCKING)

- Backend adapter pattern: no direct Firebase imports outside `apps/web/src/lib/backend/`
- AI is optional: no feature gated behind AI
- Data access only through `getBackend()` adapter
- Components use forwardRef + displayName

### Code Quality (HIGH)

- TypeScript strict — no untyped `any`
- Zod schemas for external data boundaries
- Named exports only (except pages)
- kebab-case file naming
- `@/*` path alias for imports
- `cn()` for conditional Tailwind classes

### Security (HIGH)

- No credentials or secrets in code
- No `.env` values hardcoded
- Proper input validation with Zod

### Testing (MEDIUM)

- New behavior has corresponding tests
- Tests in `__tests__/` directories or colocated as `*.test.ts`
- E2E tests for critical user flows in `apps/web/e2e/`

### Simplicity (LOW)

- No over-engineering or premature abstraction
- No dead code or unused imports
- Three similar lines > a premature abstraction

## Output Format

```
[CRITICAL] file:line — Issue → Required fix
[HIGH] file:line — Issue → Suggested fix
[MEDIUM] file:line — Issue → Suggested fix
[LOW] file:line — Issue → Suggested fix

Verdict: APPROVE | REQUEST CHANGES (N critical, N high)
Summary: One-line summary of the change quality.
```

$ARGUMENTS = PR number, branch name, or file paths to review.
