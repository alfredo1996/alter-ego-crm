---
name: test
description: Run the Alter Ego test gate for what changed, against the active base branch, with the gotchas that make local runs lie.
model: haiku
disable-model-invocation: true
allowed-tools: Bash(pnpm *), Bash(git *), Bash(docker *), Bash(curl *), Bash(lsof *), Bash(sed *), Bash(cat *)
---

# Test — Alter Ego

## State

- Branch: !`git branch --show-current`
- Base (empty means no open release branch: ask the owner, never use `main`): !`T=$(git ls-remote --tags origin | sed 's|.*refs/tags/||'); git ls-remote --heads origin 'release/*' | sed 's|.*refs/heads/||' | while read -r b; do v=${b#release/}; [ "$(echo "$v" | tr -cd . | wc -c)" -lt 2 ] && v=$v.0; echo "$T" | grep -qx "v$v" || echo "$b"; done | sort -V | tail -1`

## 1. What changed

```bash
BASE=$(T=$(git ls-remote --tags origin | sed 's|.*refs/tags/||'); git ls-remote --heads origin 'release/*' | sed 's|.*refs/heads/||' | while read -r b; do v=${b#release/}; [ "$(echo "$v" | tr -cd . | wc -c)" -lt 2 ] && v=$v.0; echo "$T" | grep -qx "v$v" || echo "$b"; done | sort -V | tail -1)  # empty: ask the owner, never main
git fetch -q origin "$BASE"
git diff --name-only "origin/$BASE...HEAD"
```

## 2. Before the first run in a fresh worktree

Run `pnpm install --frozen-lockfile`, then `pnpm --filter @alter-ego/web exec fumadocs-mdx`. It writes the gitignored `.source/`; without it `tsc` and the tests that import the docs fail. Never symlink `node_modules` into a worktree.

## 3. Run, by what changed

