# Restate Manual Registration Guide

This guide documents the manual steps to register the webhook-consumer service with Restate, in case the automated script fails.

## Prerequisites

1. All containers must be running:
   ```bash
   docker compose up -d
   ```

2. Verify Restate version is 1.5 or higher (required for restate-sdk 0.7.0):
   ```bash
   docker exec restate restate-server --version
   ```

   If version is < 1.5, update `docker-compose.yml`:
   ```yaml
   restate:
     image: docker.io/restatedev/restate:1.5  # Change from 1.0.0
   ```

3. Ensure webhook-consumer is running:
   ```bash
   docker ps --filter "name=webhook-consumer" --format "{{.Names}} {{.Status}}"
   ```

## Step 1: Verify Restate Admin API is Ready

Wait for Restate to be ready:

```bash
# Keep checking until it returns HTTP 200
curl -s http://localhost:9070/services
```

Expected: JSON response with services list (may be empty initially)

## Step 2: Test Discovery Endpoint

Verify webhook-consumer's discovery endpoint is working:

```bash
# Test with HTTP/2 (required by restate-sdk 0.7.0)
curl --http2-prior-knowledge -s \
  -H "Accept: application/vnd.restate.endpointmanifest.v3+json" \
  http://localhost:9080/discover | jq '.'
```

Expected output should include:
```json
{
  "services": [
    {
      "name": "WebhookProcessor",
      "handlers": [
        {
          "name": "process",
          ...
        }
      ]
    }
  ]
}
```

## Step 3: Register Deployment with Restate

Register the webhook-consumer service:

```bash
curl -X POST http://localhost:9070/deployments \
  -H "Content-Type: application/json" \
  -d '{"uri": "http://webhook-consumer:9080"}' | jq '.'
```

Expected output:
```json
{
  "id": "dp_...",
  "services": [
    {
      "name": "WebhookProcessor",
      "handlers": [...]
    }
  ]
}
```

If you get error `[META0003] bad status code: 415`:
- This means Restate version is too old (< 1.4)
- Upgrade to Restate 1.5 and clear old data:
  ```bash
  docker compose down restate
  docker volume rm webhook-demo_restate_data
  docker compose up -d restate
  # Wait 10 seconds, then retry registration
  ```

## Step 4: Create Kafka Subscription

Link the Kafka topic to the Restate service:

```bash
curl -X POST http://localhost:9070/subscriptions \
  -H "Content-Type: application/json" \
  -d '{
    "source": "kafka://local/webhook-events",
    "sink": "service://WebhookProcessor/process",
    "options": {
      "auto.offset.reset": "earliest"
    }
  }' | jq '.'
```

Expected output:
```json
{
  "id": "sub_...",
  "source": "kafka://local/webhook-events",
  "sink": "service://WebhookProcessor/process",
  "options": {
    "auto.offset.reset": "earliest",
    "group.id": "sub_...",
    "client.id": "restate"
  }
}
```

## Step 5: Verify Registration

Check registered services:

```bash
curl -s http://localhost:9070/services | jq '.services[] | {name, revision}'
```

Expected:
```json
{
  "name": "WebhookProcessor",
  "revision": 1
}
```

Check active subscriptions:

```bash
curl -s http://localhost:9070/subscriptions | jq '.subscriptions[] | {id, source, sink, status}'
```

Expected:
```json
{
  "id": "sub_...",
  "source": "kafka://local/webhook-events",
  "sink": "service://WebhookProcessor/process",
  "status": null
}
```

## Step 6: Test End-to-End

Create a test payment:

```bash
curl -X POST http://localhost:3001/payments \
  -H "Content-Type: application/json" \
  -d '{"amount": 1000, "currency": "USD"}'
```

Wait 5 seconds, then check if webhook was delivered:

```bash
curl -s http://localhost:4001/stats | jq '.'
```

Expected:
```json
{
  "total_received": 1,
  "unique_payments": 1,
  "webhooks": [...]
}
```

## Troubleshooting

### Discovery Endpoint Returns HTTP/0.9 Error

The webhook-consumer uses HTTP/2 by default. Use `--http2-prior-knowledge`:

```bash
curl --http2-prior-knowledge http://localhost:9080/discover
```

### Error: "Cannot decode input payload: missing field `id`"

This means Sequin is sending data in wrapped format. You need to add a transform in Sequin UI:

1. Go to Sequin UI at http://localhost:7376
2. Click on your Kafka sink
3. In Transforms section, create function `extract_record`:
   ```elixir
   def transform(action, record, changes, metadata) do
     record
   end
   ```
4. Apply the transform to your sink

See `SEQUIN_SETUP.md` Step 4 for detailed instructions.

### Error: "UnknownTopicOrPartition"

The Kafka topic doesn't exist. Create it:

```bash
docker exec kafka kafka-topics \
  --create \
  --bootstrap-server localhost:9092 \
  --topic webhook-events \
  --partitions 1 \
  --replication-factor 1
```

### Restate Data Mismatch Error

If Restate shows node name mismatch error:

```bash
# Clear Restate data and restart
docker compose down restate
docker volume rm webhook-demo_restate_data
docker compose up -d restate
# Wait 10 seconds, then re-register
```

## Compatibility Matrix

| restate-sdk | Restate Server | Discovery Protocol |
|-------------|----------------|-------------------|
| 0.7.0       | 1.5+          | v3                |
| 0.6.0       | 1.4+          | v3                |
| < 0.6.0     | 1.0+          | v1/v2             |

**Important:** restate-sdk 0.7.0 (used in this project) requires Restate server 1.5 or higher.

## Persistence

Registration data persists in the `restate_data` Docker volume. As long as you don't delete volumes (`docker compose down -v`), registration will survive restarts.

To check if data persists:

```bash
docker compose restart restate
# Wait 10 seconds
curl -s http://localhost:9070/services | jq '.services'
# Should show WebhookProcessor without re-registration
```
