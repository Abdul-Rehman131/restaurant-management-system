// pnpm sim:day — a simulated restaurant day against the LOCAL stack (P1 done criterion 9).
//
// Creates at least 50 orders through the real RPCs, as the real roles: four waiters at once on
// their own tables (Dine-In, add-ons), the counter (Take Away, pay before or after the food),
// the chef (every kitchen batch: Preparing, Ready), the cashier (Cash, Card, split payments,
// cancelled lines and orders), an Admin (a discount, a void and the re-payment). Then it
// reconciles and prints PASS or FAIL:
//   1. every order of the run is closed (completed or cancelled)
//   2. live payments of the run = totals of its completed orders
//   3. each completed order's totals = an independent calculation from its line snapshots and
//      the settings (BR-01, BR-16)
//   4. the business day's order numbers are unique and sequential, 1..N (BR-03)
//   5. no table stuck Occupied, and table status agrees with open orders (G13)
//   6. no open Dine-In order without a table, at most one open order per table (BR-05)
//   7. the dashboard (get_sales_summary) = the same numbers computed independently in SQL
// Exit code 0 on PASS, 1 on FAIL. Disposable staff and tables are archived afterwards.
import {
  RpcError,
  adminToken,
  archiveStaff,
  archiveTables,
  createStaff,
  createTables,
  psql,
  rpc,
  select,
  signIn,
} from './local-stack.mjs';

const SECTION = 'SIM';
const TABLES = [201, 202, 203, 204, 205, 206, 207, 208];
const ROUNDS = 3; // Dine-In orders per table
const TAKE_AWAY = 28; // counter orders
const id = () => crypto.randomUUID();

// ===== Setup =====
const started = Date.now();
const settings = JSON.parse(
  psql(`select row_to_json(s) from (select tax_bps, service_charge_bps, prices_include_tax,
          discount_reduces_charges, service_charge_on_dine_in, service_charge_on_take_away,
          service_charge_on_delivery, tax_on_service_charge, rounding_mode, rounding_unit_minor
          from public.settings) s`),
);
const menu = psql(`select m.id || '|' || m.needs_kitchen from public.menu_items m
                    join public.categories c on c.id = m.category_id
                   where m.is_active and m.is_available and c.is_active order by m.name`)
  .split('\n')
  .map((row) => {
    const [itemId, kitchen] = row.split('|');
    return { id: itemId, kitchen: kitchen === 'true' };
  });
const kitchenItems = menu.filter((m) => m.kitchen);
const drinks = menu.filter((m) => !m.kitchen);
const tableIds = createTables(TABLES, SECTION);
const extraWaiters = [createStaff('waiter'), createStaff('waiter')];
const waiters = ['waiter1', 'waiter2', ...extraWaiters];
const tokens = {
  cashier: await signIn('cashier'),
  chef: await signIn('chef'),
  ...Object.fromEntries(await Promise.all(waiters.map(async (w) => [w, await signIn(w)]))),
};
const admin = await adminToken();

const runOrders = new Set();
const counts = {
  dineIn: 0,
  takeAway: 0,
  addOns: 0,
  cancelledLines: 0,
  cancelledOrders: 0,
  discounts: 0,
  voids: 0,
  split: 0,
  cash: 0,
  card: 0,
  payFirst: 0,
  replays: 0,
};
let pick = 0;
const take = (list, n) => Array.from({ length: n }, () => list[pick++ % list.length]);
const lines = (items) => items.map((item, i) => ({ menu_item_id: item.id, quantity: 1 + (i % 2) }));

// ===== Steps through the real RPCs =====
async function kitchen(orderId) {
  const batches = await select(
    tokens.cashier,
    `order_batches?order_id=eq.${orderId}&status=in.(sent,preparing)&select=id,status`,
  );
  for (const batch of batches) {
    if (batch.status === 'sent') {
      await rpc(tokens.chef, 'set_batch_status', {
        p_request_id: id(),
        p_batch_id: batch.id,
        p_status: 'preparing',
      });
    }
    await rpc(tokens.chef, 'set_batch_status', {
      p_request_id: id(),
      p_batch_id: batch.id,
      p_status: 'ready',
    });
  }
}

