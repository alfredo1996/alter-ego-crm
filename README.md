# Alter Ego CRM

> Run a small Italian SRL from one codebase: pipeline, contracts, time, invoices, the cash book.

## Overview

Alter Ego CRM is the management app of an Italian SRL (a small consultancy, for
one owner), built on Next.js 16. It covers:

- **CRM** — the sales pipeline, clients, contracts and their amendments,
  collaborators, tasks, deadlines, and the Plan: capacity and hours (the runway
  appears with Books, the quarters with Books and Invoicing).
- **Invoicing** — invoices and credit notes, unbilled hours, invoice files
  (FatturaPA XML, signed or not, or PDF) and the accountant's package.
- **Books** — the cash book over the company accounts (with the workbook
  import), costs, cost centres and the Month End close.
- **Solutions** — a catalog of delivered solutions with their data model graph.
- **Rent** — tenants and yearly leases, with payments linked to the month they cover.

Each area is a **module** that a deployment can switch off with
`NEXT_PUBLIC_DISABLED_MODULES`: its pages, links and connector tools go, and its
data is not touched. The backend is swappable through an adapter (`mock` or
Firebase), and an MCP server exposes the same data to an AI client over HTTP
(OAuth 2.1) or stdio.

The app has no AI layer of its own: the MCP connector is the only AI surface, and
every feature works without it. The app never computes taxes: it keeps the cash flow, and
the tax return stays with the accountant.

## Tech Stack

| Layer           | Tech                                                         |
| --------------- | ------------------------------------------------------------ |
| Framework       | Next.js 16 (App Router, Turbopack)                           |
| Language        | TypeScript (strict mode)                                     |
| Styling         | Tailwind CSS v4, shadcn/ui                                   |
| State           | Zustand (client settings), TanStack Query (server state)     |
| Forms           | React Hook Form + Zod validation                             |
| Backend         | Adapter pattern — Mock / Firebase (swap via env var)         |
| Testing         | Vitest (unit/integration), Playwright (E2E)                  |
| Docs            | Fumadocs (MDX documentation at `/docs`, English and Italian) |
| Package Manager | pnpm                                                         |

## Getting Started

### Prerequisites

- Node.js 24+ (see `.nvmrc`)
- pnpm 10+
- (Optional) Docker for the Firebase emulator

### Quick Start (mock backend — zero config)

```bash
git clone https://github.com/alfredo1996/alter-ego-crm.git
cd alter-ego-crm
pnpm install
pnpm dev          # http://localhost:3000
```

Sign in with a valid email and a password of six or more characters — the mock backend stores everything in memory.
Data lives in the browser tab and is gone on reload — fine for a look around,
not for real use.

On a real backend, any Auth account can sign in, but the Firestore rules admit
one user id (set in `apps/web/src/lib/owner-uid.ts` and in the rules) and deny
the rest; see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

### Self-hosted, with data that persists

Runs against a Firebase emulator in Docker. No cloud account, nothing leaves the
machine, and the UI and MCP server share one store:

```bash
pnpm local:start     # emulator, restoring ./.emulator-data
pnpm dev:emulator    # http://localhost:3003
pnpm local:stop      # exports on the way out
```

Full setup, MCP client config and the honest limits are in
[docs/SELF-HOSTING.md](docs/SELF-HOSTING.md). To run your own hosted deployment,
see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Environment Variables

Copy `apps/web/.env.example` to `apps/web/.env.local` and set these:

