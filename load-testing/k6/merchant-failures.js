import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';
import * as common from './lib/common.js';

// ==============================================================================
// CHAOS TEST: Merchant Endpoint Returning 500 Errors
// ==============================================================================
//
// Blog Scenario: "Why Retries Aren't Enough"
// - Merchant endpoint returns 500 on 50% of requests
//
// Expected Results:
// - OLD: ~50% webhook loss (no retry mechanism)
// - NEW: 0% loss (retries eventually succeed)
//
// Run both architectures and compare!

const paymentsCreatedOld = new Counter('failure_test_old_payments');
const paymentsCreatedNew = new Counter('failure_test_new_payments');
const merchantOldReceived = new Counter('failure_test_old_received');
const merchantNewReceived = new Counter('failure_test_new_received');

export const options = {
  stages: [
    { duration: '30s', target: 5 },    // Ramp to 5 VUs
    { duration: '2m', target: 20 },    // Hold at 20 VUs with merchant failures
    { duration: '30s', target: 0 },    // Ramp down
  ],
  thresholds: {
    'http_req_duration': ['p(99)<5000'],  // Relaxed threshold for retries
  },
};

// Determine which architecture to test based on environment
const ARCH = __ENV.ARCH || 'old';  // Usage: k6 run merchant-failures.js -e ARCH=old
const API_URL = ARCH === 'new' ? 'http://new-api:3001' : 'http://old-api:3000';
const MERCHANT_URL = ARCH === 'new' ? 'http://merchant-new:4001/stats' : 'http://merchant-old:4000/stats';
const MERCHANT_PORT = ARCH === 'new' ? 4001 : 4000;

export default function() {
  const result = common.createPayment(http, API_URL);
  if (result.success) {
    if (ARCH === 'new') {
      paymentsCreatedNew.add(1);
      sleep(1);  // Wait for async processing
    } else {
      paymentsCreatedOld.add(1);
    }
  }
  sleep(0.1);
}

export function setup() {
  console.log('╔════════════════════════════════════════╗');
  console.log('║     MERCHANT FAILURES TEST             ║');
  console.log('║   (50% failure rate on merchant)       ║');
  console.log('╚════════════════════════════════════════╝');
  console.log(`\nTesting: ${ARCH.toUpperCase()} Architecture`);
  console.log(`API: ${API_URL}`);
  console.log(`Merchant: ${MERCHANT_PORT}`);
  console.log('\nExpected:');
  if (ARCH === 'old') {
    console.log('  ❌ ~50% webhook loss (no retry logic)');
  } else {
    console.log('  ✅ 0% loss (exponential backoff retries)');
  }
  console.log('');
}

export function teardown(data) {
  // Wait for any pending retries to complete
  sleep(3);

  // Get merchant stats
  const merchantResponse = http.get(MERCHANT_URL);
  if (merchantResponse.status !== 200) {
    console.log('ERROR: Could not fetch merchant stats');
    return;
  }

  const stats = merchantResponse.json();

  // Calculate metrics
  const paymentsCreated = ARCH === 'new' ? paymentsCreatedNew.value() : paymentsCreatedOld.value();
  const webhooksReceived = stats.total_received;
  const lost = paymentsCreated - webhooksReceived;
  const successRate = paymentsCreated > 0 ? ((webhooksReceived / paymentsCreated) * 100).toFixed(2) : 0;

  console.log('\n');
  console.log('╔════════════════════════════════════════╗');
  console.log('║      MERCHANT FAILURES TEST RESULTS    ║');
  console.log('╠════════════════════════════════════════╣');
  console.log(`║ Payments Created: ${String(paymentsCreated).padEnd(19)} ║`);
  console.log(`║ Webhooks Received: ${String(webhooksReceived).padEnd(18)} ║`);
  console.log(`║ Webhooks Lost: ${String(lost).padEnd(22)} ║`);
  console.log(`║ Success Rate: ${String(successRate + '%').padEnd(23)} ║`);
  console.log('║                                        ║');

  if (ARCH === 'old') {
    if (lost > 0) {
      console.log('║ ❌ Old architecture lost webhooks!    ║');
      console.log('║ No retry mechanism = data loss        ║');
    }
  } else {
    if (lost === 0) {
      console.log('║ ✅ New architecture: 0% loss!        ║');
      console.log('║ Retries handle merchant failures     ║');
    } else {
      console.log('║ ⚠️  Some loss detected                ║');
      console.log('║ Check merchant logs for failures     ║');
    }
  }

  console.log('╚════════════════════════════════════════╝');
  console.log('\n');
  console.log('COMPARISON:');
  console.log('  Run both: k6 run merchant-failures.js -e ARCH=old');
  console.log('            k6 run merchant-failures.js -e ARCH=new');
}
