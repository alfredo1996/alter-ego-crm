# Local Development Guide

## Prerequisites

- **Node.js** 24+ LTS (see `.nvmrc` — run `nvm use` to switch)
- **pnpm** 10+ (`npm install -g pnpm`)
- **Docker** (optional, for Firebase emulator tests — no local Java needed)

## Getting Started

```bash
git clone https://github.com/alfredo1996/alter-ego-crm.git
cd alter-ego-crm
pnpm install
```

---

## Quick Setup (Script)

The fastest way to configure a backend:

```bash
pnpm setup mock       # In-memory, no dependencies
pnpm setup firebase   # Starts emulators, writes apps/web/.env.local
```

The script writes `apps/web/.env.local`, starts any required services, and tells you when to run `pnpm dev`.

---

## Manual Setup

Alter Ego supports two backends, selected by the `NEXT_PUBLIC_BACKEND` environment variable in `apps/web/.env.local`. Only one runs at a time.

### Option 1: Mock (Recommended for Development)

No external services needed. All data lives in-memory and resets on page refresh.

```env
# apps/web/.env.local
NEXT_PUBLIC_BACKEND=mock
```

```bash
pnpm dev
```

Open http://localhost:3000 and sign in with any email/password.

### Option 2: Firebase (Local Emulators)

Requires the Firebase CLI (`firebase-tools` is included in devDependencies).

**1. Start emulators:**

```bash
pnpm exec firebase emulators:start --only auth,firestore
```

**2. Configure env:**

```env
# apps/web/.env.local
NEXT_PUBLIC_BACKEND=firebase
NEXT_PUBLIC_FIREBASE_API_KEY=fake-api-key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=localhost
NEXT_PUBLIC_FIREBASE_PROJECT_ID=demo-alterego
```

The Firebase client detects `localhost` and automatically connects to the local emulators.

**3. Start the app:**

```bash
pnpm dev
```

The emulator UI is available at http://127.0.0.1:4000.

---

## Commands Reference

| Command                     | Description                                |
| --------------------------- | ------------------------------------------ |
| `pnpm dev`                  | Start dev server (Turbopack)               |
| `pnpm build`                | Production build                           |
| `pnpm lint`                 | ESLint                                     |
| `pnpm test`                 | Unit tests in watch mode                   |
| `pnpm test --run`           | Unit tests (single run)                    |
| `pnpm test:e2e`             | Playwright E2E tests                       |
| `pnpm test:firebase`        | Firebase emulator integration tests        |
| `pnpm test:firebase:docker` | Same, but starts emulator via Docker first |
| `pnpm emulator:start`       | Start Firebase emulators in Docker         |
| `pnpm emulator:stop`        | Stop Firebase emulator container           |

## Running Tests

### Unit Tests

```bash
pnpm test --run
```

599+ tests across 21 test files. Coverage report:

```bash
pnpm test:coverage
```

Coverage thresholds are enforced at 80% for lines, functions, branches, and statements on `apps/web/src/lib/` and the kernel helpers.

### E2E Tests

E2E tests run against a production build on port 3001 using the mock backend.

```bash
pnpm test:e2e
```

This builds the app and starts it with `next start`. For quick iteration, start a dev server on that port first (`NEXT_PUBLIC_BACKEND=mock pnpm dev --port 3001`) and Playwright reuses it instead of building. Tests run in Desktop Chrome, with a subset also running on Mobile Chrome (Pixel 5 viewport).

The mock answers every read at once, so a loading state is gone before a test can see it. To slow it down, a spec sets `window.__MOCK_LATENCY_MS__` (with `page.evaluate` or `page.addInitScript`) and every mock db call then waits that long. `e2e/loading-states.spec.ts` uses it to check that no page shows an empty state before its data.

### Firebase Emulator Tests

**Option A: Via Docker (recommended — no Java/Firebase CLI needed)**

```bash
pnpm test:firebase:docker
```

This builds the emulator Docker image (first run only), starts the container, runs the 64 adapter contract tests, and leaves the container running for subsequent runs. Stop it with `pnpm emulator:stop`.

**Option B: Native (requires Java 21+ and Firebase CLI)**

```bash
# Terminal 1
pnpm exec firebase emulators:start --only auth,firestore

# Terminal 2
pnpm test:firebase
```

---

## Project Structure

```
src/
├── app/              # Next.js App Router (16 routes)
│   ├── (auth)/       # Login, register (unauthenticated)
│   └── (app)/        # Pipeline, clients, invoices, cash book, plan, etc.
├── components/       # React components (UI + feature)
├── hooks/            # React hooks (data fetching, auth)
├── lib/
│   ├── backend/      # Backend adapter (mock, firebase)
│   ├── mcp/          # MCP tools and the connector's server
│   └── oauth/        # OAuth 2.1 server for the MCP endpoint
├── stores/           # Zustand stores (settings)
└── types/            # TypeScript types and Zod schemas

e2e/                  # Playwright E2E tests
docs/                 # Project documentation
```

## Switching Backends

To switch backends, change `NEXT_PUBLIC_BACKEND` in `apps/web/.env.local` and restart the dev server. No code changes needed — the adapter pattern handles everything.

```env
# Pick one:
NEXT_PUBLIC_BACKEND=mock       # In-memory, no setup
NEXT_PUBLIC_BACKEND=firebase   # Firestore + Security Rules
```
