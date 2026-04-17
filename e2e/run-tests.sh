#!/bin/bash
set -e

cd "$(dirname "$0")/.."

# Start vite server in background
echo "Starting Vite dev server..."
cd packages/web
pnpm vite --port 5173 --host 127.0.0.1 &>/tmp/vite-test.log &
VITE_PID=$!
cd ../..

# Wait for server to be ready
echo "Waiting for server..."
for i in $(seq 1 15); do
  if curl -s -o /dev/null http://127.0.0.1:5173/; then
    echo "Server is ready!"
    break
  fi
  sleep 1
done

# Run playwright tests
echo "Running tests..."
cd e2e
node_modules/.bin/playwright test specs/session-terminal-interaction.spec.ts
TEST_EXIT=$?

# Cleanup
kill $VITE_PID 2>/dev/null || true
exit $TEST_EXIT
