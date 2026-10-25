import { devices, type APIRequestContext, type Page } from '@playwright/test';

import { expect, test } from './fixtures';
import {
  animationsDone,
  apiAs,
  archiveTable,
  createTable,
  expectNoSeriousAxe,
  liveDot,
  menuItemId,
  psql,
  shots,
  signInAs,
  tableId,
} from './support';

// S4 cashier on a desktop (the desktop project only, playwright.config.ts) against the local
// Supabase stack. Every test owns its tables (101 and up, created and archived here) and its
// Take Away customer names, so tests can run in parallel. Screenshots go to $SHOTS.

async function openCashier(page: Page, user: 'cashier' | 'admin' = 'cashier') {
  await signInAs(page, user);
  if (user === 'admin') await page.goto('/cashier');
  await expect(page).toHaveURL(/\/cashier$/);
  await expect(liveDot(page)).toBeVisible();
}

async function shot(page: Page, name: string) {
  if (!shots) return;
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);
  await animationsDone(page);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${shots}/cashier-${name}.png` });
}

/** A Dine-In order on a test table, sent by waiter2 as another device would. */
async function dineInOrder(request: APIRequestContext, table: number, items: string[]) {
  const waiter = await apiAs(request, 'waiter2');
  const order = await waiter.rpc<{ order_id: string; order_number: string; total: number }>(
    'create_order',
    {
      p_request_id: crypto.randomUUID(),
      p_type: 'dine_in',
      p_table_id: tableId(table),
      p_customer_name: '',
      p_customer_phone: '',
      p_items: items.map((item) => ({ menu_item_id: menuItemId(item), quantity: 1 })),
    },
  );
  return { waiter, ...order };
}

test('a bill requested by the waiter is first in the list within 2 s, with a badge', async ({
  page,
  request,
}) => {
  createTable(101);
  createTable(102);
  try {
    const older = await dineInOrder(request, 101, ['Chicken Corn Soup']);
    const newer = await dineInOrder(request, 102, ['Raita']);
    await openCashier(page);
    const rows = page.locator('[data-bill-row]');
    await expect(rows.filter({ hasText: 'Table 102' })).toBeVisible();

    await newer.waiter.rpc('request_bill', {
      p_request_id: crypto.randomUUID(),
      p_order_id: newer.order_id,
    });
    // Bill Requested first (plan 4.5), within 2 seconds (staff:orders broadcast).
    await expect(rows.first()).toContainText('Table 102', { timeout: 2_000 });
    await expect(rows.first()).toContainText('Bill requested');
    await expect(page.getByText('1 new bill request')).toBeVisible();
    await expect(rows.filter({ hasText: 'Table 101' })).toContainText(older.order_number);
    await shot(page, 'open-bills');
    await expectNoSeriousAxe(page);
  } finally {
    archiveTable(101);
    archiveTable(102);
  }
});

test('the waiter and the chef cannot reach cashier data', async ({ request }) => {
  for (const user of ['waiter1', 'chef']) {
    const staff = await apiAs(request, user);
    await expect(staff.rpc('get_open_bills')).rejects.toThrow('NOT_AUTHORIZED');
    await expect(
      staff.rpc('record_payment', {
        p_request_id: crypto.randomUUID(),
        p_order_id: crypto.randomUUID(),
        p_tenders: [{ method: 'cash', amount: 100, tendered: 100 }],
      }),
    ).rejects.toThrow('NOT_AUTHORIZED');
    // RLS: payments, cost data and other people's orders are not theirs to read.
    expect(await staff.select('payments?select=id,amount')).toEqual([]);
  }
  const chef = await apiAs(request, 'chef');
  expect(await chef.select('orders?select=id,total')).toEqual([]);
  expect(await chef.select('order_items?select=id,price_snapshot')).toEqual([]);
});

/** The kitchen and the waiter move a Dine-In order to Served, as their devices would. */
async function serve(
  request: APIRequestContext,
  order: { order_id: string; order_number: string },
) {
  const chef = await apiAs(request, 'chef');
  const queue = await chef.rpc<{ tickets: { batch_id: string; order_number: string }[] }>(
    'get_kitchen_queue',
  );
  for (const ticket of queue.tickets.filter((t) => t.order_number === order.order_number)) {
    for (const status of ['preparing', 'ready']) {
      await chef.rpc('set_batch_status', {
        p_request_id: crypto.randomUUID(),
        p_batch_id: ticket.batch_id,
        p_status: status,
      });
    }
  }
  const waiter = await apiAs(request, 'waiter2');
  await waiter.rpc('set_order_status', {
    p_request_id: crypto.randomUUID(),
    p_order_id: order.order_id,
    p_status: 'served',
  });
}

/** A Take Away order from the counter (cashier API), for payment tests. */
async function takeAway(request: APIRequestContext, name: string, items: string[]) {
  const cashier = await apiAs(request, 'cashier');
  return cashier.rpc<{ order_id: string; order_number: string; total: number }>('create_order', {
    p_request_id: crypto.randomUUID(),
    p_type: 'take_away',
    p_table_id: null,
    p_customer_name: name,
    p_customer_phone: '',
    p_items: items.map((item) => ({ menu_item_id: menuItemId(item), quantity: 1 })),
  });
}

/** Cancels the open Take Away orders of one test (its own name prefix). */
function cancelTakeAway(prefix: string) {
  const open = `select id from public.orders where customer_name like '${prefix}%'
                  and status not in ('completed', 'cancelled')`;
  psql(`
    update public.order_batches set status = 'cancelled'
     where order_id in (${open}) and status not in ('served', 'cancelled');
    update public.orders set status = 'cancelled', cancel_reason = 'e2e reset', cancelled_at = now()
     where id in (${open});`);
}

/** The live payments of an order as "method:amount:tendered", in tender order. */
const payments = (orderId: string) =>
  psql(`select coalesce(string_agg(method || ':' || amount || ':' || coalesce(tendered::text, '-'),
                                   ',' order by tender_no), '')
          from public.payments where order_id = '${orderId}' and voided_at is null`);

async function openBill(page: Page, name: string) {
  await page.locator('[data-bill-row]').filter({ hasText: name }).click();
  await expect(page.getByRole('heading', { name, level: 2 })).toBeVisible();
}

test('exact cash completes a served Dine-In order and frees the table for the waiter', async ({
  page,
  browser,
  request,
}) => {
  test.slow();
  createTable(103);
  const waiterContext = await browser.newContext({ ...devices['Pixel 7'] });
  try {
    const order = await dineInOrder(request, 103, ['Chicken Tikka (Leg)', 'Soft Drink (Can)']);
    await serve(request, order);
    const waiterPage = await waiterContext.newPage();
    await signInAs(waiterPage, 'waiter2');
    const tile = waiterPage.getByRole('link', { name: /^Table 103 / });
    await expect(tile).toContainText('Occupied');

    await openCashier(page);
    await openBill(page, 'Table 103');
    await expect(page.locator('[data-line]')).toHaveCount(2);
    await shot(page, 'bill-detail');
    await expectNoSeriousAxe(page);
    await page.getByRole('button', { name: 'Exact' }).click();
    await page.getByRole('button', { name: /^Pay/ }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Payment recorded' })).toContainText(
      'The order is complete. The table is free again.',
    );
    expect(payments(order.order_id)).toBe(`cash:${String(order.total)}:${String(order.total)}`);
    // The waiter's tile turns Available within 2 seconds (staff:tables broadcast).
    await expect(tile).toContainText('Available', { timeout: 2_000 });
  } finally {
    await waiterContext.close();
    archiveTable(103);
  }
});

test('cash with change, card with a reference, and a split', async ({ page, request }) => {
  cancelTakeAway('E2E Pay');
  const cash = await takeAway(request, 'E2E Pay Cash', ['Chicken Biryani']);
  const card = await takeAway(request, 'E2E Pay Card', ['Vegetable Pulao']);
  const split = await takeAway(request, 'E2E Pay Split', ['Palak Paneer', 'Plain Naan']);
  try {
    await openCashier(page);

    // Cash: Rs 2,000 received; the change is shown large before and after paying.
    await openBill(page, 'E2E Pay Cash');
    await page.getByLabel('Cash received').fill('2000');
    await expect(page.getByTestId('change-due')).toBeVisible();
    await page.getByRole('button', { name: /^Pay/ }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Payment recorded' })).toContainText(
      'Change due',
    );
    expect(payments(cash.order_id)).toBe(`cash:${String(cash.total)}:200000`);

    // Card with a reference (key 2 chooses Card).
    await openBill(page, 'E2E Pay Card');
    await page.keyboard.press('2');
    await expect(page.getByRole('radio', { name: /Card/ })).toHaveAttribute('aria-checked', 'true');
    await page.getByLabel('Card reference (optional)').fill('AUTH 4242');
    await page.getByRole('button', { name: /^Pay/ }).click();
    await expect(page.getByText('Payment recorded')).toBeVisible();
    expect(payments(card.order_id)).toBe(`card:${String(card.total)}:-`);

    // Split (key S): Rs 500 cash received for a Rs 500 cash part, the rest on card.
    await openBill(page, 'E2E Pay Split');
    await page.keyboard.press('s');
    await page.getByLabel('Cash part').fill('500');
    await page.getByLabel('Cash received').fill('500');
    await expect(page.getByLabel('Card part')).toHaveValue(
      ((split.total - 50000) / 100).toFixed(2),
    );
    await shot(page, 'split-payment');
    await page.getByRole('button', { name: /^Pay/ }).click();
    await expect(page.getByText('Payment recorded')).toBeVisible();
    expect(payments(split.order_id)).toBe(`cash:50000:50000,card:${String(split.total - 50000)}:-`);
  } finally {
    cancelTakeAway('E2E Pay');
  }
});

test('a mismatch or too little cash writes nothing; a double click pays once', async ({
  page,
  request,
}) => {
  cancelTakeAway('E2E Guard');
  const order = await takeAway(request, 'E2E Guard', ['Chicken Karahi (Half)']);
  try {
    await openCashier(page);
    await openBill(page, 'E2E Guard');

    // Split parts that do not add up: refused in plain words, nothing written.
    await page.keyboard.press('s');
    await page.getByLabel('Cash part').fill('100');
    await page.getByLabel('Card part').fill('100');
    await page.getByRole('button', { name: /^Pay/ }).click();
    await expect(page.getByRole('alert')).toHaveText(
      'The payments must add up to the total exactly.',
    );
    expect(payments(order.order_id)).toBe('');

    // Too little cash: refused, nothing written.
    await page.keyboard.press('1');
    await page.getByLabel('Cash received').fill('10');
    await expect(page.getByText('Less than the amount due.')).toBeVisible();
    await page.getByRole('button', { name: /^Pay/ }).click();
    await expect(page.getByRole('alert')).toHaveText(
      'The cash received must be at least the cash amount.',
    );
    expect(payments(order.order_id)).toBe('');

    // A double click on Pay sends one request and records one payment (BR-15).
    const calls: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/rpc/record_payment') && r.method() === 'POST') calls.push(r.url());
    });
    await page.getByRole('button', { name: 'Exact' }).click();
    await page.getByRole('button', { name: /^Pay/ }).dblclick();
    await expect(page.getByText('Payment recorded')).toBeVisible();
    expect(calls).toHaveLength(1);
    expect(payments(order.order_id)).toBe(`cash:${String(order.total)}:${String(order.total)}`);
  } finally {
    cancelTakeAway('E2E Guard');
  }
});
