import type { Page } from '@playwright/test';

import { expect, test } from './fixtures';
import {
  apiAs,
  expectNoSeriousAxe,
  freeTable,
  liveDot,
  menuItemId,
  psql,
  shots,
  signInAs,
  tableId,
} from './support';

// S2 waiter app on a phone viewport against the local Supabase stack. Each test owns one
// table (freed before it starts), so tests can run in parallel. Screenshots go to $SHOTS
// (light, and dark with SHOTS_THEME=dark).
test.skip(({ isMobile }) => !isMobile, 'the waiter app is phone first: the phone project');

const theme = process.env['SHOTS_THEME'] === 'dark' ? 'dark' : 'light';

test.beforeEach(async ({ page }) => {
  await page.addInitScript((value) => {
    localStorage.setItem('theme', value);
  }, theme);
});

async function shot(page: Page, name: string) {
  if (!shots) return;
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${shots}/waiter-${name}-${theme}.png` });
}

async function openWaiter(page: Page, user = 'waiter1') {
  await signInAs(page, user);
  await expect(page).toHaveURL(/\/waiter$/);
  await expect(liveDot(page)).toBeVisible({ timeout: 10_000 });
}

/** A table tile by its accessible name ("Table 11 6 seats Available"): a link, or a button
 * for another waiter's table. */
const tile = (page: Page, number: number) => {
  const name = new RegExp(`^Table ${String(number)} `);
  return page.getByRole('link', { name }).or(page.getByRole('button', { name }));
};

test('tables: grouped by section, My tables on, live when another waiter takes a table', async ({
  page,
  request,
}) => {
  freeTable(11);
  await openWaiter(page);
  await expect(page.getByRole('heading', { name: 'Hall' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Family' })).toBeVisible();
  const mine = page.getByRole('button', { name: 'My tables' });
  await expect(mine).toHaveAttribute('aria-pressed', 'true');
  await expect(tile(page, 11)).toContainText('Available');
  await shot(page, 'tables');
  await expectNoSeriousAxe(page);

  // Another waiter takes table 11: it leaves "My tables" live (staff:tables broadcast).
  const waiter2 = await apiAs(request, 'waiter2');
  await waiter2.rpc('create_order', {
    p_request_id: crypto.randomUUID(),
    p_type: 'dine_in',
    p_table_id: tableId(11),
    p_customer_name: '',
    p_customer_phone: '',
    p_items: [{ menu_item_id: menuItemId('Plain Naan'), quantity: 1 }],
  });
  await expect(tile(page, 11)).toHaveCount(0, { timeout: 2_000 });

  await mine.click();
  await expect(mine).toHaveAttribute('aria-pressed', 'false');
  await expect(tile(page, 11)).toContainText('Occupied');
  await expect(tile(page, 11)).toContainText('Other waiter');
  await tile(page, 11).click();
  await expect(page.getByText('Table 11 is served by another waiter.')).toBeVisible();
  freeTable(11);
});

const menuRow = (page: Page, name: string) =>
  page.getByRole('main').getByRole('listitem').filter({ hasText: name });

function openOrders(number: number): number {
  return Number(
    psql(`select count(*) from public.orders o join public.restaurant_tables t on t.id = o.table_id
           where t.number = ${String(number)} and t.is_active and o.status not in ('completed', 'cancelled')`),
  );
}

test('order entry: search, categories, sold out, review with notes, a double tap sends one order', async ({
  page,
}) => {
  freeTable(2);
  await openWaiter(page);
  await tile(page, 2).click();
  await expect(page.getByRole('heading', { name: 'Table 2' })).toBeVisible();
  await expect(page.getByText('No items yet')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send to Kitchen' })).toBeDisabled();

  // Instant search over the cached menu; a Sold Out item has no button at all (BR-13).
  await page.getByRole('searchbox', { name: 'Search the menu' }).fill('tikka');
  await expect(menuRow(page, 'Chicken Tikka (Leg)')).toBeVisible();
  await expect(menuRow(page, 'Fish Tikka')).toContainText('Sold out');
  await expect(menuRow(page, 'Fish Tikka').getByRole('button')).toHaveCount(0);
  await expect(menuRow(page, 'Seekh Kebab')).toHaveCount(0);

  // Tap the row = +1, twice; then the stepper shows 2.
  await menuRow(page, 'Chicken Tikka (Leg)').getByRole('button').first().click();
  await menuRow(page, 'Chicken Tikka (Leg)').getByRole('button').first().click();
  await expect(menuRow(page, 'Chicken Tikka (Leg)').locator('output')).toHaveText('2');

  await page.getByRole('button', { name: 'Breads' }).click();
  await expect(page.getByRole('searchbox', { name: 'Search the menu' })).toHaveValue('');
  await expect(menuRow(page, 'Chicken Tikka (Leg)')).toHaveCount(0);
  await page.getByRole('button', { name: 'Add Plain Naan' }).click();
  await expect(page.getByText('3 items')).toBeVisible();
  await expect(page.getByText('The total is worked out when you send.')).toBeVisible();
  await shot(page, 'order');
  await expectNoSeriousAxe(page);

  await page.getByRole('button', { name: 'Review' }).click();
  const sheet = page.getByRole('dialog', { name: 'Review order · Table 2' });
  await expect(sheet).toBeVisible();
  await sheet.getByRole('textbox', { name: 'Note for Chicken Tikka (Leg)' }).fill('less spicy');
  await shot(page, 'review');
  await expectNoSeriousAxe(page);

  // Done criterion 7: a double tap on Send creates one order (one request, BR-15).
  const creates: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/rpc/create_order')) creates.push(r.postData() ?? '');
  });
  await sheet.getByRole('button', { name: 'Send to Kitchen' }).dblclick();
  await expect(page.getByText(/^Sent to the kitchen: ORD-\d{8}-\d{3,}$/)).toBeVisible();
  expect(creates).toHaveLength(1);
  expect(creates[0]).not.toMatch(/price|total/);
  expect(openOrders(2)).toBe(1);
  expect(
    psql(`select notes from public.order_items i join public.orders o on o.id = i.order_id
           join public.restaurant_tables t on t.id = o.table_id
          where t.number = 2 and t.is_active and o.status = 'accepted' and i.notes is not null`),
  ).toBe('less spicy');
  freeTable(2);
});

test('offline: Send is disabled, the cart is kept, nothing is sent', async ({ page, context }) => {
  freeTable(3);
  await openWaiter(page);
  await tile(page, 3).click();
  await page.getByRole('button', { name: 'Add Raita' }).click();
  const send = page.getByRole('button', { name: 'Send to Kitchen' });
  await expect(send).toBeEnabled();

  await context.setOffline(true);
  await expect(page.getByText("Offline: orders can't be sent.")).toBeVisible({ timeout: 2_000 });
  await expect(send).toBeDisabled();
  await expect(page.getByText('1 item', { exact: true })).toBeVisible();

  // Browsing and search still work from the cached menu.
  await page.getByRole('searchbox', { name: 'Search the menu' }).fill('naan');
  await expect(menuRow(page, 'Garlic Naan')).toBeVisible();

  await context.setOffline(false);
  await expect(liveDot(page)).toBeVisible({ timeout: 15_000 });
  await expect(send).toBeEnabled();
  await expect(page.getByText('1 item', { exact: true })).toBeVisible();
  expect(openOrders(3)).toBe(0);

  // The cart lives on the device: a reload keeps it.
  await page.reload();
  await expect(page.getByText('1 item', { exact: true })).toBeVisible();
});

test('an item marked Sold Out elsewhere greys out live and blocks Send', async ({
  page,
  request,
}) => {
  freeTable(4);
  const chef = await apiAs(request, 'chef');
  const garlicNaan = menuItemId('Garlic Naan');
  try {
    await openWaiter(page);
    await tile(page, 4).click();
    await page.getByRole('button', { name: 'Add Garlic Naan' }).click();
    await chef.rpc('set_item_availability', {
      p_request_id: crypto.randomUUID(),
      p_menu_item_id: garlicNaan,
      p_is_available: false,
    });
    // Done criterion 4: within 2 seconds (staff:menu broadcast).
    await expect(menuRow(page, 'Garlic Naan')).toContainText('Sold out', { timeout: 2_000 });
    await expect(page.getByRole('button', { name: 'Send to Kitchen' })).toBeDisabled();
    await expect(page.getByText('Remove the sold-out items to send.')).toBeVisible();
    await page.getByRole('button', { name: 'Review' }).click();
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByText('Sold out: remove it to send.')).toBeVisible();
    await sheet.getByRole('button', { name: 'Remove Garlic Naan' }).click();
    await expect(sheet.getByText('No items yet. Tap a menu item to add it.')).toBeVisible();
  } finally {
    await chef.rpc('set_item_availability', {
      p_request_id: crypto.randomUUID(),
      p_menu_item_id: garlicNaan,
      p_is_available: true,
    });
  }
});
