# Local Setup Guide

Complete guide to running the webhook demo locally with Svix Cloud.

## Prerequisites

- Docker Desktop installed and running
- Svix account (free): https://app.svix.com
- Git

## Step 1: Clone Repository

```bash
git clone <repository-url>
cd webhook-demo
```

## Step 2: Get Svix API Token

1. Sign up at https://app.svix.com
2. Navigate to **API Access** in the sidebar
3. Copy your API token (starts with `testsk_` for test environment)

## Step 3: Create Environment File

Create `.env` file in the project root:

```bash
echo "SVIX_AUTH_TOKEN=testsk_your_token_here" > .env
```

Replace `testsk_your_token_here` with your actual Svix API token.

## Step 4: Start All Services

```bash
# Start all services in detached mode
docker compose up -d

# Wait for all services to be healthy (may take 1-2 minutes)
docker compose ps
```

You should see these services running:
- `postgres` - Database
- `zookeeper` - Kafka dependency
- `kafka` - Event streaming
- `sequin` - Change Data Capture
- `restate` - Durable execution
- `new-api` - Payment API
- `data-service` - Payload enrichment
- `svix-caller` - Svix integration service
- `merchant-new` - Mock merchant endpoint

## Step 5: Register Restate Handler

```bash
./scripts/register-restate-handler.sh
```

This script:
1. Registers the `SvixCaller` service with Restate
2. Creates Kafka subscription: `webhook-events` → `SvixCaller.process`

Expected output:
```
✅ Service registered successfully
✅ Kafka subscription created successfully
✅ Handler 'SvixCaller' is registered
```

## Step 6: Create Svix Application

First, get a merchant_id from your database:

```bash
docker compose exec -T postgres psql -U dodo -d dodo_demo \
  -c "SELECT DISTINCT merchant_id FROM payments LIMIT 1;"
```

Example output:
```
              merchant_id
--------------------------------------
 bc1852a0-6e4d-5399-a35a-391ceaf44f80
```

Create Svix application with this merchant_id as the UID:

```bash
curl 'https://api.eu.svix.com/api/v1/app' \
  -H 'Accept: application/json' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_SVIX_TOKEN' \
  -d '{
    "name": "Test Merchant",
    "uid": "bc1852a0-6e4d-5399-a35a-391ceaf44f80"
  }'
```

**Important:** Replace `YOUR_SVIX_TOKEN` with your actual token, and use the exact `merchant_id` from the database as the `uid`.

Expected response:
```json
{
  "uid": "bc1852a0-6e4d-5399-a35a-391ceaf44f80",
  "name": "Test Merchant",
  "id": "app_...",
  "createdAt": "..."
}
```

## Step 7: Create Test Payment

```bash
curl -X POST http://localhost:3001/payments \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 1000,
    "currency": "USD",
    "merchant_id": "bc1852a0-6e4d-5399-a35a-391ceaf44f80"
  }'
```

Use the same `merchant_id` from Step 6.

Expected response:
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "amount": 1000,
  "currency": "USD",
  "status": "succeeded"
}
```

## Step 8: Verify in Svix Dashboard

1. Go to https://dashboard.svix.com
2. Click **Consumer Applications** in the sidebar
3. Find your merchant application (e.g., "Test Merchant")
4. Click **Messages** tab
5. You should see `payment.succeeded` event(s)

## Step 9: Check Logs

Verify each service is working:

```bash
# Should show "Message sent to Svix successfully"
docker compose logs svix-caller --tail 20 | grep "successfully"

# Should show "Payment created atomically"
docker compose logs new-api --tail 20

# Should show Restate processing events
docker compose logs restate --tail 20 | grep "SvixCaller"

# Should show Sequin producing to Kafka
docker compose logs sequin --tail 20 | grep "produced"
```

## Architecture Verification

Your complete flow:

```
✅ Payment API (port 3001)
  ↓
✅ PostgreSQL (port 5432) - Atomic write with trigger
  ↓
✅ Sequin (port 7376) - CDC from WAL
  ↓
✅ Kafka (port 9092) - Event streaming
  ↓
✅ Restate (port 8080) - Durable execution
  ↓
✅ svix-caller (port 9080) - Svix integration
  ↓
✅ Svix Cloud - Webhook delivery
  ↓
✅ Merchant endpoint - Receives webhook
```

## Monitoring

### Restate Dashboard
```bash
open http://localhost:8080/ui
```

### Sequin Metrics
```bash
curl http://localhost:7376/metrics
```

### Service Health
```bash
docker compose ps
```

## Troubleshooting

### Services not starting
```bash
# Check logs
docker compose logs <service-name>

# Restart specific service
docker compose restart <service-name>

# Rebuild and restart
docker compose up -d --build <service-name>
```

### No events in Svix Dashboard
```bash
# Check svix-caller logs for errors
docker compose logs svix-caller | grep -i "error\|failed"

# Verify merchant_id matches Svix application UID
docker compose exec -T postgres psql -U dodo -d dodo_demo \
  -c "SELECT DISTINCT merchant_id FROM payments LIMIT 1;"
```

### Restate not processing events
```bash
# Check if subscription exists
curl http://localhost:9070/subscriptions

# Re-register handler
./scripts/register-restate-handler.sh
```

## Cleanup

Stop all services:
```bash
docker compose down
```

Remove all data (volumes):
```bash
docker compose down -v
```

## Next Steps

- **Test crash recovery:** See README.md "Testing Crash Recovery" section
- **Add webhook endpoints:** See SVIX_SETUP.md for endpoint configuration
- **Explore in-house webhooks:** Checkout branch `inhouse-webhook-no-svix`

## Additional Commands

### Create Multiple Payments
```bash
for i in {1..10}; do
  curl -X POST http://localhost:3001/payments \
    -H "Content-Type: application/json" \
    -d "{\"amount\": $((i * 100)), \"currency\": \"USD\", \"merchant_id\": \"bc1852a0-6e4d-5399-a35a-391ceaf44f80\"}"
  sleep 1
done
```

### Watch Logs in Real-Time
```bash
docker compose logs -f svix-caller
```

### Check Database Events
```bash
docker compose exec -T postgres psql -U dodo -d dodo_demo \
  -c "SELECT id, event_type, merchant_id, created_at FROM domain_events ORDER BY created_at DESC LIMIT 10;"
```

---

**Setup complete!** Your reliable webhook infrastructure is now running locally.
