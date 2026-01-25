#!/bin/bash

# ==============================================================================
# CHAOS TEST: New Architecture - Consumer Crash with Journal Recovery
# ==============================================================================
# This test reproduces the same failure as chaos-old.sh but on new architecture:
# "Timeline of a Lost Webhook" - Consumer crashes during webhook processing
#
# Expected Result: NO webhook loss - Kafka buffers, Restate journal recovers
#
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$(dirname "$SCRIPT_DIR")")"

echo "=========================================="
echo "CHAOS TEST: New Architecture Crash"
echo "=========================================="
echo ""
echo "Scenario: Consumer crash during webhook processing"
echo "Expected: ZERO webhook loss (Kafka + Restate durability)"
echo ""

# Start background job to kill webhook-consumer after 30 seconds
(
    sleep 30
    echo "[CHAOS] 30s mark: Killing webhook-consumer container"
    "$SCRIPT_DIR/kill-service.sh" "webhook-consumer" 5 &
    KILL_PID=$!
) &

# Run the k6 test
echo "Starting load test (5 minutes)..."
cd "$PROJECT_ROOT" || exit 1
docker compose run --rm k6 run test-new.js

echo ""
echo "=========================================="
echo "CHAOS TEST COMPLETE"
echo "=========================================="
echo ""
echo "Analysis:"
echo "- Check webhook-consumer logs: recovers from crash?"
echo "- Check merchant-new logs: all webhooks eventually delivered?"
echo "- Expected: 0% loss (durable recovery from journal)"
echo ""
echo "Run: docker compose logs webhook-consumer | grep -E '(Received event|Event processed|Webhook delivered)'"
echo "Run: docker compose logs merchant-new | grep 'Webhook received' | wc -l"
