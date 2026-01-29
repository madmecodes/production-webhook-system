# Svix Setup Guide

This guide walks you through setting up Svix Cloud to receive webhook events from our demo.

## Prerequisites

- Svix account created at https://app.svix.com
- API key created and added to `.env` file

## Architecture Overview

```
Payment → PostgreSQL → Sequin → Kafka → Restate → svix-caller
                                                       ↓
                                                   Svix Cloud
                                                       ↓
                                                   Merchant Endpoint
```

**Key difference from webhook-consumer:**
- `webhook-consumer` made HTTP POST directly to merchant
- `svix-caller` sends event to Svix API, Svix handles delivery

## Manual Setup Steps

### Step 1: Create Consumer Application

1. Go to **Svix Dashboard** → **Consumer Applications**
2. Click **"+ Application"**
3. Fill in:
   - **Name**: `Merchant New (Demo)` or any name
   - **UID**: `merchant-new` (important - must match code)
4. Click **"Create"**

**Why UID matters:** The `svix-caller` code uses `merchant_id` from the database as the Svix application ID. In our demo, `merchant_id = "merchant-new"`.

### Step 2: Add Webhook Endpoint

**Important Limitation:** Svix Cloud cannot deliver webhooks to `localhost` or local Docker containers.

**Options:**

#### Option A: Use ngrok (Recommended for Local Testing)

1. Install ngrok: https://ngrok.com/download
2. Start ngrok tunnel:
   ```bash
   ngrok http 4001
   ```
3. Copy the public URL (e.g., `https://abc123.ngrok-free.app`)
4. In Svix Dashboard:
   - Go to your application → **Endpoints** tab
   - Click **"+ Endpoint"**
   - URL: `https://abc123.ngrok-free.app/webhooks`
   - Click **"Create"**

#### Option B: Use Svix Play (Debug Without Real Delivery)

1. Go to https://play.svix.com
2. Get a test endpoint URL
3. Add that URL as an endpoint in Svix

#### Option C: Skip Endpoint (Just Test Svix API Call)

- You can test without adding an endpoint
- Events will appear in Svix dashboard
- Delivery will fail (no endpoint configured)
- But you'll see that `svix-caller` successfully sent to Svix

### Step 3: Configure Event Types (Optional)

Svix will accept any event type by default, but you can pre-configure them:

1. Go to **Event Types**
2. Click **"+ Event Type"**
3. Add: `payment.succeeded`

## Testing the Integration

### 1. Start Services

```bash
# Build and start svix-caller
docker compose up -d --build svix-caller

# Check logs
docker compose logs -f svix-caller
```

### 2. Register with Restate

```bash
./scripts/register-restate-handler.sh
```

This registers `SvixCaller` service with Restate.

### 3. Create a Test Payment

```bash
curl -X POST http://localhost:3001/payments \
  -H "Content-Type: application/json" \
  -d '{"amount": 1000, "currency": "USD", "merchant_id": "merchant-new"}'
```

### 4. Verify in Svix Dashboard

1. Go to **Consumer Applications** → **merchant-new**
2. Click **"Messages"** tab
3. You should see the `payment.succeeded` event

**What you'll see:**
- Event ID
- Event Type: `payment.succeeded`
- Payload with payment data
- Delivery attempts (if endpoint configured)
- Delivery status

### 5. Check Logs

```bash
# svix-caller logs
docker compose logs svix-caller

# Should see:
# "Sending message to Svix for application: merchant-new"
# "Message sent to Svix successfully"
```

## Troubleshooting

### Error: "Application not found"

**Problem:** Svix application UID doesn't match `merchant_id` in database

**Solution:**
- Check application UID in Svix dashboard
- Must be: `merchant-new`
- Or update database: `UPDATE payments SET merchant_id = 'your-uid';`

### Error: "Unauthorized"

**Problem:** Invalid Svix API token

**Solution:**
- Verify token in `.env` file
- Check token is correct in Svix dashboard (API Access page)
- Rebuild svix-caller: `docker compose up -d --build svix-caller`

### Endpoint Shows "Failing"

**Problem:** Normal if using localhost URL - Svix Cloud can't reach it

**Solution:**
- Use ngrok (see Option A above)
- Or just verify message appears in Svix dashboard (delivery failing is expected)

## Svix Dashboard Features

### Messages View
- See all events sent to Svix
- Click on message to see payload
- View delivery attempts and responses

### Endpoints View
- Manage webhook URLs
- See delivery success rates
- Configure retry settings

### Event Types View
- Document your event schemas
- Set up transformations

## Next Steps

Once Svix integration is working, you can:

1. **Test crash recovery:**
   ```bash
   ./scripts/run-tests.sh crash
   ```
   Even if `svix-caller` crashes, Restate ensures events reach Svix.

2. **View Svix's retry logic:**
   - Stop your endpoint temporarily
   - Send a payment
   - Watch Svix automatically retry in the dashboard

3. **Explore Application Portal:**
   - Generate a customer portal link
   - See what your merchants would see

## Comparison: webhook-consumer vs svix-caller

| Feature | webhook-consumer | svix-caller |
|---------|------------------|-------------|
| **HTTP Delivery** | We implement | Svix handles |
| **Retries** | Via Restate | Svix + Restate |
| **Webhook Signing** | Not implemented | Svix automatic |
| **Dashboard** | Our logs | Svix dashboard |
| **Merchant Portal** | None | Svix provides |
| **Cost** | Free | Paid (or free tier) |

## Architecture Docs

See `ARCHITECTURE.md` for complete system architecture explanation.
