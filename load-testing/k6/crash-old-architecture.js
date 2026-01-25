import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';
import * as common from './lib/common.js';

// ==============================================================================
// CHAOS TEST: Old Architecture - Process Crash During Webhook Delivery
// ==============================================================================
//
// Blog Scenario: "Timeline of a Lost Webhook"
// - Service receives SIGTERM/SIGKILL during in-flight webhook request
// - In-memory queue is lost
// - Webhook never reaches merchant
//
// Expected Result:
// - Webhooks sent during crash window (while pod is down) are LOST FOREVER
//
// Run with orchestration:
//   ./load-testing/scripts/chaos-old.sh

const paymentsCreated = new Counter('crash_old_payments');
const merchantReceived = new Counter('crash_old_merchant_received');

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
  const result = common.createPayment(http, 'http://old-api:3000');
  if (result.success) {
    paymentsCreated.add(1);
  }
  sleep(0.1);
}

export function setup() {
  console.log('');
  console.log('╔═══════════════════════════════════════════════════════╗');
  console.log('║                                                       ║');
  console.log('║   CHAOS TEST: OLD ARCHITECTURE CRASH SCENARIO        ║');
  console.log('║                                                       ║');
  console.log('╚═══════════════════════════════════════════════════════╝');
  console.log('');
  console.log('Blog Scenario: "Timeline of a Lost Webhook"');
  console.log('');
  console.log('What happens:');
  console.log('  1. Payment succeeds, API queues webhook');
  console.log('  2. Service receives SIGTERM (Kubernetes deployment)');
  console.log('  3. In-memory queue is discarded');
  console.log('  4. Webhook never reaches merchant');
  console.log('  5. Payment shows "succeeded" in database');
  console.log('  6. Merchant never receives notification');
  console.log('');
  console.log('Expected Result:');
  console.log('  ❌ Webhooks during crash window are LOST FOREVER');
  console.log('  ❌ No error log, no retry, no audit trail');
  console.log('');
  console.log('Test Parameters:');
  console.log('  - Duration: 5 minutes');
  console.log('  - Load: 50 VUs (heavy)');
  console.log('  - Crash: old-api killed at ~2.5 min, restarted after 5s');
  console.log('');
  console.log('Running load test...');
  console.log('');
}

export function teardown(data) {
  // Get final stats
  const merchantResponse = http.get('http://merchant-old:4000/stats');
  const stats = merchantResponse.json();

  const created = paymentsCreated.value();
  const received = stats.total_received;
  const lost = created - received;
  const lossRate = created > 0 ? ((lost / created) * 100).toFixed(2) : 0;

  console.log('');
  console.log('╔═══════════════════════════════════════════════════════╗');
  console.log('║                                                       ║');
  console.log('║     CHAOS TEST RESULTS: OLD ARCHITECTURE CRASH       ║');
  console.log('║                                                       ║');
  console.log('╚═══════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`Payments Created:     ${String(created).padStart(6)}`);
  console.log(`Webhooks Received:    ${String(received).padStart(6)}`);
  console.log(`Webhooks Lost:        ${String(lost).padStart(6)}`);
  console.log(`Loss Rate:            ${String(lossRate + '%').padStart(6)}`);
  console.log('');

  if (lost > 0) {
    console.log('╔═══════════════════════════════════════════════════════╗');
    console.log('║  ❌ WEBHOOK LOSS DETECTED                            ║');
    console.log('║                                                       ║');
    console.log('║  The crash caused webhooks to be lost!               ║');
    console.log('║  - In-memory queue discarded on SIGTERM              ║');
    console.log('║  - No durability guarantees                          ║');
    console.log('║  - This is the problem Dodo was facing               ║');
    console.log('║                                                       ║');
    console.log('╚═══════════════════════════════════════════════════════╝');
  } else {
    console.log('No loss detected - crash may not have happened');
    console.log('Check if orchestration script is running the crash:');
    console.log('  ./load-testing/scripts/chaos-old.sh');
  }

  console.log('');
  console.log('Manual Analysis:');
  console.log('  1. Check when old-api crashed:');
  console.log('     docker compose logs old-api | tail -20');
  console.log('  2. Count webhooks before crash:');
  console.log('     docker compose logs merchant-old | grep "Stats:" | head -1');
  console.log('  3. Count webhooks after restart:');
  console.log('     docker compose logs merchant-old | grep "Stats:" | tail -1');
  console.log('  4. Compare: the difference is webhooks lost during crash');
  console.log('');
  console.log('Compare with new architecture:');
  console.log('  ./load-testing/scripts/chaos-new.sh');
  console.log('');
}
