#!/bin/bash

# ==============================================================================
# Restate Handler Registration Script
# ==============================================================================
# Registers the webhook-consumer service with Restate and creates a Kafka
# subscription that forwards webhook-events to the handler.
#
# Usage: ./scripts/register-restate-handler.sh
# ==============================================================================

set -e

RESTATE_ADMIN="http://localhost:9070"
WEBHOOK_CONSUMER_URL="http://webhook-consumer:9080"
KAFKA_CLUSTER="local"
KAFKA_TOPIC="webhook-events"
HANDLER_SERVICE="WebhookProcessor"
HANDLER_METHOD="process"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Restate Handler Registration"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Wait for Restate Admin API to be ready
echo ""
echo "⏳ Waiting for Restate Admin API to be ready..."
max_retries=30
retry=0

while [ $retry -lt $max_retries ]; do
    if curl --http1.1 -s "$RESTATE_ADMIN/services" >/dev/null 2>&1; then
        echo "✅ Restate Admin API is ready"
        break
    fi
    retry=$((retry + 1))
    echo "  (attempt $retry/$max_retries)"
    sleep 2
done

if [ $retry -eq $max_retries ]; then
    echo "❌ Failed: Restate Admin API is not responding"
    exit 1
fi

# Check if webhook-consumer container is running
echo ""
echo "⏳ Checking webhook-consumer container status..."

if docker ps --filter "name=webhook-consumer" --filter "status=running" --format "{{.Names}}" | grep -q webhook-consumer; then
    echo "✅ webhook-consumer container is running"
else
    echo "❌ webhook-consumer container is not running"
    echo "Please start it with: docker compose up -d webhook-consumer"
    exit 1
fi

# Register the webhook-consumer service with Restate
echo ""
echo "📝 Registering webhook-consumer service with Restate..."

REGISTER_RESPONSE=$(curl --http1.1 -s -X POST "$RESTATE_ADMIN/deployments" \
    -H "Content-Type: application/json" \
    -d "{\"uri\": \"$WEBHOOK_CONSUMER_URL\"}")

echo "Response: $REGISTER_RESPONSE"

# Check if registration was successful
if echo "$REGISTER_RESPONSE" | grep -q '"services"' || echo "$REGISTER_RESPONSE" | grep -q 'webhook'; then
    echo "✅ Service registered successfully"
else
    echo "⚠️  Service registration response received (may already be registered)"
fi

# Create Kafka subscription
echo ""
echo "🔗 Creating Kafka subscription..."

SUBSCRIPTION_RESPONSE=$(curl --http1.1 -s -X POST "$RESTATE_ADMIN/subscriptions" \
    -H "Content-Type: application/json" \
    -d "{
        \"source\": \"kafka://$KAFKA_CLUSTER/$KAFKA_TOPIC\",
        \"sink\": \"service://$HANDLER_SERVICE/$HANDLER_METHOD\",
        \"options\": {
            \"auto.offset.reset\": \"earliest\"
        }
    }")

echo "Response: $SUBSCRIPTION_RESPONSE"

# Check if subscription was created
if echo "$SUBSCRIPTION_RESPONSE" | grep -q 'kafka://'; then
    echo "✅ Kafka subscription created successfully"
elif echo "$SUBSCRIPTION_RESPONSE" | grep -q 'already exists\|Subscription'; then
    echo "✅ Kafka subscription exists (may be already created)"
else
    echo "⚠️  Subscription creation response received"
fi

# Verify handler is registered
echo ""
echo "🔍 Verifying handler registration..."

SERVICES=$(curl --http1.1 -s "$RESTATE_ADMIN/services")
if echo "$SERVICES" | grep -q 'WebhookProcessor'; then
    echo "✅ Handler 'WebhookProcessor' is registered"
else
    echo "⚠️  Handler registration verification inconclusive"
fi

# List active subscriptions
echo ""
echo "📋 Active subscriptions:"
curl --http1.1 -s "$RESTATE_ADMIN/subscriptions" | jq '.subscriptions[] | {source: .source, sink: .sink, status: .status}' 2>/dev/null || echo "  (could not fetch subscriptions)"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Registration complete!"
echo ""
echo "Next steps:"
echo "  1. Create a payment: curl -X POST http://localhost:3001/payments"
echo "  2. Check merchant received webhook: curl http://localhost:4001/stats"
echo "  3. View Restate metrics: http://localhost:8080/ui"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