| Variable                                   | Description                   | Required        | Default |
| ------------------------------------------ | ----------------------------- | --------------- | ------- |
| `NEXT_PUBLIC_BACKEND`                      | Backend adapter to use        | No              | `mock`  |
| `NEXT_PUBLIC_FIREBASE_API_KEY`             | Firebase API key              | When `firebase` | —       |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`         | Firebase auth domain          | When `firebase` | —       |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID`          | Firebase project ID           | When `firebase` | —       |
| `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`      | Firebase storage bucket       | When `firebase` | —       |
| `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | Firebase messaging sender ID  | When `firebase` | —       |
| `NEXT_PUBLIC_FIREBASE_APP_ID`              | Firebase app ID               | When `firebase` | —       |
| `NEXT_PUBLIC_DISABLED_MODULES`             | Ids to leave out; see below   | No              | none    |
| `NEXT_PUBLIC_USE_EMULATOR`                 | Point the SDK at the emulator | No              | `false` |

`NEXT_PUBLIC_DISABLED_MODULES` is a comma-separated list of the modules a
deployment leaves out: `crm`, `invoicing`, `books`, `solutions`, `rent`.
`invoicing` and `solutions` need `crm`, and `rent` needs `books`: leaving out a
module that another still needs stops the build. Everything is on when it is
unset. A module that is left out disappears from the sidebar, its pages and the
connector, and its data is not touched.

Server-side only, never `NEXT_PUBLIC_` and never committed — needed for the MCP
server, which uses the Admin SDK and bypasses Firestore rules:
`FIREBASE_SERVICE_ACCOUNT_JSON` or `GOOGLE_APPLICATION_CREDENTIALS`,
`ALTER_EGO_USER_ID` (stdio MCP), `MCP_PUBLIC_ORIGIN`. See `apps/web/.env.example`.

## MCP server

- 67 tools over the company data, for Claude or any MCP client; a module
  that is switched off serves none of its tools
- Remote over HTTP at `/api/mcp` with OAuth 2.1 + PKCE (scopes `data:read` and
  `data:write`) or an API key, or local over stdio with no auth at all
- See [docs/SELF-HOSTING.md](docs/SELF-HOSTING.md)

## Project Structure

```
apps/web/src/   (kernel: packages/kernel; UI kit: packages/ui; Rent: packages/modules/rent)
├── app/
│   ├── (auth)/              # /login, /register (sign-up is closed)
│   ├── (app)/               # /pipeline, /clients, /collaborators, /solutions,
│   │                        #   /invoices, /cash-book, /rent, /month-end, /tasks,
│   │                        #   /plan, /deadlines, /costs, /settings
│   ├── api/                 # MCP server, OAuth endpoints, API keys
│   └── [lang]/docs/         # Fumadocs pages
├── components/              # crm, plan, deadlines, company-expenses, cash-book,
│                            #   month-end, rent, settings, auth
├── hooks/                   # TanStack Query hooks (use-clients, use-invoices, …)
├── lib/
│   ├── backend/             # Adapter: types.ts, mock.ts, firebase.ts, firebase-admin.ts
│   ├── mcp/                 # MCP tools (crm-*, rent, shared helpers)
│   ├── oauth/               # OAuth 2.1 authorization server for the MCP endpoint
│   ├── projection.ts        # Month-by-month company projection
│   ├── engagement-burndown.ts # Contract budget burn-down
│   └── opportunities.ts     # Pipeline stages and weighting
├── modules/                 # The module registry (manifests are data)
├── stores/                  # Zustand: useSettingsStore
└── types/                   # Types (index.ts, crm.ts) + Zod schemas
```

## Architecture

### Backend Adapter Pattern

All data access goes through `getBackend()` — **never** import Firebase directly in feature code:

```typescript
import { getBackend } from "@/lib/backend";
const { db, auth } = getBackend();
const clients = await db.getClients(userId);
```

The adapter is selected by `NEXT_PUBLIC_BACKEND` (`mock` | `firebase`). Each adapter implements `BackendAdapter` (composed of `AuthAdapter`, `DatabaseAdapter` and `FilesAdapter`). This means you can develop entirely against the mock backend and switch to Firebase with a single env var change. The MCP server reaches the database through `getServerDb()`.

### State Management

- **Zustand** (`useSettingsStore`) for client-only settings: the theme
- **TanStack Query** for all server state: clients, contracts, invoices, the cash book, and so on.

### AI Philosophy

AI is optional and never gates functionality. The app has no AI layer of its own; the MCP connector is the only AI surface, and every feature works without it.

## Testing

### Unit Tests (Vitest)

```bash
pnpm test             # watch mode
pnpm test --run       # single run
pnpm test:coverage    # with coverage report
```

Test files live in `__tests__/` directories next to the code they test. Coverage
focuses on `apps/web/src/lib/**` (utilities, business logic, backend adapters).
`firestore-rules-build.test.ts` fails when `firestore.rules` no longer matches its
sources: the file is **generated** by `pnpm rules:build` from `firestore/base.rules`,
`firestore/crm.rules` and the modules' rules (`packages/modules/rent/src/rent.rules`),
so edit those, never the output. The registry tests prove a deployment can switch
`rent` and `solutions` off.

### E2E Tests (Playwright) — 30 specs

```bash
pnpm test:e2e           # the whole suite, against a production mock build
pnpm test:e2e:modules   # a build with Invoicing and Solutions left out
```

Specs are in `apps/web/e2e/`: sign-in and sign-out, navigation, settings, the
pipeline, clients and collaborators, invoices and invoice files, the cash book,
Month End, Rent, the Plan, the phone layout and the loading states.

### Contract Tests

The adapter contract test suite (`apps/web/src/lib/backend/__tests__/adapter-contract.ts`) defines shared tests that any backend adapter must pass. It runs against mock (always) and Firebase (under the emulator).

```bash
pnpm test:firebase           # needs the emulators running
pnpm test:firebase:docker    # starts the emulator via Docker first
```

## Commands

| Command                     | Description                             |
| --------------------------- | --------------------------------------- |
| `pnpm dev`                  | Dev server, mock backend (Turbopack)    |
| `pnpm dev:emulator`         | Dev server against the local emulator   |
| `pnpm build`                | Production build                        |
| `pnpm lint`                 | ESLint                                  |
| `pnpm test`                 | Vitest (watch mode)                     |
| `pnpm test --run`           | Vitest (single run)                     |
| `pnpm test:coverage`        | Vitest with coverage report             |
| `pnpm test:e2e`             | Playwright E2E tests                    |
| `pnpm test:firebase`        | Firebase adapter contract tests         |
| `pnpm test:firebase:docker` | Same, starts emulator via Docker first  |
| `pnpm local:start`          | Persistent emulator for self-hosting    |
| `pnpm local:stop`           | Stop it, exporting data on the way out  |
| `pnpm local:logs`           | Tail the persistent emulator            |
| `pnpm emulator:start`       | Ephemeral emulator (tests)              |
| `pnpm emulator:stop`        | Stop the ephemeral emulator             |
| `pnpm mcp:stdio`            | MCP server over stdio                   |
| `pnpm rules:build`          | Regenerate `firestore.rules`            |
| `pnpm seed:demo`            | A demo user with sample data (emulator) |
| `pnpm typecheck`            | Type check                              |

## Documentation

- **[alfredo1996.github.io/alter-ego-crm](https://alfredo1996.github.io/alter-ego-crm/)** — the docs site, covering architecture, the backend adapters, deployment, and contributing guides, in English and Italian. The app serves the same pages under `/docs`
- **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)** — Deploy your own on Firebase App Hosting
- **[docs/SELF-HOSTING.md](docs/SELF-HOSTING.md)** — Running it locally with persistent data, and connecting an MCP client

## Contributing

- **Conventional Commits**: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`
- **Branch naming**: `feat/`, `fix/`, `refactor/` prefixes
- **File naming**: kebab-case (`use-clients.ts`, `client-card.tsx`)
- **Exports**: Named exports only (no default exports except pages)
- **Imports**: Use `@/*` path alias
- **Styling**: Use `cn()` utility for conditional Tailwind classes
- **Testing**: Add unit tests for new utilities/logic, E2E tests for new user flows

See the [contributing guide](content/docs/en/contributing/conventions.mdx) for full details.

The personal-finance app is a separate project:
[alter-ego](https://github.com/alfredo1996/alter-ego).

## License

[MIT](LICENSE) © 2026 Alfredo Rubin.
