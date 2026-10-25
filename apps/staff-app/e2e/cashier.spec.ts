import type { APIRequestContext, Page } from '@playwright/test';

import { expect, test } from './fixtures';
import {
  animationsDone,
  apiAs,
  archiveTable,
  createTable,
  expectNoSeriousAxe,
  liveDot,
  menuItemId,
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