async function pay(orderId, n) {
  const order = (await select(tokens.cashier, `orders?id=eq.${orderId}&select=total`))[0];
  let tenders;
  if (n % 3 === 0 && order.total >= 200) {
    const cash = Math.floor(order.total / 2 / 100) * 100;
    tenders = [
      { method: 'cash', amount: cash, tendered: cash },
      { method: 'card', amount: order.total - cash },
    ];
    counts.split++;
  } else if (n % 3 === 1) {
    tenders = [{ method: 'card', amount: order.total }];
    counts.card++;
  } else {
    const tendered = Math.ceil(order.total / 50000) * 50000;
    tenders = [{ method: 'cash', amount: order.total, tendered }];
    counts.cash++;
  }
  const request = id();
  const paid = await rpc(tokens.cashier, 'record_payment', {
    p_request_id: request,
    p_order_id: orderId,
    p_tenders: tenders,
  });
  // A double tap on Pay (BR-15): the same request id is a replay, never a second payment.
  if (n % 7 === 0) {
    const again = await rpc(tokens.cashier, 'record_payment', {
      p_request_id: request,
      p_order_id: orderId,
      p_tenders: tenders,
    });
    if (again.replayed === true) counts.replays++;
  }
  return paid;
}

/** One waiter's table: ROUNDS guests one after the other. */
async function waiterLane(waiter, table, lane) {
  for (let round = 0; round < ROUNDS; round++) {
    const n = lane * ROUNDS + round;
    const order = await rpc(tokens[waiter], 'create_order', {
      p_request_id: id(),
      p_type: 'dine_in',
      p_table_id: tableIds[table],
      p_customer_name: '',
      p_customer_phone: '',
      p_items: lines([...take(kitchenItems, 2), ...take(drinks, 1)]),
    });
    runOrders.add(order.order_id);
    counts.dineIn++;

    // A cancelled order: the guest leaves before the kitchen starts.
    if (n % 11 === 5) {
      await rpc(tokens.cashier, 'cancel_order', {
        p_request_id: id(),
        p_order_id: order.order_id,
        p_reason: 'Guest left (simulated day)',
      });
      counts.cancelledOrders++;
      continue;
    }
    await kitchen(order.order_id);
    await rpc(tokens[waiter], 'set_order_status', {
      p_request_id: id(),
      p_order_id: order.order_id,
      p_status: 'served',
    });
    // More items after serving: a new batch, ADD-ON for the kitchen (BR-06).
    if (n % 2 === 0) {
      await rpc(tokens[waiter], 'add_items_to_order', {
        p_request_id: id(),
        p_order_id: order.order_id,
        p_items: lines(take(kitchenItems, 1)),
      });
      counts.addOns++;
      await kitchen(order.order_id);
      await rpc(tokens[waiter], 'set_order_status', {
        p_request_id: id(),
        p_order_id: order.order_id,
        p_status: 'served',
      });
    }
    // A line cancelled with a reason by the cashier (BR-09).
    if (n % 5 === 1) {
      const items = await select(
        tokens.cashier,
        `order_items?order_id=eq.${order.order_id}&is_cancelled=eq.false&select=id&limit=1`,
      );
      await rpc(tokens.cashier, 'remove_or_cancel_item', {
        p_request_id: id(),
        p_order_item_id: items[0].id,
        p_reason: 'Wrong dish (simulated day)',
      });
      counts.cancelledLines++;
    }
    // One Admin discount (BR-10).
    if (n === 4) {
      await rpc(admin.token, 'apply_discount', {
        p_request_id: id(),
        p_order_id: order.order_id,
        p_amount: 10000,
        p_reason: 'Regular guest (simulated day)',
      });
      counts.discounts++;
    }
    await rpc(tokens[waiter], 'request_bill', { p_request_id: id(), p_order_id: order.order_id });
    await pay(order.order_id, n);
    // One void by the Admin, then the bill is paid again.
    if (n === 7) {
      const payments = await select(
        tokens.cashier,
        `payments?order_id=eq.${order.order_id}&voided_at=is.null&select=id`,
      );
      for (const payment of payments) {
        await rpc(admin.token, 'void_payment', {
          p_request_id: id(),
          p_payment_id: payment.id,
          p_reason: 'Paid on the wrong bill (simulated day)',
        });
      }
      counts.voids++;
      await pay(order.order_id, n + 1);
    }
  }
}

