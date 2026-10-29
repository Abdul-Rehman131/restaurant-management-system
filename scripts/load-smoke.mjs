// pnpm load:smoke — a smoke load test against the LOCAL stack (spec 12: about 50 screens and
// 200 orders in an hour), compressed in time.
//
//   * SUBSCRIBERS Realtime clients (one WebSocket each, like one kitchen screen each) join the
//     private staff:kitchen topic as the chef.
//   * ORDERS Take Away orders through the real RPCs, WORKERS at a time: create_order (one
//     kitchen item and a drink), the chef's set_batch_status Preparing then Ready, the
//     cashier's record_payment (the order completes).
//   * Reported: p50, p95 and max of each RPC, and of the time from the start of create_order
//     to each subscriber receiving that order's kitchen event, plus events missed.
// Limits: everything (database, Auth, Realtime, the gateway and this script) runs on one
// machine in Docker, so the numbers show that nothing breaks or queues up under this load, not
// what the hosted project will measure. Exit code 1 when an RPC fails or an event is missed.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

import { key, percentile, psql, rpc, select, signIn, url } from './local-stack.mjs';

const SUBSCRIBERS = Number(process.env.SUBSCRIBERS ?? 50);
const ORDERS = Number(process.env.ORDERS ?? 200);
const WORKERS = Number(process.env.WORKERS ?? 5);
// The hour, compressed: 3x runs 200 orders evenly over 20 minutes. Realtime limits the
// messages per second of a project, counted per screen delivered to (local and the hosted Free
// plan: 100; Pro: 500). Each order sends about 10 kitchen events, so 50 kitchen screens get
// about 500 messages per order: 3x measured 84 a second with nothing missed; 5x (93) was
// already throttled (too_many_requests in the Realtime log). A real hour (1x) is about 28.
const COMPRESS = Number(process.env.COMPRESS ?? 3);
const SPACING_MS = 3600_000 / 200 / COMPRESS;
const id = () => crypto.randomUUID();

// The staff app's Realtime client, the same library the kitchen screen uses.
const require = createRequire(new URL('../apps/staff-app/package.json', import.meta.url));
const { RealtimeClient } = await import(
  pathToFileURL(require.resolve('@supabase/realtime-js')).href
);

const chef = await signIn('chef');
const cashier = await signIn('cashier');
const menu = psql(`select m.id || '|' || m.needs_kitchen from public.menu_items m
                    join public.categories c on c.id = m.category_id
                   where m.is_active and m.is_available and c.is_active order by m.name`)
  .split('\n')
  .map((row) => row.split('|'));
const kitchenItems = menu.filter(([, k]) => k === 'true').map(([i]) => i);
const drinks = menu.filter(([, k]) => k === 'false').map(([i]) => i);

// ===== Subscribers =====
const created = new Map(); // order id -> create_order start time
const received = new Map(); // order id -> receive times (one per subscriber)
const clients = [];
let deliveries = 0; // every kitchen event on every screen
const joined = await Promise.all(
  Array.from({ length: SUBSCRIBERS }, async () => {
    const client = new RealtimeClient(`${url.replace(/^http/, 'ws')}/realtime/v1`, {
      params: { apikey: key },
      accessToken: async () => chef,
    });
    clients.push(client);
    await client.setAuth(chef);
    const channel = client.channel('staff:kitchen', { config: { private: true } });
    const seen = new Set();
    channel.on('broadcast', { event: 'batch_changed' }, () => {
      deliveries++;
    });
    channel.on('broadcast', { event: 'order_changed' }, ({ payload }) => {
      deliveries++;
      const orderId = payload?.order_id;
      // The first event of each order on this screen (the order was created).
      if (!orderId || seen.has(orderId)) return;
      seen.add(orderId);
      const at = performance.now();
      if (!received.has(orderId)) received.set(orderId, []);
      received.get(orderId).push(at);
    });
    return new Promise((resolve) => {
      channel.subscribe((status) => {
        if (status === 'SUBSCRIBED') resolve(true);
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') resolve(false);
      });
    });
  }),
);
const subscribed = joined.filter(Boolean).length;

