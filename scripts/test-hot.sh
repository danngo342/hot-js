#!/usr/bin/env bash
set -euo pipefail

GREEN="\033[0;32m"
RESET="\033[0m"

echo -e "${GREEN}Running hot.js smoke test...${RESET}"

# CLI entry point
HOT_CLI="./bin/hot.js"

if [ ! -f "$HOT_CLI" ]; then
  echo "Error: CLI entry point not found at $HOT_CLI"
  exit 1
fi

echo "Using CLI: $HOT_CLI"

# Create temp directory
TEST_DIR="$(mktemp -d)"
echo "Using temp directory: $TEST_DIR"

# Create test file
cat > "$TEST_DIR/app.js" <<'EOF'
console.log("initial");
EOF

# Start hot.js
node "$HOT_CLI" "$TEST_DIR/app.js" > "$TEST_DIR/output.log" 2>&1 &
HOT_PID=$!

sleep 1

# Trigger restart
echo "// change" >> "$TEST_DIR/app.js"

sleep 1

# Kill process if still alive
if kill -0 $HOT_PID 2>/dev/null; then
  kill $HOT_PID
fi

OUTPUT=$(cat "$TEST_DIR/output.log")

echo "---- hot.js output ----"
echo "$OUTPUT"
echo "------------------------"

# Assertions
echo "$OUTPUT" | grep -q "initial" && echo -e "${GREEN}✓ child process executed${RESET}"
echo "$OUTPUT" | grep -q "restart" && echo -e "${GREEN}✓ restart detected${RESET}"
echo "$OUTPUT" | grep -q "file-change" && echo -e "${GREEN}✓ restart reason: file-change${RESET}"

echo -e "${GREEN}Smoke test passed.${RESET}"

