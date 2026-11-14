# Alter Ego CRM — Project Conventions

## One product

This repo ships the company app of an Italian SRL: pipeline, contracts, time and
the plan, invoices and their files, the cash book, month-end close, solutions and
rent. It was cut from the larger Alter Ego repository, which also held a
personal-finance app; nothing of that side is left, and there is no build mode.

Some tests guard the structure, and working around one of them defeats the point:

| Test                                                       | Enforces                                                                      |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `apps/web/src/lib/__tests__/firestore-rules-build.test.ts` | `firestore.rules` matches its sources                                         |
| `apps/web/src/lib/mcp/__tests__/adapter-boundary.test.ts`  | The MCP layer never imports Firebase directly                                 |
| `apps/web/src/modules/__tests__/registry.test.ts`          | Every MCP tool belongs to one module; a module can be switched off            |
| `packages/kernel/src/__tests__/boundary.test.ts`           | The kernel imports nothing app-side                                           |
| `packages/ui/src/__tests__/boundary.test.ts`               | The UI kit imports only the kernel and its own dependencies                   |
| `packages/modules/rent/src/__tests__/boundary.test.ts`     | A module package imports only the kernel, the UI kit and its own dependencies |

**`firestore.rules` is generated.** Edit `firestore/base.rules` (the shared part:
users, API keys, OAuth, `mcp_audit`), `firestore/crm.rules` or a module's
`src/<name>.rules`, and run `pnpm rules:build`. Editing the output directly loses
the change on the next build.

**The test gate is one run**: `pnpm test --run`.

## Core Principle

**AI is optional.** The app must be fully functional without any AI features. The app ships no AI layer of its own; the MCP connector lets an assistant read and write the same data, and nothing is gated behind it.

The app never computes taxes: it keeps the cash flow, and the tax return stays with the accountant.

## Tech Stack

- **Framework**: Next.js 16 (App Router, Turbopack)
- **Language**: TypeScript (strict mode)
- **Styling**: Tailwind CSS v4, shadcn/ui components
- **State**: Zustand (client settings), TanStack Query (server state)
- **Forms**: React Hook Form + Zod validation
- **Backend**: Adapter pattern — swap Firebase/Mock without touching feature code
- **Testing**: Vitest (unit/integration), Playwright (E2E)
- **Package Manager**: pnpm

## Architecture

The repo is a pnpm workspace. **Every path in this file and in `.claude/` is written from the repo
root** (`apps/web/src/...`, `packages/ui/src/...`). Run the familiar commands from the
repo root: they forward to `apps/web`, which is where tests, the Playwright config and
`.env.local` live.

```
apps/web/                 # the Next.js app (@alter-ego/web); its own .env.local lives here
├── src/
│   ├── app/
│   │   ├── (auth)/       # Sign-in (unauthenticated)
│   │   ├── (app)/        # pipeline, clients, tasks, plan, deadlines, costs, invoices, cash book…
│   │   ├── api/          # MCP server, OAuth endpoints, API keys
│   │   └── [lang]/docs/  # Fumadocs
│   ├── components/       # crm, plan, deadlines, company-expenses, cash-book, month-end, rent…
│   ├── hooks/            # React hooks (use-clients, use-invoices, etc.)
│   ├── lib/
│   │   ├── backend/      # Adapter (types, mock, firebase, firebase-admin, server-db)
│   │   ├── mcp/          # MCP tools: crm-*, rent, context.ts, helpers.ts
│   │   ├── oauth/        # OAuth 2.1 server for the remote MCP endpoint
│   │   └── italian-tax.ts, projection.ts, engagement-burndown.ts   # the engine
│   ├── modules/          # the module registry (manifests are data)
│   ├── stores/           # Zustand stores
│   └── types/            # index.ts + crm.ts, schemas.ts
├── apphosting.yaml       # App Hosting reads this from the backend's root directory
│                         #   (set to apps/web in the console); demo values, see docs/DEPLOYMENT.md
└── e2e/, scripts/, vitest*.ts, playwright*.ts
packages/
├── kernel/               # @alter-ego/kernel: money (currency), dates, the module contract.
│                         # Imports nothing app-side
├── modules/rent/         # @alter-ego/rent, the first module package: types, zod, pure lease logic, its
│                         # adapter slice (mock + Firebase), its rules fragment, hooks, the page and dialogs.
│                         # The app only composes it. See "The Module Registry" below
└── ui/                   # @alter-ego/ui: ui/ (shadcn primitives; keep their APIs: add a
                          # variant, never rename one), page/ (the page kit: every page's h1
                          # is a PageHeader), FiltersSheet, use-toast, cn(), tokens.css.
                          # Imports only the kernel and its own dependencies
firestore/, firestore.rules, storage.rules, firebase.json, docker/   # stay at the root
skills/                   # Claude Code skills shipped with the repo (file-work)
```

Import the packages as `@alter-ego/ui/ui/button`, `@alter-ego/ui/page/page-header`,
`@alter-ego/ui/utils` (`cn`), `@alter-ego/kernel/currency`, `@alter-ego/kernel/dates`.
Each package has a boundary test (`packages/*/src/__tests__/boundary.test.ts`) that
fails on a forbidden import. Type-check everything with `pnpm typecheck`.

## The Module Registry

The areas of the app are modules (`crm`, `invoicing`, `books`, `solutions`, `rent`), declared as data in
`apps/web/src/modules`. `NEXT_PUBLIC_DISABLED_MODULES` (comma-separated ids, everything on when unset) leaves
some out: their nav links, routes and MCP tools go, their data is not touched, and a module that needs a
disabled one fails the build. `resolveModules` is the one place that decides; `isModuleOn` is what pages and
tools ask. Anything that works with every module on has to keep working with one off.

