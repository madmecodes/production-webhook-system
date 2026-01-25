import { check, sleep } from 'k6';
import { Counter, Trend, Gauge } from 'k6/metrics';

export const webhooksCreated = new Counter('payments_created');
export const webhooksDelivered = new Counter('webhooks_delivered');
export const webhooksLost = new Counter('webhooks_lost');
export const paymentLatency = new Trend('payment_latency_ms');
export const deliveryLatency = new Trend('delivery_latency_ms');

export function createPayment(http, baseUrl) {
  const payload = {
    amount: Math.floor(Math.random() * 10000) + 1000,
    currency: 'USD',
  };

  const startTime = Date.now();
  const response = http.post(`${baseUrl}/payments`, JSON.stringify(payload), {
    headers: {
      'Content-Type': 'application/json',
    },
  });

  const duration = Date.now() - startTime;
  paymentLatency.add(duration);

  const success = check(response, {
    'payment created successfully': (r) => r.status === 201,
  });

  if (success) {
    webhooksCreated.add(1);
    const paymentId = response.json('id');
    return { paymentId, success: true };
  } else {
    webhooksLost.add(1);
    return { paymentId: null, success: false };
  }
}

export function sleep_ms(ms) {
  sleep(ms / 1000);
}
