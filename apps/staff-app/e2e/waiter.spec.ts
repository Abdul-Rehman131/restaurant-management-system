import type { APIRequestContext, Browser, Page } from '@playwright/test';

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
  // Toasts close by themselves; the screenshot shows the screen, not the last toast.
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0, { timeout: 10_000 });
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

interface KitchenTicket {
  batch_id: string;
  order_number: string;
  batch_no: number;
}

/** The chef's tablet: a second signed-in page on the kitchen screen, using the S1 RPCs. */
async function chefDevice(browser: Browser, request: APIRequestContext) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signInAs(page, 'chef');
  await expect(page).toHaveURL(/\/kitchen$/);
  const chef = await apiAs(request, 'chef');
  const ticket = async (orderNumber: string, batchNo: number) => {
    const queue = await chef.rpc<{ tickets: KitchenTicket[] }>('get_kitchen_queue');
    const found = queue.tickets.find(
      (t) => t.order_number === orderNumber && t.batch_no === batchNo,
    );
    if (!found) throw new Error(`no kitchen ticket for ${orderNumber} batch ${String(batchNo)}`);
    return found.batch_id;
  };
  const setBatch = async (orderNumber: string, batchNo: number, status: 'preparing' | 'ready') => {
    await chef.rpc('set_batch_status', {
      p_request_id: crypto.randomUUID(),
      p_batch_id: await ticket(orderNumber, batchNo),
      p_status: status,
    });
  };
  return { setBatch, close: () => context.close() };
}

/** Free table, waiter1 sends a quick order from the UI; returns the order number. */
async function sendOrder(page: Page, number: number, items: string[], signedIn = false) {
  freeTable(number);
  if (!signedIn) await openWaiter(page);
  await tile(page, number).click();
  for (const item of items) await page.getByRole('button', { name: `Add ${item}` }).click();
  await page.getByRole('button', { name: 'Send to Kitchen' }).click();
  const toastText = await page.getByText(/^Sent to the kitchen: ORD-/).textContent();
  return (toastText ?? '').replace('Sent to the kitchen: ', '');
}

