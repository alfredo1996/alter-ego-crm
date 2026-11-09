#!/usr/bin/env bash
set -euo pipefail

ENV_FILE=".env.local"
BACKEND="${1:-}"

usage() {
  cat <<EOF
Usage: ./scripts/setup-backend.sh <backend>

Backends:
  mock       In-memory backend, no external services needed
  firebase   Local Firebase emulators (requires Java 11+)

Examples:
  ./scripts/setup-backend.sh mock
  ./scripts/setup-backend.sh firebase
EOF
  exit 1
}

check_command() {
  if ! command -v "$1" &>/dev/null; then
    echo "Error: '$1' is not installed."
    echo "$2"
    exit 1
  fi
}

# ── Validate argument ────────────────────────────────────────────────────────

if [[ -z "$BACKEND" ]]; then
  usage
fi

if [[ "$BACKEND" != "mock" && "$BACKEND" != "firebase" ]]; then
  echo "Error: Unknown backend '$BACKEND'"
  echo ""
  usage
fi

# ── Mock ─────────────────────────────────────────────────────────────────────

setup_mock() {
  cat > "$ENV_FILE" <<EOF
NEXT_PUBLIC_BACKEND=mock
EOF

  echo "Wrote $ENV_FILE for mock backend."
  echo ""
  echo "Ready! Run:"
  echo "  pnpm dev"
}

# ── Firebase ─────────────────────────────────────────────────────────────────

setup_firebase() {
  check_command java "Firebase emulators require Java 11+. Install from https://adoptium.net/"

  # Use local firebase-tools from devDependencies
  FIREBASE="pnpm exec firebase"

  echo "Starting Firebase emulators..."
  $FIREBASE emulators:start --only auth,firestore &
  EMULATOR_PID=$!

  # Wait for emulators to be ready
  echo "Waiting for emulators to start..."
  for i in {1..30}; do
    if curl -s http://127.0.0.1:4000 &>/dev/null; then
      break
    fi
    sleep 1
  done

  cat > "$ENV_FILE" <<EOF
NEXT_PUBLIC_BACKEND=firebase
NEXT_PUBLIC_FIREBASE_API_KEY=fake-api-key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=localhost
NEXT_PUBLIC_FIREBASE_PROJECT_ID=demo-alterego
EOF

  echo ""
  echo "Wrote $ENV_FILE for Firebase backend."
  echo ""
  echo "Emulator UI: http://127.0.0.1:4000"
  echo "Emulator PID: $EMULATOR_PID"
  echo ""
  echo "Ready! In another terminal, run:"
  echo "  pnpm dev"
  echo ""
  echo "To stop emulators later:"
  echo "  kill $EMULATOR_PID"

  # Keep script alive so emulators stay running
  wait $EMULATOR_PID
}

# ── Run ──────────────────────────────────────────────────────────────────────

echo "Setting up '$BACKEND' backend..."
echo ""

case "$BACKEND" in
  mock)      setup_mock ;;
  firebase)  setup_firebase ;;
esac
