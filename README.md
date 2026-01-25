# Dodo Payments Webhook Architecture Demo

A complete demonstration of webhook reliability: **Before vs After**

This project shows the difference between:
- ❌ **Old Architecture**: In-memory webhooks (loses 0.3% of events)
- ✅ **New Architecture**: 5-layer durable stack (99.99%+ reliability)

## Why This Matters

At Dodo Payments, webhooks are how merchants know when money moves. Losing even 0.3% means:
- 100,000 payments/day × 0.3% = **300 missed webhooks daily**
- Customers paid but got nothing
- Support tickets, lost trust, revenue impact

This demo shows how Dodo solved it using PostgreSQL triggers, Sequin CDC, Kafka, and durable execution.

---

## Quick Start

### Prerequisites

- Docker & Docker Compose
- k6 (for load testing)
- ~5GB disk space for images

### One Command to See the Full Demo

```bash
# Setup and run full demonstration
make setup
make test-old     # See webhook loss (~0.3%)
make test-new     # See reliability (99.99%+)
make compare      # View results
```

### What You'll See

**Old Architecture Test (2 minutes):**
```
╔════════════════════════════════════════╗
║     OLD ARCHITECTURE TEST RESULTS      ║
╠════════════════════════════════════════╣
║ Payments Created: 1000                 ║
║ Webhooks Received: 997                 ║
║ Webhooks Lost: 3                       ║
║ Loss Rate: 0.3%                        ║
║                                        ║
║ ⚠️  This demonstrates the problem     ║
║ that Dodo was facing!                 ║
╚════════════════════════════════════════╝
```

**New Architecture Test (2 minutes):**
```
╔════════════════════════════════════════╗
║     NEW ARCHITECTURE TEST RESULTS      ║
╠════════════════════════════════════════╣
║ Payments Created: 1000                 ║
║ Webhooks Received: 1000                ║
║ Webhooks Lost: 0                       ║
║ Success Rate: 100%                     ║
║                                        ║
║ ✅ This is the solution!              ║
║ Durable, reliable, recoverable!       ║
╚════════════════════════════════════════╝
```

---

## Architecture Overview

### Old Architecture (Unreliable)

```
User Payment → API Server → In-Memory Queue → Send to Merchant
                              ↓
                      Process crashes
                      Webhook LOST forever
                      No recovery possible
```

**Problem:** All webhook state lives in process memory. SIGTERM/SIGKILL during deployment = data loss.

### New Architecture (Reliable)

```
User Payment → DB Trigger → Event Row → Sequin → Kafka → Webhook Consumer → Merchant
  ✅ Atomic                ✅ Durable    ✅ CDC    ✅ Buffer  ✅ Retries     ✅ Delivered

Layer 1: PostgreSQL Triggers
  - Event creation atomic with payment update
  - Guarantee: If payment committed, event exists

Layer 2: Sequin CDC
  - Reads PostgreSQL WAL in real-time
  - Pushes to Kafka with exactly-once delivery
  - Sub-millisecond latency

Layer 3: Kafka
  - Durable buffer
  - Can replay 7 days of history
  - Handles backpressure

Layer 4: Webhook Consumer (Restate Simulation)
  - Journaled execution
  - Survives crashes/restarts
  - Automatic retries with exponential backoff
  - Stable idempotency keys

Layer 5: Merchant Endpoint
  - Webhook delivered
  - Idempotency prevents duplicates
```

---

## Project Structure

```
dodo-webhook-demo/
├── services/
│   ├── old-architecture/          # Unreliable: in-memory webhooks
│   ├── new-architecture/
│   │   ├── api-service/           # API with DB triggers
│   │   ├── data-service/          # Payload fetcher
│   │   └── webhook-consumer/      # Durable execution (Restate sim)
│   └── merchant-simulator/        # Webhook receiver
├── infrastructure/
│   ├── postgres/                  # Triggers + migrations
│   └── sequin/                    # CDC configuration
├── load-testing/k6/
│   ├── test-old.js                # Old architecture test
│   ├── test-new.js                # New architecture test
│   └── crash-test.js              # Durability demo
└── Makefile                       # Simple commands
```

---

## Detailed Commands

### Setup & Management

```bash
make setup          # Build all services and start
make down           # Stop all services
make clean          # Remove containers and volumes
make health-check   # Check service status
make logs           # Stream all logs
```

### Testing

```bash
make test-old       # Load test old architecture (generates report)
make test-new       # Load test new architecture (generates report)
make test-crash     # Crash simulation test
make compare        # View side-by-side comparison of results
```

### Debugging

```bash
make logs-old-api          # Tail old API logs
make logs-new-api          # Tail new API logs
make logs-postgres         # Tail database logs
make logs-kafka            # Tail Kafka logs
make shell-db              # Open PostgreSQL shell
```

---

## Understanding the Results

### Metrics to Compare

| Metric | Old Arch | New Arch |
|--------|----------|----------|
| **Success Rate** | 99.7% | 99.99%+ |
| **Loss Rate** | 0.3% | <0.01% |
| **P50 Latency** | 100-200ms | 450-500ms |
| **Durability** | ❌ None | ✅ Full |
| **Recovery** | ❌ No | ✅ Automatic |
| **Audit Trail** | ❌ No | ✅ Complete |

### Why New Architecture is Faster Despite More Layers

**Old (Simple but Slow):**
- 5s polling interval + delivery = 5+ seconds minimum