| Changed                                                                                                  | Run                                                                                                                                                                                      |
| -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| anything under `apps/web/src/`                                                                           | the unit gate, below, and `pnpm typecheck`                                                                                                                                               |
| `packages/` (`kernel`, `ui`)                                                                             | the unit gate (their tests and boundary tests run with the app's) and `pnpm typecheck`; E2E for `packages/ui`                                                                            |
| `apps/web/src/lib`, `apps/web/src/types`, the MCP layer                                                  | the same gate: `adapter-boundary` and `firestore-rules-build` are in it                                                                                                                  |
| `apps/web/src/lib/backend/`, `apps/web/src/lib/mcp/`, `apps/web/src/lib/oauth/`, `firestore/`, the rules | the emulator suite, below. CI's `firebase-emulator.yml` lists the full set of paths                                                                                                      |
| `firestore/*.rules`                                                                                      | `pnpm rules:build`; `firestore.rules` changes with its fragment, never alone                                                                                                             |
| UI (`apps/web/src/app`, `apps/web/src/components`, `apps/web/src/hooks`)                                 | the affected E2E spec, below; `pnpm shots` before and after for a visual change                                                                                                          |
| `content/docs/` or `docs-site/`                                                                          | `pnpm -C docs-site build`                                                                                                                                                                |
| `.claude/` only                                                                                          | no code gate: `pnpm lint` ignores `.claude/**` and Vitest only reads `apps/web/src/` and `packages/`. `bash .claude/hooks/__tests__/check-branch.test.sh` when `check-branch.sh` changed |

**Unit gate: one run.** `NEXT_PUBLIC_DISABLED_MODULES` is read at load; the registry and nav tests re-import with a module list of their own.

```bash
pnpm test --run 2>&1 | tail -15
```

- `pnpm test` alone is watch mode: always `--run`. One file: `pnpm test --run <path>`.
- Coverage thresholds are enforced once: `pnpm test:coverage`.

### Emulator suite

The suite reads its hosts from `FIRESTORE_EMULATOR_HOST`, `FIREBASE_AUTH_EMULATOR_HOST` and `FIREBASE_STORAGE_EMULATOR_HOST` (defaults `127.0.0.1:8080`, `:9099` and `:19199`, one reader: `apps/web/src/lib/backend/__tests__/emulator-hosts.ts`), and its global setup wipes the emulators it connects to (Storage objects included), but refuses any emulator that already holds a Firestore document, an Auth account or a Storage object (a crashed run leaves some: `docker rm -f` the container and start it fresh). Set all three: an unset Storage host means 19199, which may be someone else's. Another container may hold 8080 and 9099: never reuse it. Run your own, named, on alternate host ports, and point the suite at it with the env vars. No file is edited:

```bash
FS=18080; AU=19099; ST=19299; NAME=ae-emu-$FS   # free ports: `lsof -i tcp:$FS -i tcp:$AU -i tcp:$ST` prints nothing
docker run -d --name "$NAME" -p $FS:8080 -p $AU:9099 -p $ST:19199 \
  -v "$PWD/firestore.rules:/app/firestore.rules:ro" \
  -v "$PWD/firestore.indexes.json:/app/firestore.indexes.json:ro" \
  -v "$PWD/storage.rules:/app/storage.rules:ro" \
  alter-ego-crm-firebase-emulator:latest
curl -sf --retry 30 --retry-delay 2 --retry-connrefused -o /dev/null "http://localhost:$FS/"

FIRESTORE_EMULATOR_HOST=127.0.0.1:$FS FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:$AU FIREBASE_STORAGE_EMULATOR_HOST=127.0.0.1:$ST pnpm test:firebase 2>&1 | tail -30
# on 18080/19099/19299 exactly, `pnpm test:firebase:alt` is the same
docker rm -f "$NAME"
```

- If the image is missing, or predates Storage (the `:latest` tag must include it: a container from an older image has no Storage and the suite fails at setup): `docker build -t alter-ego-crm-firebase-emulator:latest -f docker/firebase-emulator/Dockerfile .`.
- After `pnpm rules:build`, recreate the container: a single-file bind mount may not pick up the new file.
- Remove only the container you created, by name. Never `docker rm` in bulk, never `docker system prune`: this machine hosts long-lived containers.

### E2E

`apps/web/playwright.config.ts` pins port 3001 and a server on it is reused, so a second session would test the wrong build. Use a throwaway config outside the repo (a file inside it would be linted and type-checked), on a free port of 3400 or above. It runs `pnpm build && pnpm start --port <port>` with `NEXT_PUBLIC_BACKEND=mock`, because `NEXT_PUBLIC_*` is inlined at build time and the backend must be chosen there.

```bash
W=$PWD; PORT=3400   # a free port: `lsof -i tcp:$PORT` prints nothing
CFG=<scratchpad directory>/pw-$PORT.config.ts
cat > "$CFG" <<EOT
import base from "$W/apps/web/playwright.config.ts"
export default {
  ...base,
  testDir: "$W/apps/web/e2e",
  outputDir: "$W/apps/web/test-results",
  retries: 0,
  reporter: "dot",
  use: { ...base.use, baseURL: "http://localhost:$PORT" },
  webServer: {
    command: "pnpm build && pnpm start --port $PORT",
    cwd: "$W/apps/web",
    url: "http://localhost:$PORT",
    env: { NEXT_PUBLIC_BACKEND: "mock" },
    timeout: 300_000,
    reuseExistingServer: false,
  },
}
EOT
pnpm --filter @alter-ego/web exec playwright test -c "$CFG" --project=chromium apps/web/e2e/<spec>.spec.ts 2>&1 | tail -25
```

- **One invocation per project** (`chromium`, `mobile-chrome`, `auth`; `apps/web/playwright.config.ts` says which specs each one runs). Locally a project's teardown can hang after its results are in. When the summary line has printed and the process lives on, stop the task by its task id and kill the server by the exact PID that listens on your port: `lsof -ti tcp:$PORT -sTCP:LISTEN`. Never `pkill -f`: the tools' own shells match the pattern.
- Run with `--retries=0` (the config does): Playwright retries once locally and twice on CI, so a test that fails and passes on retry still leaves a run green. A failure is a bug in the test or the app; diagnose it from the artifacts of the run you have, never re-run until it goes green.
- The whole suite, per project, when the change is shared (`packages/ui/src/ui`, `packages/ui/src/page`, the app shell, `globals.css`) or when CI cannot run.
- After a Playwright version bump, run `pnpm --filter @alter-ego/web exec playwright install chromium` once.

### Screenshots

`pnpm shots` writes every page and tab, desktop 1440x900 and phone 390x844, light and dark, against a mock production build. Shoot before your first edit and after the last, with the same pages. `pnpm start` never returns, so run it as a background task (`run_in_background`) and stop it by its task id when the shots are written. Rebuild before the `after-` shots: the server serves the build it started from.

```bash
NEXT_PUBLIC_BACKEND=mock pnpm build && pnpm start --port $PORT   # background task
pnpm shots --base http://localhost:$PORT --out <dir> --prefix before- /cash-book /clients
```

## 4. Always

```bash
pnpm lint
pnpm typecheck
```

- `pnpm lint` runs with `--max-warnings 0`: a warning fails it.
- `pnpm build` before a PR that touches `apps/web/src/` when non-test source changed: `NEXT_PUBLIC_BACKEND=mock pnpm build`.

## 5. Report

Report which suites ran and their pass and fail counts, per E2E project. Name every step you skipped and why. Then list any failures to fix.

- `$ARGUMENTS` contains "coverage": also run `pnpm test:coverage`.
- `$ARGUMENTS` contains "all": run every suite regardless of changes: the unit suite, the emulator suite and the whole E2E suite.
