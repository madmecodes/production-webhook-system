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