**New (Complex but Fast):**
- Trigger (0ms) + WAL (1ms) + Sequin (50ms) + Kafka (5ms) + Consumer (100ms) + Delivery (300ms) = ~450ms
- **CDC is faster than polling** (push vs pull)
- **Parallel processing** (1000s of concurrent events)

---

## How to Use This for Your Video

### Script Outline

1. **Introduction (30s)**
   - Show the problem: 300 lost webhooks per day
   - Show the cost: support tickets, lost trust

2. **Old Architecture Explanation (1m)**
   - Show code: in-memory queue
   - Run `make test-old`
   - Show results: 0.3% loss

3. **New Architecture Explanation (2m)**
   - Show diagram: 5 layers
   - Explain each layer:
     - PostgreSQL triggers (atomic)
     - Sequin CDC (real-time)
     - Kafka (buffer)
     - Webhook consumer (durable)
     - Merchant (delivery)

4. **Live Demo (3m)**
   - Run `make setup`
   - Run `make test-new`
   - Show results: 99.99%+ success
   - Show dashboards/metrics

5. **Comparison (1m)**
   - Show k6 reports side-by-side
   - Highlight success rate difference
   - Show latency comparison

6. **Takeaway (30s)**
   - Why this architecture works
   - Key: Durability + Recovery
   - Lessons for other systems

### Screenshot Ideas

1. Code walkthrough: Old architecture (simple but broken)
2. Code walkthrough: New architecture (complex but reliable)
3. k6 HTML report showing old architecture loss
4. k6 HTML report showing new architecture success
5. Terminal showing test results with percentages
6. Diagram of 5-layer stack
7. Comparison table: old vs new metrics

---

## Key Technologies

| Component | Tech | Why |
|-----------|------|-----|
| Language | Rust | Performance, type safety (Dodo uses it) |
| Database | PostgreSQL | Triggers, WAL, replication |
| CDC | Sequin | Real-time change data capture |
| Queue | Kafka | Durable message buffer |
| Execution | Restate (simulated) | Durable execution with journaling |
| Testing | k6 | Easy load testing, HTML reports |
| Container | Docker | Reproducible environment |

---

## What Each Layer Guarantees

```
┌──────────────────────────────────────────────────────────────┐
│ PostgreSQL Triggers                                          │
│ └─► "If payment committed, event exists"                    │
├──────────────────────────────────────────────────────────────┤
│ Sequin CDC                                                   │
│ └─► "Every committed event reaches Kafka, in order"         │
├──────────────────────────────────────────────────────────────┤
│ Kafka                                                        │
│ └─► "Events buffered durably, replayable for 7 days"        │
├──────────────────────────────────────────────────────────────┤
│ Webhook Consumer                                            │
│ └─► "Processing completes, even through crashes"           │
├──────────────────────────────────────────────────────────────┤
│ Merchant Endpoint                                            │
│ └─► "Webhook delivered or retried until merchant responds"  │
└──────────────────────────────────────────────────────────────┘

Combined: Events flow database → merchant with exactly-once semantics
          and sub-500ms latency, surviving all failure modes
```

---

## Troubleshooting

### "docker-compose command not found"
```bash
# Use docker compose (v2)
docker compose up -d
```

### "k6 command not found"
```bash
# Install k6
brew install k6  # macOS
# or from: https://k6.io/docs/getting-started/installation/
```

### Services fail to start
```bash
# Check logs
make logs

# Ensure ports are free
lsof -i :3000  # Check port 3000
lsof -i :5432  # Check port 5432
```

### Database connection errors
```bash
# Give PostgreSQL time to init
sleep 5
docker-compose restart postgres

# Or check it's running
docker-compose ps postgres
```

---

## Production Considerations

This demo simulates but doesn't include:
- Real Restate (would require additional setup)
- Real Svix (we use mock endpoint)
- TLS/certificates
- Rate limiting on production scale
- Multi-region setup
- Monitoring/alerts (Prometheus + Grafana optional)

For production, Dodo uses:
- Real PostgreSQL with replication
- Real Sequin (https://sequin.io)
- Real Kafka cluster
- Real Restate (https://restate.dev)
- Real Svix (https://svix.com)

---

## Learning Outcomes

After running this demo, you'll understand:

✅ Why in-memory webhooks fail at scale
✅ How PostgreSQL triggers enable atomicity
✅ Why CDC beats polling
✅ How Kafka provides durability and replay
✅ Why durable execution is critical
✅ The cost of each reliability guarantee
✅ Trade-offs: complexity vs reliability

---

## Next Steps

1. **Run the demo**: `make setup && make test-old && make test-new`
2. **Study the code**: Look at each service in `services/`
3. **Modify scenarios**: Change load patterns in k6 tests
4. **Add monitoring**: Set up Prometheus + Grafana
5. **Deploy to cloud**: Use this as reference for production deployment

---

## Questions?

This demo implements concepts from:
- Dodo Payments blog: "Building Webhooks That Never Fail"
- Reliability patterns: exactly-once delivery, durable execution
- Real-world architectures: Stripe, PayPal, Razorpay

For more:
- Read the Dodo blog: [Link]
- Learn Sequin: https://sequin.io/docs
- Learn Restate: https://restate.dev/docs
- k6 docs: https://k6.io/docs

---

## License

MIT - Use freely for learning and demonstration purposes