// ===== Orders =====
const timings = { create_order: [], set_batch_status: [], record_payment: [] };
let failures = 0;
async function timed(name, call) {
  const start = performance.now();
  try {
    return await call();
  } finally {
    timings[name].push(performance.now() - start);
  }
}

let next = 0;
async function worker() {
  while (next < ORDERS) {
    const n = next++;
    // Order n starts at its place in the compressed hour.
    const due = started + n * SPACING_MS - performance.now();
    if (due > 0) await new Promise((resolve) => setTimeout(resolve, due));
    try {
      const start = performance.now();
      const pending = timed('create_order', () =>
        rpc(cashier, 'create_order', {
          p_request_id: id(),
          p_type: 'take_away',
          p_table_id: null,
          p_customer_name: `Load ${n + 1}`,
          p_customer_phone: '',
          p_items: [
            { menu_item_id: kitchenItems[n % kitchenItems.length], quantity: 1 },
            { menu_item_id: drinks[n % drinks.length], quantity: 1 },
          ],
        }),
      );
      const order = await pending;
      created.set(order.order_id, start);
      const [batch] = await select(
        cashier,
        `order_batches?order_id=eq.${order.order_id}&select=id`,
      );
      for (const status of ['preparing', 'ready']) {
        await timed('set_batch_status', () =>
          rpc(chef, 'set_batch_status', {
            p_request_id: id(),
            p_batch_id: batch.id,
            p_status: status,
          }),
        );
      }
      const [{ total }] = await select(cashier, `orders?id=eq.${order.order_id}&select=total`);
      await timed('record_payment', () =>
        rpc(cashier, 'record_payment', {
          p_request_id: id(),
          p_order_id: order.order_id,
          p_tenders: [{ method: 'card', amount: total }],
        }),
      );
    } catch (error) {
      failures++;
      console.error(`order ${n + 1}: ${error.message}`);
    }
  }
}

const started = performance.now();
await Promise.all(Array.from({ length: WORKERS }, worker));
const seconds = (performance.now() - started) / 1000;

// Wait until every subscriber has the last order's event (or 10 s): an event, not a fixed sleep.
const deadline = performance.now() + 10_000;
while (
  performance.now() < deadline &&
  [...created.keys()].some((o) => (received.get(o)?.length ?? 0) < subscribed)
) {
  await new Promise((resolve) => setTimeout(resolve, 50));
}
for (const client of clients) client.disconnect();

// ===== Report =====
const delivery = [];
let missed = 0;
for (const [orderId, start] of created) {
  const times = received.get(orderId) ?? [];
  missed += subscribed - times.length;
  for (const at of times) delivery.push(at - start);
}
const ms = (v) => `${Math.round(v)} ms`.padStart(8);
const row = (label, values) =>
  console.log(
    `${label.padEnd(34)}${ms(percentile(values, 50))}${ms(percentile(values, 95))}${ms(Math.max(0, ...values))}   n=${values.length}`,
  );
console.log('Smoke load (local stack)');
console.log('='.repeat(78));
console.log(`Realtime subscribers: ${subscribed} of ${SUBSCRIBERS} joined staff:kitchen`);
console.log(
  `Orders: ${created.size} completed of ${ORDERS}, ${WORKERS} at a time, in ${seconds.toFixed(1)} s`,
);
console.log(
  `        (= ${Math.round((created.size / seconds) * 3600)} orders an hour: a ${COMPRESS}x compressed hour of 200)`,
);
console.log(
  `Kitchen messages delivered: ${deliveries} (${(deliveries / seconds).toFixed(0)} a second over ${subscribed} screens; limit 100)`,
);
console.log('-'.repeat(78));
console.log(`${''.padEnd(34)}${'p50'.padStart(8)}${'p95'.padStart(8)}${'max'.padStart(8)}`);
row('create_order', timings.create_order);
row('set_batch_status', timings.set_batch_status);
row('record_payment', timings.record_payment);
row('create_order start -> kitchen event', delivery);
console.log('-'.repeat(78));
console.log(`Kitchen events missed: ${missed}; failed orders: ${failures}`);
const ok = failures === 0 && missed === 0 && subscribed === SUBSCRIBERS;
console.log(ok ? 'RESULT: PASS' : 'RESULT: FAIL');
process.exit(ok ? 0 : 1);