/** The counter: Take Away orders, some paid before the food is ready. */
async function counter() {
  for (let n = 0; n < TAKE_AWAY; n++) {
    const drinksOnly = n % 4 === 0;
    const order = await rpc(tokens.cashier, 'create_order', {
      p_request_id: id(),
      p_type: 'take_away',
      p_table_id: null,
      p_customer_name: `Sim guest ${n + 1}`,
      p_customer_phone: '',
      p_items: lines(drinksOnly ? take(drinks, 2) : [...take(kitchenItems, 1), ...take(drinks, 1)]),
    });
    runOrders.add(order.order_id);
    counts.takeAway++;
    // Only an order still waiting for the kitchen can be cancelled as a whole (S1).
    if ([7, 17, 26].includes(n)) {
      await rpc(tokens.cashier, 'cancel_order', {
        p_request_id: id(),
        p_order_id: order.order_id,
        p_reason: 'Changed their mind (simulated day)',
      });
      counts.cancelledOrders++;
      continue;
    }
    if (!drinksOnly && n % 3 === 1) {
      // Pay first, then the kitchen, then hand over (G9).
      await pay(order.order_id, n);
      await kitchen(order.order_id);
      await rpc(tokens.cashier, 'set_order_status', {
        p_request_id: id(),
        p_order_id: order.order_id,
        p_status: 'completed',
      });
      counts.payFirst++;
    } else {
      await kitchen(order.order_id);
      await pay(order.order_id, n);
    }
  }
}

// ===== Run: the four waiters and the counter at the same time =====
let runError = null;
try {
  await Promise.all([
    ...TABLES.map((table, lane) => waiterLane(waiters[lane % waiters.length], table, lane)),
    counter(),
  ]);
} catch (error) {
  runError = error instanceof RpcError ? `${error.message}` : String(error);
  console.error(`The run stopped: ${runError}`);
}
const seconds = ((Date.now() - started) / 1000).toFixed(1);

// ===== Reconcile =====
const ids =
  [...runOrders].map((o) => `'${o}'`).join(',') || `'00000000-0000-0000-0000-000000000000'`;
const checks = [];
const check = (name, ok, detail = '') => checks.push({ name, ok, detail });

const open = Number(
  psql(`select count(*) from public.orders
                           where id in (${ids}) and status not in ('completed', 'cancelled')`),
);
check('1. every order of the run is closed', open === 0, `${open} still open`);

const [paid, completedTotal] = psql(`
  select coalesce((select sum(amount) from public.payments where order_id in (${ids}) and voided_at is null), 0)
         || '|' ||
         coalesce((select sum(total) from public.orders where id in (${ids}) and status = 'completed'), 0)`).split(
  '|',
);
check(
  '2. live payments = totals of completed orders',
  paid === completedTotal,
  `payments ${paid}, completed totals ${completedTotal} (minor units)`,
);