A module may also be a package under `packages/modules/<name>` (`@alter-ego/<name>`), TypeScript source with
`exports` pointing at `src` and no build step, like the kernel and the UI kit. It imports only the
kernel, the UI kit and its own declared dependencies, never `@/`: the app hands its page `db` and
`userId` as props, and the Firebase slice takes the app's Firestore helpers as arguments. Its slice of
the database is an interface the app's `DatabaseAdapter` extends (the mock and `firebase.ts` spread the
implementation in), its tests are called from `adapter-contract.ts`, and its rules are a third fragment
(`src/<name>.rules`) that `scripts/build-firestore-rules.mjs` splices after `crm.rules`. A new package needs:
`packages/modules/*` in `pnpm-workspace.yaml` (already there), the vitest include (and its coverage
include/exclude globs, already `packages/modules/*`), the Tailwind v4 syntax scan (already reads `packages/modules`), `pnpm typecheck`,
`transpilePackages`, a Tailwind `@source` in `globals.css`, the `firebase-emulator.yml` paths, and a
manifest in the registry.

## Backend Adapter Pattern

**NEVER import Firebase directly in feature code.**

All data access goes through `@/lib/backend`:

```typescript
import { getBackend } from "@/lib/backend";
const backend = getBackend();
await backend.db.getClients(userId);
```

The adapter is selected by `NEXT_PUBLIC_BACKEND` env var (`mock` | `firebase`).

Interfaces in `lib/backend/types.ts`:

- `CrmAdapter` — the company side; `RentAdapter` — the Rent module's slice; `ApiKeysAdapter`
- `DatabaseAdapter` — all three, what every adapter implements
- `AuthAdapter`, `FilesAdapter`, `BackendAdapter`
- `AuditAdapter`, `CrmServerAdapter` — **server-only**, deliberately off
  `DatabaseAdapter`: `mcp_audit` is `allow read, write: if false`, so the
  client SDK could never implement it. Reached via `getServerDb()`.

This rule is enforced, not just stated: the MCP tools once imported
`firebase-admin` directly, which silently made the whole MCP server Firebase-only.
`apps/web/src/lib/mcp/__tests__/adapter-boundary.test.ts` fails if that returns.

## Coding Conventions

- **File naming**: kebab-case (`use-clients.ts`, `client-card.tsx`)
- **Exports**: Named exports only (no default exports except pages)
- **Imports**: Use `@/*` path alias
- **Styling**: Use `cn()` utility for conditional Tailwind classes
- **Validation**: Zod schemas for all external data boundaries
- **Components**: forwardRef pattern, displayName for all UI components
- **Types**: Colocate with usage or in `apps/web/src/types/` for shared types
- **Language**: the whole app is English: UI copy, zod
  messages, errors, and every MCP title, description and reply. Plain English
  literals, no i18n layer. Title Case for buttons, dialog titles and headings
  ("New Task", "Delete Client"); sentence case for body text, hints, toasts and
  errors. Italian stays only for tax acronyms (IRPEF, IRES, IRAP, INPS, F24,
  SRL; IVA is written VAT), user data, the prima nota import parser
  (`lib/prima-nota.ts`: the workbook's sheet names,
  headers and keywords, such as Maggio, Saldo, Incasso fattura, deposito
  cauzionale), the `/it/docs` locale, and in MCP descriptions inside «…»:
  owner-phrasing routing hints (at most 3 per tool) and fiscal-term glosses.
  Money is `eur` (en-IE, EUR; `@alter-ego/kernel/currency`); dates use the date-fns default locale.

## Testing Strategy

- **Vitest**: Unit tests for utilities, hooks, and business logic
  - File pattern: `*.test.ts` colocated in `__tests__/` directories
  - Run: `pnpm test`
- **Playwright**: E2E tests for critical user flows
  - Directory: `apps/web/e2e/`
  - Run: `pnpm test:e2e` (`pnpm test:e2e:modules` for a build with modules left out)

## Commands

```bash
pnpm dev                   # Dev server, mock backend (Turbopack, port 3000)
pnpm dev:emulator          # Dev server against the local emulator (port 3003)
pnpm build                 # Production build
pnpm lint                  # ESLint
pnpm test                  # Vitest (watch mode)
pnpm test --run            # Vitest (single run)
pnpm test:e2e              # Playwright E2E tests
pnpm test:e2e:modules      # E2E against a build with Invoicing and Solutions left out
pnpm shots                 # Every page and tab, sign-in, empty pipeline; desktop + phone, light + dark (mock server; --base, --out, --prefix, paths)
pnpm seed:demo             # Demo user with sample data in the local emulator; credentials in scripts/seed-demo.mjs
pnpm test:firebase:docker  # Emulator suite (Docker)
pnpm rules:build           # Regenerate firestore.rules from its fragments
pnpm local:start           # Persistent emulator (docs/SELF-HOSTING.md)
pnpm mcp:stdio             # MCP server over stdio (needs ALTER_EGO_USER_ID)
```

Changes under `apps/web/src/lib/backend/`, `apps/web/src/lib/mcp/` or the rules need the emulator
suite as well as the unit tests — CI runs it on those paths.

A write path needs a case in `apps/web/src/lib/backend/__tests__/adapter-contract.ts`, so
it runs against the emulator: a bug in the Firebase adapter once slipped past tests that only ran
the mock.

## Git Conventions

- Conventional Commits: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`
- Branch naming: `feat/`, `fix/`, `refactor/` prefixes
- PR titles match commit convention
- PRs target `main`
