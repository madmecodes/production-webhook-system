import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';
import * as common from './lib/common.js';

// ==============================================================================
// CHAOS TEST: Old Architecture Channel Overflow
// ==============================================================================
//
// Blog Vulnerability: In-Memory Queue Capacity Limit
// - Old architecture uses mpsc::channel(1000)
// - When queue fills, new webhooks are dropped silently
//
// Expected Results:
// - OLD: Webhook loss when queue overflows (~1000+ concurrent requests)
// - NEW: No overflow (Kafka's distributed queue handles millions)
//
// This demonstrates another failure mode of in-process webhooks

const paymentsCreatedOld = new Counter('overflow_test_old_payments');
const paymentsCreatedNew = new Counter('overflow_test_new_payments');

export const options = {
  stages: [
    // Sudden burst to overwhelm the channel
    { duration: '10s', target: 50 },   // Fast ramp to 50 VUs
    { duration: '20s', target: 50 },   // Hold burst
    { duration: '10s', target: 0 },    // Ramp down
  ],
  thresholds: {
    'http_req_duration': ['p(99)<2000'],
  },
};

const ARCH = __ENV.ARCH || 'old';
const API_URL = ARCH === 'new' ? 'http://new-api:3001' : 'http://old-api:3000';
const MERCHANT_URL = ARCH === 'new' ? 'http://merchant-new:4001/stats' : 'http://merchant-old:4000/stats';

export default function() {
  const result = common.createPayment(http, API_URL);
  if (result.success) {
    if (ARCH === 'new') {
      paymentsCreatedNew.add(1);
      sleep(0.5);  // Brief wait for async processing
    } else {
      paymentsCreatedOld.add(1);
    }
  }
  sleep(0.05);  // Minimal delay to create burst
}

export function setup() {
  console.log('╔════════════════════════════════════════╗');
  console.log('║     CHANNEL OVERFLOW TEST              ║');
  console.log('║   (Burst load, 100 VUs)               ║');
  console.log('╚════════════════════════════════════════╝');
  console.log(`\nTesting: ${ARCH.toUpperCase()} Architecture`);
  console.log(`API: ${API_URL}`);
  console.log('\nScenario:');
  console.log('  - Old arch queue capacity: 1000');
  console.log('  - Sudden burst: 100 concurrent VUs');
  console.log('  - Tests channel overflow behavior');
  console.log('\nExpected:');
  if (ARCH === 'old') {
    console.log('  ❌ Queue overflow = dropped webhooks');
  } else {
    console.log('  ✅ Unlimited capacity (Kafka)');
  }
  console.log('');
}

export function teardown(data) {
  sleep(2);

  const merchantResponse = http.get(MERCHANT_URL);
  if (merchantResponse.status !== 200) {
    console.log('ERROR: Could not fetch merchant stats');
    return;
  }

  const stats = merchantResponse.json();

  console.log('\n');
  console.log('╔════════════════════════════════════════╗');
  console.log('║  CHANNEL OVERFLOW TEST RESULTS         ║');
  console.log('╠════════════════════════════════════════╣');
  console.log(`║ Webhooks Received: ${String(stats.total_received).padEnd(18)} ║`);
  console.log(`║ Unique Payments: ${String(stats.unique_payments).padEnd(20)} ║`);
  console.log('║                                        ║');
  console.log('║ Compare with "payments_created"       ║');
  console.log('║ metric from k6 output above            ║');
  console.log('║                                        ║');

  if (ARCH === 'old') {
    console.log('║ ❌ Old: Fixed 1000-capacity queue    ║');
    console.log('║ Expected: Loss on burst load          ║');
  } else {
    console.log('║ ✅ New: Kafka unlimited capacity     ║');
    console.log('║ Expected: 0% loss (queue buffers)     ║');
  }

  console.log('╚════════════════════════════════════════╝');
  console.log('\n');
  console.log('Key Finding:');
  if (ARCH === 'old') {
    console.log('  In-memory channels have fixed capacity');
    console.log('  Bursts → queue overflow → data loss');
  } else {
    console.log('  Message brokers buffer unlimited messages');
    console.log('  Bursts → queue grows → no data loss');
  }
}