function roundTo(numerator, denominator, unit, mode) {
  // numerator / denominator, rounded to a multiple of `unit` (BigInt, no floats).
  const n = BigInt(numerator);
  const d = BigInt(denominator) * BigInt(unit);
  let q = n / d;
  const r = n - q * d;
  if (mode === 'up' && r > 0n) q += 1n;
  if (mode === 'half_up' && 2n * r >= d) q += 1n;
  if (mode === 'half_even' && (2n * r > d || (2n * r === d && q % 2n === 1n))) q += 1n;
  return Number(q * BigInt(unit));
}
function expectedTotals(subtotal, discount, type) {
  const s = settings;
  const net = subtotal - discount;
  const base = s.discount_reduces_charges ? net : subtotal;
  const applies = {
    dine_in: s.service_charge_on_dine_in,
    take_away: s.service_charge_on_take_away,
    delivery: s.service_charge_on_delivery,
  }[type];
  const service = applies
    ? roundTo(base * s.service_charge_bps, 10000, s.rounding_unit_minor, s.rounding_mode)
    : 0;
  if (s.prices_include_tax) {
    const tax = roundTo(
      base * s.tax_bps,
      10000 + s.tax_bps,
      s.rounding_unit_minor,
      s.rounding_mode,
    );
    const serviceTax = s.tax_on_service_charge
      ? roundTo(service * s.tax_bps, 10000, s.rounding_unit_minor, s.rounding_mode)
      : 0;
    return { service, tax: tax + serviceTax, total: net + service + serviceTax };
  }
  const tax = roundTo(
    (base + (s.tax_on_service_charge ? service : 0)) * s.tax_bps,
    10000,
    s.rounding_unit_minor,
    s.rounding_mode,
  );
  return { service, tax, total: net + service + tax };
}
const stored = psql(`
  select o.id || '|' || o.type || '|' || o.subtotal || '|' || o.discount || '|' || o.service_charge
         || '|' || o.tax || '|' || o.total || '|' ||
         coalesce((select sum(i.price_snapshot * i.quantity) from public.order_items i
                    where i.order_id = o.id and not i.is_cancelled), 0)
    from public.orders o where o.id in (${ids}) and o.status = 'completed'`)
  .split('\n')
  .filter(Boolean);
const wrong = stored.filter((row) => {
  const [, type, subtotal, discount, service, tax, total, fromLines] = row.split('|');
  const want = expectedTotals(Number(fromLines), Number(discount), type);
  return (
    Number(subtotal) !== Number(fromLines) ||
    Number(service) !== want.service ||
    Number(tax) !== want.tax ||
    Number(total) !== want.total
  );
});
check(
  '3. each total = an independent calculation from its lines',
  wrong.length === 0 && stored.length > 0,
  `${stored.length - wrong.length} of ${stored.length} completed orders match`,
);

const summaryDay =
  psql(`select business_date from public.orders where id in (${ids}) limit 1`) ||
  psql(`select private.business_date(now())`);
const numbers = psql(`select order_number from public.orders where business_date = '${summaryDay}'`)
  .split('\n')
  .filter(Boolean);
const sequence = numbers.map((n) => Number(n.split('-').at(-1))).sort((a, b) => a - b);
const unique = new Set(numbers).size === numbers.length;
const contiguous = sequence.every((value, index) => value === index + 1);
check(
  '4. order numbers unique and sequential (1..N)',
  unique && contiguous,
  `${numbers.length} orders on ${summaryDay}, highest ${sequence.at(-1)}`,
);

const stuck = psql(`select count(*) from public.restaurant_tables
                     where section = '${SECTION}' and is_active and status <> 'available'`);
const disagree = psql(`
  select count(*) from public.restaurant_tables t
   where t.is_active and (t.status <> 'available') <> exists (
         select 1 from public.orders o where o.table_id = t.id
            and o.status not in ('completed', 'cancelled'))`);
check(
  '5. no table stuck Occupied; table status agrees with open orders',
  stuck === '0' && disagree === '0',
  `${stuck} run tables not Available, ${disagree} tables disagree`,
);

const noTable = psql(`select count(*) from public.orders
                       where type = 'dine_in' and table_id is null and status not in ('completed', 'cancelled')`);
const doubled = psql(`select count(*) from (select table_id from public.orders
                       where table_id is not null and status not in ('completed', 'cancelled')
                       group by table_id having count(*) > 1) x`);
check(
  '6. no open Dine-In order without a table; one open order per table',
  noTable === '0' && doubled === '0',
  `${noTable} without a table, ${doubled} tables with two open orders`,
);

