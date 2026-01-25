import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';
import * as common from './lib/common.js';

// ==============================================================================
// CHAOS TEST: New Architecture - Consumer Crash with Durable Recovery
// ==============================================================================
//
// Blog Scenario: Same as crash-old.js but on new architecture
// - webhook-consumer crashes during processing
// - But: Events are buffered in Kafka, journal is persistent
// - On restart: Consumer resumes from journal, retries incomplete webhooks
//
// Expected Result:
// - ✅ ZERO webhook loss
// - ✅ Automatic recovery from journal
// - ✅ Durable execution guarantees
//
// Run with orchestration:
//   ./load-testing/scripts/chaos-new.sh

const paymentsCreated = new Counter('crash_new_payments');
const merchantReceived = new Counter('crash_new_merchant_received');

export const options = {
  stages: [
    { duration: '1m', target: 20 },   // Ramp up
    { duration: '3m', target: 50 },   // Heavy load (crash happens here)
    { duration: '1m', target: 0 },    // Ramp down
  ],
  thresholds: {
    'http_req_duration': ['p(99)<1000'],
  },
};

export default function() {
  const result = common.createPayment(http, 'http://new-api:3001');
  if (result.success) {
    paymentsCreated.add(1);

    // Wait for async processing (Kafka → Consumer → Merchant)
    sleep(1);
  }
  sleep(0.1);
}

export function setup() {
  console.log('');
  console.log('╔═══════════════════════════════════════════════════════╗');
  console.log('║                                                       ║');
  console.log('║   CHAOS TEST: NEW ARCHITECTURE CRASH RECOVERY        ║');
  console.log('║                                                       ║');
  console.log('╚═══════════════════════════════════════════════════════╝');
  console.log('');
  console.log('Same scenario as old architecture, but different result:');
  console.log('');
  console.log('What happens:');
  console.log('  1. Payment succeeds, event stored in PostgreSQL');
  console.log('  2. Sequin captures event from WAL');
  console.log('  3. Event published to Kafka (durable buffer)');
  console.log('  4. Consumer receives SIGTERM');
  console.log('  5. In-progress webhooks were journaled to Restate');
  console.log('  6. Consumer restarts...');
  console.log('  7. Restate replays journal, consumer continues');
  console.log('  8. Webhook is retried and succeeds');
  console.log('');
  console.log('Expected Result:');
  console.log('  ✅ ZERO webhook loss');
  console.log('  ✅ Automatic recovery via journal');
  console.log('  ✅ Durable execution guarantees');
  console.log('');
  console.log('Test Parameters:');
  console.log('  - Duration: 5 minutes');
  console.log('  - Load: 50 VUs (same as old architecture test)');
  console.log('  - Crash: webhook-consumer killed at ~2.5 min, restarted after 5s');
  console.log('');
  console.log('Running load test...');
  console.log('');
}

export function teardown(data) {
  // Wait longer for retries after consumer restart
  sleep(3);

  const merchantResponse = http.get('http://merchant-new:4001/stats');
  const stats = merchantResponse.json();

  const created = paymentsCreated.value();
  const received = stats.total_received;
  const lost = created - received;
  const successRate = created > 0 ? ((received / created) * 100).toFixed(2) : 0;

  console.log('');
  console.log('╔═══════════════════════════════════════════════════════╗');
  console.log('║                                                       ║');
  console.log('║   CHAOS TEST RESULTS: NEW ARCHITECTURE RECOVERY      ║');
  console.log('║                                                       ║');
  console.log('╚═══════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`Payments Created:     ${String(created).padStart(6)}`);
  console.log(`Webhooks Received:    ${String(received).padStart(6)}`);
  console.log(`Webhooks Lost:        ${String(lost).padStart(6)}`);
  console.log(`Success Rate:         ${String(successRate + '%').padStart(6)}`);
  console.log('');

  if (lost === 0) {
    console.log('╔═══════════════════════════════════════════════════════╗');
    console.log('║  ✅ ZERO WEBHOOK LOSS - DURABLE RECOVERY WORKS!      ║');
    console.log('║                                                       ║');
    console.log('║  Even with a crash:                                   ║');
    console.log('║  - Kafka buffered events durably                      ║');
    console.log('║  - Restate journal survived the crash                 ║');
    console.log('║  - Consumer resumed and retried webhooks              ║');
    console.log('║  - All webhooks eventually delivered                  ║');
    console.log('║                                                       ║');
    console.log('║  This is the solution Dodo built!                    ║');
    console.log('║                                                       ║');
    console.log('╚═══════════════════════════════════════════════════════╝');
  } else {
    console.log('⚠️  Unexpected loss detected:');
    console.log(`  Lost: ${lost} webhooks (${((lost/created)*100).toFixed(2)}%)`);
    console.log('  Check logs for what happened during crash');
  }

  console.log('');
  console.log('Manual Analysis:');
  console.log('  1. Check when webhook-consumer crashed:');
  console.log('     docker compose logs webhook-consumer | tail -20');
  console.log('  2. Check recovery:');
  console.log('     docker compose logs webhook-consumer | grep "resumed\\|recovered"');
  console.log('  3. Check Kafka buffering:');
  console.log('     docker compose logs webhook-consumer | grep "Kafka"');
  console.log('  4. Check Restate journal:');
  console.log('     docker compose logs webhook-consumer | grep "journal"');
  console.log('');
  console.log('Compare with old architecture:');
  console.log('  ./load-testing/scripts/chaos-old.sh');
  console.log('');
}
