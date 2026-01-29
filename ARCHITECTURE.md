# Webhook Architecture: Building Reliable Webhooks Without Svix

This project demonstrates the architecture described in [Dodo Payments' blog post](https://medium.com/dodopayments/building-webhooks-that-never-fail-our-journey-to-99-99-delivery-reliability-f69ed069cf00) "Building Webhooks That Never Fail" - but with an **in-house webhook delivery system** instead of using Svix.

## Architecture Comparison

### Dodo Payments (Production)
```
PostgreSQL → Sequin → Kafka → Restate → Data Service → Svix → Merchant
                                                         ^^^^
                                                    Managed service
```

### Our Implementation (This Demo)
```
PostgreSQL → Sequin → Kafka → Restate → Data Service → webhook-consumer → Merchant
                                                         ^^^^^^^^^^^^^^^^
                                                      In-house HTTP delivery
```

**Key Difference:** We replaced Svix (a managed webhook service) with `webhook-consumer`, a Rust service that handles HTTP delivery directly. This demonstrates that Restate's durable execution guarantees are sufficient for building reliable webhooks in-house.

## Complete Architecture

```
┌────────────────────────────────────────────────────────────────┐
│                      POSTGRESQL                                │
│                                                                │
│   payments table                    domain_events table        │
│   ┌─────────────┐                  ┌─────────────────────┐     │
│   │ id          │   DB TRIGGER     │ id                  │     │
│   │ amount      │   ────────────►  │ event_type          │     │
│   │ status      │   (atomic)       │ object_id           │     │
│   │ merchant_id │                  │ merchant_id         │     │
│   └─────────────┘                  └─────────────────────┘     │
└────────────────────────────────────────────────────────────────┘
                                              │
                        PostgreSQL WAL (Write-Ahead Log)
                                              │
                                              ▼
                                    ┌─────────────────┐
                                    │     Sequin      │
                                    │   (CDC Tool)    │
                                    │                 │
                                    │ Reads WAL       │
                                    │ Pushes to Kafka │
                                    └─────────────────┘
                                              │
                                              ▼
                                    ┌─────────────────┐
                                    │     Kafka       │
                                    │                 │
                                    │ Topic:          │
                                    │ webhook-events  │
                                    └─────────────────┘
                                              │
                                              ▼
                                    ┌─────────────────┐
                                    │    Restate      │
                                    │                 │
                                    │ Durable         │
                                    │ Execution       │
                                    └─────────────────┘
                                              │
                                              ▼
                                    ┌─────────────────┐
                                    │  Data Service   │
                                    │                 │
                                    │ Fetch payment   │
                                    │ payload         │
                                    └─────────────────┘
                                              │
                                              ▼
                                    ┌─────────────────┐
                                    │ webhook-        │
                                    │ consumer        │
                                    │                 │
                                    │ HTTP POST       │
                                    └─────────────────┘
                                              │
                                              ▼
                                    ┌─────────────────┐
                                    │    Merchant     │
                                    │    Endpoint     │
                                    │                 │
                                    │ POST /webhooks  │
                                    └─────────────────┘
```

## Real-World Example: How It Works End-to-End

Let's walk through a concrete example to see how the architecture works in practice.

### Scenario: Joe's T-Shirt Shop

Joe runs an online t-shirt store and uses a payment processor (like our demo) to handle payments. Let's follow what happens when a customer buys a $50 t-shirt:

### Step 1: Customer Makes Purchase
```
Customer                     Joe's Website              Payment API (new-api)
   │                              │                           │
   │─── clicks "Buy Now" ────────►│                           │
   │                              │                           │
   │                              │─── POST /payments ───────►│
   │                              │    {amount: 5000,         │
   │                              │     currency: "USD"}      │
   │                              │                           │
   │                              │                           │◄── Charge card
   │                              │                           │
   │                              │◄────── 200 OK ────────────│
   │◄── "Payment successful!" ────│                           │
```

**What happens:**
- Customer's card is charged
- `new-api` saves payment to PostgreSQL with `status='succeeded'`
- Transaction commits atomically

### Step 2: Event Captured Automatically
```
PostgreSQL                                 domain_events table
    │                                            │
    │── UPDATE payments ─────►  TRIGGER ───────►│ INSERT domain_event
    │   SET status='succeeded'  (automatic)     │ {
    │                                            │   event_type: "payment.succeeded",
    │                                            │   object_id: "pay_12345",
    │                                            │   merchant_id: "joe_tshirts"
    │                                            │ }
    │                                            │
    └─────────────── COMMIT (atomic) ───────────┘
         Both succeed together or both fail
```

**What happens:**
- PostgreSQL trigger automatically creates domain event
- Event and payment update commit in same transaction
- Zero chance of payment succeeding without event being created

### Step 3: Event Streamed Through Pipeline
```
PostgreSQL WAL     Sequin           Kafka              Restate
    │                │                │                   │
    │─── writes ────►│                │                   │
    │   event to     │                │                   │
    │   WAL          │                │                   │
    │                │                │                   │
    │                │─── publish ───►│                   │
    │                │   (<50ms)      │                   │
    │                │                │                   │
    │                │                │─── subscribe ────►│
    │                │                │   (~5ms)          │
    │                │                │                   │
    │                │                │                   │◄── journals
    │                │                │                   │    invocation
```

**What happens:**
- Sequin reads event from WAL in real-time (~50ms latency)
- Publishes to Kafka topic `webhook-events`
- Restate consumes from Kafka
- Restate **journals** the invocation (critical for durability!)

### Step 4: Webhook Delivery
```
Restate           Data Service      webhook-consumer     Joe's Server
   │                   │                    │               (merchant)
   │                   │                    │                   │
   │─── call ─────────►│                    │                   │
   │   "get payment    │                    │                   │
   │    pay_12345"     │                    │                   │
   │                   │                    │                   │
   │◄── return ────────│                    │                   │
   │   {amount: 5000,  │                    │                   │
   │    status: ...}   │                    │                   │
   │                   │                    │                   │
   │─── call ──────────┴───────────────────►│                   │
   │   "deliver webhook"                    │                   │
   │                                        │                   │
   │                                        │─── POST ─────────►│
   │                                        │   /webhooks       │
   │                                        │   {               │
   │                                        │     event_id: "evt_...",
   │                                        │     type: "payment.succeeded",
   │                                        │     data: {...}   │
   │                                        │   }               │
   │                                        │                   │
   │                                        │◄──── 200 OK ──────│
   │◄─────────────────────────────────────┘                   │
```

**What happens:**
- Restate calls data-service to get fresh payment data
- Restate calls webhook-consumer to deliver
- webhook-consumer makes HTTPS POST to `https://joestshirts.com/webhooks`
- Joe's server receives notification that payment succeeded

**Note:** In production Dodo Payments, this step uses **Svix** instead of webhook-consumer. Svix handles the HTTP delivery, retries, and provides a webhook dashboard for merchants. Our demo shows you can achieve the same reliability without Svix by using Restate's durable execution.

### Step 5: Merchant Takes Action
```
Joe's Server (receives webhook)
   │
   │── Verify webhook signature (optional in our demo)
   │
   │── Parse payload: payment_id = "pay_12345", status = "succeeded"
   │
   ├──► Update database: Mark order #7890 as "paid"
   │
   ├──► Send confirmation email to customer
   │
   ├──► Trigger fulfillment: Print t-shirt, ship to customer
   │
   └──► Return HTTP 200 OK (acknowledges webhook received)
```

**What happens:**
- Joe's backend marks the order as paid
- Sends confirmation email: "Your payment was successful!"
- Starts fulfillment process (print and ship t-shirt)
- Returns 200 OK to acknowledge webhook

### Complete Timeline

```
Time    Component              Action
──────  ──────────────────────────────────────────────────────────
0ms     Customer              Clicks "Buy Now"
10ms    new-api               Saves payment to PostgreSQL
10ms    PostgreSQL Trigger    Creates domain_event (atomic)
60ms    Sequin                Reads event from WAL, publishes to Kafka
65ms    Kafka                 Routes message to Restate subscription
70ms    Restate               Journals invocation, calls data-service
150ms   Data Service          Fetches payment payload
200ms   webhook-consumer      Makes HTTPS POST to Joe's server
350ms   Joe's Server          Receives webhook, marks order paid
360ms   Joe's Server          Returns 200 OK
──────  ──────────────────────────────────────────────────────────
Total:  ~360ms from payment to webhook delivered
```

### What If webhook-consumer Crashes?

This is where Restate's magic happens:

```
Scenario: webhook-consumer crashes during Step 4

Time    Event
──────  ───────────────────────────────────────────────────────────
200ms   webhook-consumer starts HTTP POST to Joe's server
250ms   🔥 webhook-consumer CRASHES (pod killed, OOM, etc.)

        Traditional approach: Webhook lost forever ❌

        Our approach with Restate:
250ms   Restate detects webhook-consumer is down
        Restate's journal still contains:
        - Event data
        - Generated idempotency key
        - "Pending: HTTP call to Joe's server"

260ms   Kubernetes restarts webhook-consumer

270ms   Restate REPLAYS from journal:
        - Uses SAME idempotency key (not new!)
        - Resumes from "Pending: HTTP call"

280ms   webhook-consumer makes HTTP POST (retry)

430ms   Joe's server receives webhook ✅
──────  ───────────────────────────────────────────────────────────
Result: Webhook delivered successfully, zero data loss
```

**Key point:** The journal ensures the webhook will be delivered even if the process crashes. The idempotency key is stable across crashes, so if Joe's server already processed it, the duplicate is safely ignored.

This is exactly what our crash test demonstrates: 100 payments, webhook-consumer killed mid-processing, 100 webhooks delivered after recovery.

## Component Breakdown

### 1. PostgreSQL + Triggers
**Purpose:** Atomic event capture
**Why:** Ensures if a payment commits, its domain event is created in the same transaction. No race conditions.

```sql
CREATE TRIGGER on_payment_status_change
AFTER UPDATE ON payments
FOR EACH ROW
EXECUTE FUNCTION create_domain_event();
```

**Guarantee:** Event exists if and only if payment committed.

### 2. Sequin (Change Data Capture)
**Purpose:** Stream database changes to Kafka
**Why:** Replaces error-prone polling with real-time WAL replication.

**Benefits:**
- Sub-millisecond latency (faster than polling)
- Exactly-once delivery semantics
- Preserves transaction order
- Zero load on database

**Guarantee:** Every committed event reaches Kafka in order.

### 3. Kafka
**Purpose:** Durable message buffer
**Why:** Decouples event capture from processing.

**Benefits:**
- Buffers events when downstream is slow
- Allows replay from any offset (7-day retention)
- Enables multiple consumer groups
- Survives Restate downtime

**Guarantee:** Events buffered durably, replayable for debugging.

### 4. Restate (Durable Execution)
**Purpose:** Ensure webhook processing completes even across crashes
**Why:** Traditional retry logic dies with the process. Restate journals execution state.

**How it works:**
- Journals every function call and result
- If process crashes, replays from journal
- Retries are durable (not in-memory)
- Same idempotency key used across retries

**Guarantee:** Processing will complete, even if webhook-consumer crashes mid-execution.

### 5. Data Service
**Purpose:** Enrich events with current payment data
**Why:** Merchants want current state, not historical state. If a payment is refunded between event creation and delivery, the webhook should reflect that.

**Endpoints:**
- `GET /payload/{payment_id}` - Fetch fresh payment data

**Guarantee:** Webhook payload reflects database state at delivery time.

### 6. webhook-consumer (Our Svix Alternative)
**Purpose:** Last-mile HTTP delivery to merchant endpoints
**Why:** Demonstrates in-house delivery is viable with Restate's guarantees.

**What it does:**
- Receives events from Restate via HTTP/2
- Fetches enriched payload from data-service
- Makes HTTPS POST to merchant webhook endpoint
- Returns success/failure to Restate (which handles retries)

**Trade-offs vs Svix:**
- ✅ No external costs
- ✅ Full control over delivery logic
- ✅ Data stays in-house
- ❌ Must maintain HTTP client code
- ❌ No merchant-facing webhook portal
- ❌ No automatic signature verification (could add with Svix libraries)

**Guarantee:** With Restate, retries are durable and idempotent.

### 7. Merchant Simulator
**Purpose:** Simulates merchant webhook endpoints for testing
**Why:** Demonstrates end-to-end flow and crash recovery.

**Features:**
- Tracks received webhooks
- `/stats` endpoint shows delivery counts
- Used in crash recovery tests

## Why This Architecture Never Loses Webhooks

Each layer provides a specific guarantee:

1. **PostgreSQL Trigger** → "If payment committed, event exists"
2. **Sequin** → "Every event reaches Kafka, in order"
3. **Kafka** → "Events buffered durably, replayable"
4. **Restate** → "Processing completes across crashes"
5. **webhook-consumer** → "HTTP delivery retried with durable state"

**Combined result:** Events flow from database to merchant with 99.99%+ reliability and sub-500ms latency.

## Demonstrated Reliability

Our crash test results:

**OLD Architecture (in-memory webhooks):**
- Created: 100 payments
- Delivered: 99 webhooks
- **Lost: 1 webhook (1% loss)**

**NEW Architecture (with Restate):**
- Created: 100 payments
- Delivered: 100 webhooks
- **Lost: 0 webhooks (0% loss)**

When `webhook-consumer` crashes mid-processing:
1. Kafka buffers events
2. Restate journals in-flight requests
3. After restart, Restate replays journal
4. All webhooks delivered successfully

## Latency Breakdown

P50 latency: **< 500ms** from payment commit to webhook delivery

```
Event Timeline (P50):
  0ms        100ms      200ms      300ms      400ms      500ms
  │          │          │          │          │          │
  ├──────────┼──────────┼──────────┼──────────┼──────────┤
  │ Trigger  │ Sequin   │ Kafka    │ Restate  │ webhook- │
  │ <1ms     │ ~50ms    │ ~5ms     │ ~150ms   │ consumer │
  │          │          │          │          │ ~200ms   │
  └──────────┴──────────┴──────────┴──────────┴──────────┘
```

## Should You Use Svix or Build In-House?

### Use Svix (like Dodo) if:
- You want a managed solution
- You need merchant-facing webhook portal
- You value not maintaining delivery infrastructure
- Budget allows for managed services

### Build in-house (like this demo) if:
- You want full control over delivery logic
- You prefer to keep data in-house
- You have expertise to maintain HTTP delivery code
- You're building a payments/critical infrastructure platform

**Both approaches can achieve 99.99%+ reliability** - the choice is operational vs flexibility trade-offs.

## Getting Started

### Prerequisites
```bash
docker compose up -d
```

### Setup
1. Create PostgreSQL replication slot: See `SEQUIN_SETUP.md`
2. Configure Sequin via UI: http://localhost:7376
3. Register Restate handler: `./scripts/register-restate-handler.sh`

### Test End-to-End
```bash
# Create a payment
curl -X POST http://localhost:3001/payments \
  -H "Content-Type: application/json" \
  -d '{"amount": 1000, "currency": "USD"}'

# Check webhook delivered
curl http://localhost:4001/stats
```

### Run Crash Recovery Test
```bash
./scripts/run-tests.sh crash
```

This simulates:
- 100 payments created
- Webhook consumer killed mid-processing
- Container restarted
- Result: 100/100 webhooks delivered (0% loss)

## Documentation

- `RESTATE_REGISTRATION.md` - Manual Restate setup steps
- `SEQUIN_SETUP.md` - Sequin configuration guide
- `docker-compose.yml` - All service definitions
- `scripts/register-restate-handler.sh` - Automated Restate registration
- `tests/crash-test.sh` - Crash recovery verification

## Architecture Blog Posts

- [Original Dodo Payments Blog Post](https://medium.com/dodopayments/building-webhooks-that-never-fail-our-journey-to-99-99-delivery-reliability-f69ed069cf00) - Describes the architecture with Svix
- This demo shows the same architecture works with in-house delivery using Restate's durable execution guarantees

## Technology Stack

- **Language:** Rust (for performance and reliability)
- **Database:** PostgreSQL 15 (with logical replication)
- **CDC:** Sequin (WAL → Kafka)
- **Message Queue:** Apache Kafka
- **Durable Execution:** Restate 1.5
- **Container Orchestration:** Docker Compose

## Key Takeaways

1. In-process webhook delivery is fundamentally unreliable
2. Capture events atomically with database triggers
3. Use CDC (not polling) for real-time event streaming
4. Durable execution (Restate) solves "crashed mid-retry"
5. You don't need Svix to achieve 99.99%+ reliability
6. Restate's journal provides the same guarantees as managed services

## License

MIT
