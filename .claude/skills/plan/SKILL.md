---
model: opus
description: Deep architecture planning for complex features
user_invocable: true
---

# /plan — Architecture Planning

Deep planning mode for complex features. Produces a detailed implementation plan.

## Process

1. **Understand the requirement**
   - Clarify the goal with the user if ambiguous
   - Say which modules it touches (crm, invoicing, books, solutions, rent) and what happens with each switched off

2. **Research the codebase**
   - Read relevant existing files
   - Understand current patterns and conventions
   - Check CLAUDE.md for project conventions

3. **Design the solution**
   - Identify all files that need to change
   - Consider the backend adapter pattern
   - Plan data types and Zod schemas
   - Consider component hierarchy
   - Plan hooks and state management

4. **Impact analysis**
   - List all affected files (create/modify/delete)
   - Identify tests that may break
   - Check if `BackendAdapter` / `DatabaseAdapter` / `AIAdapter` interfaces need changes
   - Note if new Zod schemas or types are needed
   - Flag any breaking changes to existing hooks or components

5. **Write the plan**
   - Output to `docs/plans/<feature-name>.md`
   - Structure:
     - Overview
     - Impact analysis (files, tests, adapter interfaces)
     - Files to create/modify
     - Data types
     - Component tree
     - Hook dependencies
     - Testing strategy
     - Open questions

## Rules

- Always consider the "AI is optional" principle
- Follow the backend adapter pattern
- Plan for both mock and real backend implementations
- Consider mobile responsiveness
- Include test coverage in the plan
