# Running Alter Ego CRM locally

No cloud account, no SaaS, no data leaving the machine. The app runs against a
Firebase emulator in Docker, which both the browser and the server talk to — so
the UI and the MCP server see the same data.

## Requirements

- Docker
- Node 24 + pnpm

## Start

```bash
pnpm install
pnpm local:start     # emulator, restoring ./.emulator-data if present
pnpm dev:emulator    # the app, on http://localhost:3003
```

Sign-up is closed in the app: production admits one uid (the allowlist,
`isAllowedUser()` in `firestore/base.rules`, and `owner()` in `storage.rules`).
`pnpm local:start` loads the rules with that allowlist open, so locally any
account works. Create one with `pnpm seed:demo`, or in the Auth emulator UI on
http://localhost:4000. To run your own deployment, put your uid in those two
rules and in `apps/web/src/lib/owner-uid.ts`, then `pnpm rules:build`. Stop with:

```bash
pnpm local:stop      # exports data on the way out
```

`pnpm local:logs` tails the emulator. The emulator UI is on http://localhost:4000.

## Invoice files

Not on `pnpm dev:emulator`: `docker-compose.local.yml` does not expose Storage (`docker-compose.yml` publishes port 19199 for it), so attaching an invoice file to a cost or an
invoice fails there. The mock backend (`pnpm dev`) holds invoice files in memory.

## Where your data lives

`./.emulator-data/export` — Firestore documents and the Auth accounts. It is
written when the emulator shuts down and read back when it starts.

**Back that folder up. Deleting it resets the app to empty.**

Two consequences of exporting on shutdown:

- Stop with `pnpm local:stop`, not by killing Docker. The export runs on SIGTERM;
  a `docker kill` loses everything since the last clean stop.
- A crash loses the session's writes. If that matters, stop and start
  periodically — each clean stop is a checkpoint.

## Connecting an MCP client

The same tools the hosted server exposes over HTTP are also available over stdio,
for a client that spawns the server as a subprocess — Claude Desktop, or a local
model that speaks MCP. No OAuth and no tokens: the client already owns the
process, so the process boundary is the trust boundary.

Find your user id in the emulator UI (http://localhost:4000 → Authentication),
then point the client at:

```json
{
  "mcpServers": {
    "alter-ego": {
      "command": "pnpm",
      "args": ["--dir", "/absolute/path/to/alter-ego-crm", "mcp:stdio"],
      "env": {
        "ALTER_EGO_USER_ID": "<your uid from the emulator UI>",
        "NEXT_PUBLIC_BACKEND": "firebase",
        "NEXT_PUBLIC_USE_EMULATOR": "true",
        "NEXT_PUBLIC_FIREBASE_PROJECT_ID": "demo-alter-ego",
        "FIRESTORE_EMULATOR_HOST": "localhost:8080"
      }
    }
  }
}
```

`ALTER_EGO_USER_ID` is required — over stdio there is no request to infer the
user from, and defaulting would mean writing to the wrong user's books. The server
exits immediately with a message rather than starting without it.

Set `NEXT_PUBLIC_DISABLED_MODULES` here too, to leave a module's tools out.

### Remote clients and OAuth scopes

The HTTP endpoint (`/api/mcp`) authenticates with OAuth 2.1 + PKCE and grants two
scopes: **`data:read`** and **`data:write`**. Clients discover them from
`/.well-known/oauth-authorization-server`, so there is nothing to configure.

Creating an API key (`/api/keys`) and approving a remote client
(`/api/oauth/authorize`) call `isOwner` on the emulator too, so for either one your
uid has to be in `apps/web/src/lib/owner-uid.ts`. The UI and the stdio MCP server
work with any local account.

Try it without a client:

```bash
ALTER_EGO_USER_ID=<uid> NEXT_PUBLIC_BACKEND=mock pnpm mcp:stdio
```

then paste a JSON-RPC `initialize` on stdin.

## What this is and is not

The Firebase emulator is a development tool, not a production database. For one
person on one machine it is a reasonable store: real Firestore semantics, the
same security rules the hosted deployment enforces, and a documented export
format you can read without this app. It is not built for concurrent writers,
large datasets, or unattended uptime.

If it outgrows that, the adapter boundary is the seam to replace: implement
`DatabaseAdapter` (`CrmAdapter`, `RentAdapter` and the API keys) against
whatever store you prefer, and add it to `NEXT_PUBLIC_BACKEND` in `apps/web/src/lib/env.ts`.
The shared contract in `apps/web/src/lib/backend/__tests__/adapter-contract.ts` is what a
new backend has to satisfy.

## Why this is separate from the test emulator

`docker-compose.yml` backs the test suite and must start empty on every run.
`docker-compose.local.yml` must not. Same image, different command and a volume.
Running the test suite never touches `./.emulator-data`.
