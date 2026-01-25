import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';
import * as common from './lib/common.js';

// ==============================================================================
// LOAD TEST: OLD ARCHITECTURE (Unreliable - In-Memory Webhooks)
// ==============================================================================
//
// This test demonstrates the webhook loss problem:
// - Expected loss rate: ~0.3%
// - At 100,000 payments/day: 300 lost webhooks daily
// - Scenario: Process crash during Kubernetes deployment
//

const paymentsCreated = new Counter('old_payments_created');
const merchantPaymentsReceived = new Counter('old_merchant_received');

export const options = {
  stages: [
    { duration: '1m', target: 20 },   // Ramp up to 20 VUs
    { duration: '3m', target: 50 },   // Increase to 50 VUs (heavy load)
    { duration: '1m', target: 0 },    // Ramp down
  ],
  thresholds: {
    'payments_created': ['count > 100'],
    'http_req_duration': ['p(99)<1000'],
  },
};

export default function() {
  const result = common.createPayment(http, 'http://old-api:3000');
  if (result.success) {
    paymentsCreated.add(1);
  }

  // Small delay between requests
  sleep(0.1);
}

export function setup() {
  console.log('🔴 OLD ARCHITECTURE TEST STARTING');
  console.log('⚠️  Expected webhook loss rate: ~0.3%');
  console.log('📊 Running 5 minutes of load test');
}

export function teardown(data) {
  // Check merchant stats
  const merchantResponse = http.get('http://merchant-old:4000/stats');
  const stats = merchantResponse.json();

  console.log('\n');
  console.log('╔════════════════════════════════════════╗');
  console.log('║     OLD ARCHITECTURE TEST RESULTS      ║');
  console.log('╠════════════════════════════════════════╣');
  console.log(`║ Payments Created: ${String(paymentsCreated.value()).padEnd(19)} ║`);
  console.log(`║ Webhooks Received: ${String(stats.total_received).padEnd(18)} ║`);

  const lost = paymentsCreated.value() - stats.total_received;
  const lossRate = ((lost / paymentsCreated.value()) * 100).toFixed(2);

  console.log(`║ Webhooks Lost: ${String(lost).padEnd(22)} ║`);
  console.log(`║ Loss Rate: ${String(lossRate + '%').padEnd(26)} ║`);
  console.log('║                                        ║');
  console.log('║ ⚠️  This demonstrates the problem     ║');
  console.log('║ that Dodo was facing!                 ║');
  console.log('╚════════════════════════════════════════╝');
  console.log('\n');
}
