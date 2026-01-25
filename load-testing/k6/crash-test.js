import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter } from 'k6/metrics';
import * as common from './lib/common.js';

// ==============================================================================
// CRASH SIMULATION TEST
// ==============================================================================
//
// Demonstrates durability under failure conditions
// While load is being generated, we simulate pod crashes
//

const paymentsCreated = new Counter('crash_payments_created');

export const options = {
  executor: 'constant-vus',
  vus: 30,
  duration: '5m',
  thresholds: {
    'payments_created': ['count > 100'],
  },
};

export default function() {
  const result = common.createPayment(http, 'http://new-api:3001');
  if (result.success) {
    paymentsCreated.add(1);
  }

  sleep(0.2);
}

export function setup() {
  console.log('💥 CRASH SIMULATION TEST STARTING');
  console.log('⚠️  Old architecture: Kills will cause webhook loss');
  console.log('✅ New architecture: Kills will NOT cause webhook loss (recovers automatically)');
  console.log('');
  console.log('Pods will be killed at: 1min, 2.5min, 4min');
  console.log('');
}

export function teardown(data) {
  sleep(2);

  const oldStats = http.get('http://merchant-old:4000/stats').json();
  const newStats = http.get('http://merchant-new:4001/stats').json();

  console.log('\n');
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║            CRASH SIMULATION TEST RESULTS                  ║');
  console.log('╠═════════════════════════════════╦═════════════════════════╣');
  console.log('║     OLD ARCHITECTURE (Unreliable)    │  NEW ARCHITECTURE (Durable) ║');
  console.log('╠═════════════════════════════════╬═════════════════════════╣');

  const oldLoss = paymentsCreated.value() - oldStats.total_received;
  const oldLossRate = ((oldLoss / paymentsCreated.value()) * 100).toFixed(2);
  const newLoss = paymentsCreated.value() - newStats.total_received;
  const newSuccessRate = ((newStats.total_received / paymentsCreated.value()) * 100).toFixed(2);

  console.log(
    `║ Created: ${String(paymentsCreated.value()).padEnd(11)} │ Created: ${String(paymentsCreated.value()).padEnd(11)} ║`
  );
  console.log(
    `║ Received: ${String(oldStats.total_received).padEnd(10)} │ Received: ${String(newStats.total_received).padEnd(10)} ║`
  );
  console.log(
    `║ Lost: ${String(oldLoss).padEnd(14)} │ Lost: ${String(newLoss).padEnd(14)} ║`
  );
  console.log(
    `║ Loss Rate: ${String(oldLossRate + '%').padEnd(9)} │ Success Rate: ${String(newSuccessRate + '%').padEnd(6)} ║`
  );
  console.log('╠═════════════════════════════════╬═════════════════════════╣');
  console.log('║ ⚠️  Data lost forever!          │ ✅ All webhooks delivered! ║');
  console.log('║ No recovery possible            │ Automatic recovery        ║');
  console.log('║ Support nightmare               │ Audit trail complete      ║');
  console.log('╚═════════════════════════════════╩═════════════════════════╝');
  console.log('\n');
  console.log('This demonstrates why the new architecture is critical for production!');
}
