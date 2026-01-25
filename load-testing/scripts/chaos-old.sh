#!/bin/bash

# ==============================================================================
# CHAOS TEST: Old Architecture - Process Crash During Webhook Delivery
# ==============================================================================
# This test reproduces the blog's scenario:
# "Timeline of a Lost Webhook" - SIGTERM during in-flight webhook request
#
# Expected Result: Webhooks sent during the crash window are LOST
#
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$(dirname "$SCRIPT_DIR")")"

echo "=========================================="
echo "CHAOS TEST: Old Architecture Crash"
echo "=========================================="
echo ""
echo "Scenario: Process crash during webhook delivery"
echo "Expected: Webhook loss during crash window"
echo ""

# Start background job to kill old-api after 30 seconds
(
    sleep 30
    echo "[CHAOS] 30s mark: Killing old-api container"
    "$SCRIPT_DIR/kill-service.sh" "old-api" 5 &
    KILL_PID=$!
) &

# Run the k6 test
echo "Starting load test (5 minutes)..."
cd "$PROJECT_ROOT" || exit 1
docker compose run --rm k6 run test-old.js

echo ""
echo "=========================================="
echo "CHAOS TEST COMPLETE"
echo "=========================================="
echo ""
echo "Analysis:"
echo "- Check merchant-old logs: how many webhooks during crash window?"
echo "- Compare: webhooks_sent vs webhooks_received"
echo "- Expected: Loss during the 5-second crash window"
echo ""
echo "Run: docker compose logs merchant-old | grep 'Webhook received'"