const summary = await rpc(admin.token, 'get_sales_summary', { p_business_date: summaryDay });
const independent = JSON.parse(
  psql(`
  with done as (select * from public.orders where business_date = '${summaryDay}' and status = 'completed'),
       items as (select i.menu_item_id, i.name_snapshot, i.quantity, i.line_total, i.created_at
                   from public.order_items i join done o on o.id = i.order_id where not i.is_cancelled),
       top as (select menu_item_id, sum(quantity) as quantity, sum(line_total) as sales,
                      (array_agg(name_snapshot order by created_at desc))[1] as name
                 from items group by menu_item_id
                order by sum(quantity) desc, sum(line_total) desc, 4 limit 10)
  select json_build_object(
    'orders_count', (select count(*) from done),
    'gross_sales', (select coalesce(sum(total), 0) from done),
    'net_sales', (select coalesce(sum(subtotal - discount), 0) from done),
    'discount', (select coalesce(sum(discount), 0) from done),
    'service_charge', (select coalesce(sum(service_charge), 0) from done),
    'tax', (select coalesce(sum(tax), 0) from done),
    'cancelled_count', (select count(*) from public.orders where business_date = '${summaryDay}' and status = 'cancelled'),
    'open_count', (select count(*) from public.orders where business_date = '${summaryDay}' and status not in ('completed', 'cancelled')),
    'by_type', (select json_object_agg(type, json_build_array(n, s)) from (
                  select type, count(*) n, sum(total) s from done group by type) t),
    'top_items', (select coalesce(json_agg(json_build_array(menu_item_id, quantity, sales)), '[]') from top),
    'hours_sales', (select coalesce(sum(total), 0) from done))`),
);
const fields = [
  'orders_count',
  'gross_sales',
  'net_sales',
  'discount',
  'service_charge',
  'tax',
  'cancelled_count',
  'open_count',
];
const mismatches = fields.filter((f) => Number(summary[f]) !== Number(independent[f]));
for (const row of summary.by_type) {
  const [n, s] = independent.by_type?.[row.type] ?? [0, 0];
  if (row.orders !== Number(n) || row.sales !== Number(s)) mismatches.push(`by_type.${row.type}`);
}
const topServer = summary.top_items.map((t) => [t.menu_item_id, t.quantity, t.sales].join(':'));
const topSql = independent.top_items.map((t) => t.join(':'));
if (topServer.join(',') !== topSql.join(',')) mismatches.push('top_items');
const hours = summary.by_hour.reduce((sum, h) => sum + h.sales, 0);
if (hours !== Number(independent.hours_sales)) mismatches.push('by_hour');
check(
  '7. dashboard summary = independent SQL totals',
  mismatches.length === 0,
  mismatches.length
    ? `differs: ${mismatches.join(', ')}`
    : `${fields.length} figures, by type, top 10, by hour`,
);

// ===== Tidy up (archive, never delete) =====
archiveTables(SECTION);
for (const waiter of extraWaiters) archiveStaff(waiter);
archiveStaff(admin.username);

// ===== Report =====
const passed = !runError && checks.every((c) => c.ok);
const line = (text = '') => console.log(text);
line('Simulated day (local stack)');
line('='.repeat(72));
line(
  `Orders created: ${runOrders.size} (Dine-In ${counts.dineIn}, Take Away ${counts.takeAway}) in ${seconds} s`,
);
line(
  `Waiters at once: ${waiters.length} on ${TABLES.length} tables; add-ons ${counts.addOns}; pay-first Take Away ${counts.payFirst}`,
);
line(
  `Cancelled: ${counts.cancelledOrders} orders, ${counts.cancelledLines} lines; discounts ${counts.discounts}; voids ${counts.voids}`,
);
line(
  `Payments: cash ${counts.cash}, card ${counts.card}, split ${counts.split}; double-tap replays ${counts.replays}`,
);
line('-'.repeat(72));
if (runError) line(`FAIL  the run stopped: ${runError}`);
for (const c of checks) line(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}: ${c.detail}`);
line('='.repeat(72));
line(passed ? 'RESULT: PASS' : 'RESULT: FAIL');
process.exitCode = passed ? 0 : 1;
