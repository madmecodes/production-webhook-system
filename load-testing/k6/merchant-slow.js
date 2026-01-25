import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';
import * as common from './lib/common.js';

// ==============================================================================
// CHAOS TEST: Merchant Endpoint with Slow Response Time
// ==============================================================================
//
// Blog Scenario: Backpressure from slow merchant endpoint
// - Merchant takes 6 seconds to respond (exceeds old-api's 5s timeout)
//
// Expected Results:
// - OLD: 100% timeout failures (hard 5s timeout, no retry)
// - NEW: Retries with exponential backoff, eventually succeeds
//
// This demonstrates why old architecture's hard timeouts + no retry = failure

const paymentsCreatedOld = new Counter('slow_test_old_payments');
const paymentsCreatedNew = new Counter('slow_test_new_payments');
const merchantOldReceived = new Counter('slow_test_old_received');
const merchantNewReceived = new Counter('slow_test_new_received');

export const options = {
  stages: [
    { duration: '30s', target: 3 },    // Light load with slow endpoint
    { duration: '2m', target: 10 },    // Medium load
    { duration: '30s', target: 0 },    // Ramp down
  ],
  thresholds: {
    'http_req_duration': ['p(99)<10000'],  // Relaxed timeout for slow responses
  },
};

const ARCH = __ENV.ARCH || 'old';
const API_URL = ARCH === 'new' ? 'http://new-api:3001' : 'http://old-api:3000';
const MERCHANT_URL = ARCH === 'new' ? 'http://merchant-new:4001/stats' : 'http://merchant-old:4000/stats';
const MERCHANT_PORT = ARCH === 'new' ? 4001 : 4000;

export default function() {
  const result = common.createPayment(http, API_URL);
  if (result.success) {
    if (ARCH === 'new') {
      paymentsCreatedNew.add(1);
      sleep(2);  // Wait for async processing with retries
    } else {
      paymentsCreatedOld.add(1);
    }
  }
  sleep(0.5);
}

export function setup() {
  console.log('╔════════════════════════════════════════╗');
  console.log('║      MERCHANT SLOW RESPONSE TEST       ║');
  console.log('║   (6000ms response time)               ║');
  console.log('╚════════════════════════════════════════╝');
  console.log(`\nTesting: ${ARCH.toUpperCase()} Architecture`);
  console.log(`API: ${API_URL}`);
  console.log(`Merchant: ${MERCHANT_PORT}`);
  console.log('\nExpected:');
  if (ARCH === 'old') {
    console.log('  ❌ 100% timeout failures (5s hard limit)');
  } else {
    console.log('  ✅ Eventually succeeds (retry with backoff)');
  }
  console.log('');
}

export function teardown(data) {
  // Wait longer for retries to complete with slow merchant
  sleep(5);

  const merchantResponse = http.get(MERCHANT_URL);
  if (merchantResponse.status !== 200) {
    console.log('ERROR: Could not fetch merchant stats');
    return;
  }

  const stats = merchantResponse.json();

  const paymentsCreated = ARCH === 'new' ? paymentsCreatedNew.value() : paymentsCreatedOld.value();
  const webhooksReceived = stats.total_received;
  const lost = paymentsCreated - webhooksReceived;
  const successRate = paymentsCreated > 0 ? ((webhooksReceived / paymentsCreated) * 100).toFixed(2) : 0;

  console.log('\n');
  console.log('╔════════════════════════════════════════╗');
  console.log('║   MERCHANT SLOW RESPONSE TEST RESULTS  ║');
  console.log('╠════════════════════════════════════════╣');
  console.log(`║ Payments Created: ${String(paymentsCreated).padEnd(19)} ║`);
  console.log(`║ Webhooks Received: ${String(webhooksReceived).padEnd(18)} ║`);
  console.log(`║ Webhooks Lost: ${String(lost).padEnd(22)} ║`);
  console.log(`║ Success Rate: ${String(successRate + '%').padEnd(23)} ║`);
  console.log('║                                        ║');

  if (ARCH === 'old') {
    if (lost > 0) {
      console.log('║ ❌ Old architecture times out!        ║');
      console.log('║ Hard 5s limit + slow merchant = loss  ║');
    }
  } else {
    if (lost === 0) {
      console.log('║ ✅ New architecture handles it!      ║');
      console.log('║ Retries with exponential backoff     ║');
    } else {
      console.log('║ ⚠️  Some loss detected                ║');
      console.log('║ Check retry configuration            ║');
    }
  }

  console.log('╚════════════════════════════════════════╝');
  console.log('\n');
  console.log('To test, set FAILURE_RATE or DELAY_MS on merchant first:');
  console.log('  OLD: k6 run merchant-slow.js -e ARCH=old');
  console.log('  NEW: k6 run merchant-slow.js -e ARCH=new');
}