test('existing order: kitchen status live, Served, Request Bill, add-on batch, move table', async ({
  page,
  browser,
  request,
}) => {
  freeTable(6);
  const orderNumber = await sendOrder(page, 5, ['Seekh Kebab (4 pcs)', 'Soft Drink (Can)']);
  const firstSend = page.getByRole('region', { name: 'First send' });
  await expect(firstSend).toContainText('Sent');
  await expect(firstSend).toContainText('Soft Drink (Can)');
  await expect(firstSend).toContainText('No kitchen');
  await expect(page.getByText('To cancel an item, ask the cashier.')).toBeVisible();
  await expect(page.getByText('Total', { exact: true })).toBeVisible();

  const kitchen = await chefDevice(browser, request);
  try {
    await kitchen.setBatch(orderNumber, 1, 'preparing');
    await expect(firstSend).toContainText('Preparing', { timeout: 2_000 });
    await kitchen.setBatch(orderNumber, 1, 'ready');
    await expect(firstSend).toContainText('Ready', { timeout: 2_000 });
    await shot(page, 'existing-order');
    await expectNoSeriousAxe(page);

    await page.getByRole('button', { name: 'Mark served' }).click();
    await expect(page.getByText('Table 5 marked served')).toBeVisible();
    await expect(firstSend).toContainText('Served');

    await page.getByRole('button', { name: 'Request bill' }).click();
    await expect(page.getByText('The cashier has the bill request for table 5')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Bill requested' }).first()).toBeDisabled();

    // Add more items: a new batch, the kitchen's ADD-ON (BR-06); it clears the bill request.
    await page.getByRole('link', { name: 'Add more items' }).click();
    await expect(page.getByText(`Adding to ${orderNumber}`)).toBeVisible();
    await page.getByRole('button', { name: 'Add Garlic Naan' }).click();
    await page.getByRole('button', { name: 'Send add-on' }).click();
    await expect(page.getByText('Add-on 2 sent to the kitchen')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Add-on 2' })).toContainText('Garlic Naan');
    await expect(page.getByRole('button', { name: 'Request bill' })).toBeEnabled();

    await page.getByRole('button', { name: 'Move table' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Table 6' }).click();
    await expect(page.getByText('Moved to table 6')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Table 6' })).toBeVisible();
    expect(openOrders(5)).toBe(0);
    expect(openOrders(6)).toBe(1);
  } finally {
    await kitchen.close();
    freeTable(5);
    freeTable(6);
  }
});

test('orders tab: my open orders with status, opens the table', async ({ page }) => {
  const orderNumber = await sendOrder(page, 7, ['Chicken Corn Soup']);
  await page.getByRole('link', { name: 'Back to tables' }).click();
  await page
    .getByRole('navigation', { name: 'Waiter' })
    .getByRole('link', { name: 'Orders' })
    .click();
  const card = page.getByRole('link', { name: new RegExp(`Table 7 .*${orderNumber}`) });
  await expect(card).toContainText('Accepted');
  await shot(page, 'orders');
  await expectNoSeriousAxe(page);
  await card.click();
  await expect(page.getByRole('heading', { name: 'Table 7' })).toBeVisible();
  freeTable(7);
});

test('Ready alert: start shift, chef marks Preparing and Ready, tone, vibration and banner; mute', async ({
  page,
  browser,
  request,
}) => {
  // Count the tones (oscillators) and vibrations the app asks for.
  await page.addInitScript(() => {
    const w = window as unknown as { tones: number; vibrations: number };
    w.tones = 0;
    w.vibrations = 0;
    window.AudioContext = class extends AudioContext {
      override createOscillator() {
        w.tones += 1;
        return super.createOscillator();
      }
    };
    navigator.vibrate = () => {
      w.vibrations += 1;
      return true;
    };
  });
  const counts = () =>
    page.evaluate(() => {
      const w = window as unknown as { tones: number; vibrations: number };
      return { tones: w.tones, vibrations: w.vibrations };
    });

  freeTable(8);
  await openWaiter(page);
  await page.getByRole('button', { name: 'Start shift' }).click();
  await expect(page.getByRole('button', { name: 'Mute alerts' })).toBeVisible();
  const orderNumber = await sendOrder(page, 8, ['Chicken Malai Boti'], true);
  await page.getByRole('link', { name: 'Back to tables' }).click();

  const kitchen = await chefDevice(browser, request);
  try {
    await kitchen.setBatch(orderNumber, 1, 'preparing');
    await kitchen.setBatch(orderNumber, 1, 'ready');
    // Done criterion 2: the Ready alert reaches the waiter within 2 seconds.
    const banner = page.getByText('Table 8 is ready');
    await expect(banner).toBeVisible({ timeout: 2_000 });
    await expect(page.getByText('First send is ready to serve')).toBeVisible();
    expect(await counts()).toEqual({ tones: 2, vibrations: 1 });
    await expect(page.getByRole('link', { name: /Alerts/ })).toContainText('1 new alert');
    await shot(page, 'alert-banner');
    await expectNoSeriousAxe(page);

    await page.getByRole('button', { name: 'Open' }).click();
    await expect(page.getByRole('heading', { name: 'Table 8' })).toBeVisible();
    await expect(banner).toBeHidden();
    await page.getByRole('button', { name: 'Mark served' }).click();
    await expect(page.getByText('Table 8 marked served')).toBeVisible();
    await page.getByRole('button', { name: 'Request bill' }).click();
    await expect(page.getByText('The cashier has the bill request for table 8')).toBeVisible();
    expect(
      psql(`select o.status || ' ' || o.bill_requested from public.orders o
             where o.order_number = '${orderNumber}'`),
    ).toBe('served true');

    // Muted: the next Ready shows the banner and vibrates, but plays no tone.
    await page.getByRole('button', { name: 'Mute alerts' }).click();
    await expect(page.getByRole('button', { name: 'Turn alert sound on' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.getByRole('link', { name: 'Add more items' }).click();
    await page.getByRole('button', { name: 'Add Tandoori Roti' }).click();
    await page.getByRole('button', { name: 'Send add-on' }).click();
    await expect(page.getByText('Add-on 2 sent to the kitchen')).toBeVisible();
    await kitchen.setBatch(orderNumber, 2, 'preparing');
    await kitchen.setBatch(orderNumber, 2, 'ready');
    await expect(page.getByText('Add-on 2 is ready to serve')).toBeVisible({ timeout: 2_000 });
    expect(await counts()).toEqual({ tones: 2, vibrations: 2 });

    // The bottom nav is hidden on a table's screens (a full-screen task).
    await page.getByRole('link', { name: 'Back to tables' }).click();

    await page
      .getByRole('navigation', { name: 'Waiter' })
      .getByRole('link', { name: /Alerts/ })
      .click();
    await expect(page.getByRole('heading', { name: 'Shift started' })).toBeVisible();
    await expect(page.getByRole('link', { name: /Table 8 is ready/ })).toHaveCount(2);
    await shot(page, 'alerts');
    await expectNoSeriousAxe(page);
    await page.getByRole('button', { name: 'Mark all as read' }).click();
    await expect(page.getByText('New', { exact: true })).toHaveCount(0);
  } finally {
    await kitchen.close();
    freeTable(8);
  }
});
