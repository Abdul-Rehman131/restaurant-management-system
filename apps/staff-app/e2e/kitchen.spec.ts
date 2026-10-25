import { devices, type Browser, type Page } from '@playwright/test';

import { expect, test } from './fixtures';
import {
  animationsDone,
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

// S3 kitchen screen on a landscape tablet (the tablet project only, playwright.config.ts)
// against the local Supabase stack. The waiter side is waiter2 on a phone, so these tests
// never add Ready alerts to waiter1's screens in waiter.spec.ts. Tables 1, 9, 10 and 12 and
// the items below are not used by waiter.spec.ts. Screenshots go to $SHOTS.

/** Money at any depth of a response the chef receives (G6): never allowed. */
const MONEY_KEY = /price|cost|total|subtotal|tax|discount|amount|service_charge|_bps|tender|paid/i;

function moneyKeys(value: unknown, path = ''): string[] {
  if (Array.isArray(value)) return value.flatMap((v, i) => moneyKeys(v, `${path}[${String(i)}]`));
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, v]) => [
      ...(MONEY_KEY.test(key) ? [`${path}.${key}`] : []),
      ...moneyKeys(v, `${path}.${key}`),
    ]);
  }
  return [];
}

/** Records every API answer and every Realtime frame the chef's page receives. */
function watchForMoney(page: Page) {
  const found: string[] = [];
  const check = (source: string, text: string) => {
    try {
      found.push(...moneyKeys(JSON.parse(text)).map((key) => `${source} ${key}`));
    } catch {
      // Not JSON (a heartbeat or an empty body).
    }
  };
  page.on('response', (response) => {
    if (!response.url().includes(':54321/')) return;
    void response.text().then(
      (text) => {
        check(response.url(), text);
      },
      () => null,
    );
  });
  page.on('websocket', (socket) => {
    socket.on('framereceived', ({ payload }) => {
      check('realtime', String(payload));
    });
  });
  return found;
}

async function openKitchen(page: Page) {
  await signInAs(page, 'chef');
  await expect(page).toHaveURL(/\/kitchen$/);
  await expect(liveDot(page)).toBeVisible();
}

/** The waiter's phone: waiter2 on the waiter app (a second browser context). */
async function waiterPhone(browser: Browser) {
  const context = await browser.newContext({ ...devices['Pixel 7'] });
  const page = await context.newPage();
  await signInAs(page, 'waiter2');
  await expect(page).toHaveURL(/\/waiter$/);
  await expect(liveDot(page)).toBeVisible();
  return { page, close: () => context.close() };
}

/** A kitchen ticket by its accessible name ("Table 9", a customer name, an order number). */
const ticket = (page: Page, name: string | RegExp) => page.getByRole('article', { name });

async function shot(page: Page, name: string) {
  if (!shots) return;
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);
  await animationsDone(page);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${shots}/kitchen-${name}.png`, fullPage: name === 'board' });
}

/**
 * Take Away orders a test creates through the cashier, cancelled afterwards. Each test has its
 * own name prefix, so tests running in parallel never cancel each other's orders.
 */
function cancelTakeAway(prefix: string) {
  const open = `select id from public.orders where customer_name like '${prefix}%'
                  and status not in ('completed', 'cancelled')`;
  psql(`
    update public.order_batches set status = 'cancelled'
     where order_id in (${open}) and status not in ('served', 'cancelled');
    update public.orders set status = 'cancelled', cancel_reason = 'e2e reset', cancelled_at = now()
     where id in (${open});`);
}

async function takeAway(cashier: Awaited<ReturnType<typeof apiAs>>, name: string, item: string) {
  return cashier.rpc<{ order_id: string; order_number: string }>('create_order', {
    p_request_id: crypto.randomUUID(),
    p_type: 'take_away',
    p_table_id: null,
    p_customer_name: name,
    p_customer_phone: '',
    p_items: [{ menu_item_id: menuItemId(item), quantity: 1 }],
  });
}

test('the order loop: waiter sends, kitchen within 2 s, Start, Ready, alert, ADD-ON; no money', async ({
  page,
  browser,
}) => {
  test.slow();
  freeTable(9);
  const money = watchForMoney(page);
  await openKitchen(page);
  const waiter = await waiterPhone(browser);
  try {
    await waiter.page.getByRole('button', { name: 'Start shift' }).click();
    await waiter.page.getByRole('link', { name: /^Table 9 / }).click();
    await waiter.page.getByRole('button', { name: 'Add Chicken Wings (6 pcs)' }).click();
    await waiter.page.getByRole('button', { name: 'Add Mineral Water (500 ml)' }).click();
    await waiter.page.getByRole('button', { name: 'Review' }).click();
    await waiter.page
      .getByRole('textbox', { name: 'Note for Chicken Wings (6 pcs)' })
      .fill('extra crisp');
    await waiter.page.getByRole('dialog').getByRole('button', { name: 'Send to Kitchen' }).click();
    const sent = await waiter.page.getByText(/^Sent to the kitchen: ORD-/).textContent();
    const orderNumber = (sent ?? '').replace('Sent to the kitchen: ', '');

    // Done criterion 2: on the kitchen screen within 2 seconds, with the note; the bottled
    // water never reaches the kitchen (BR-07).
    const card = ticket(page, 'Table 9');
    await expect(card).toBeVisible({ timeout: 2_000 });
    await expect(card).toContainText('Chicken Wings (6 pcs)');
    await expect(card).toContainText('extra crisp');
    await expect(card).toContainText(orderNumber);
    await expect(card).not.toContainText('Mineral Water');
    await expect(card).toHaveAttribute('data-band', 'fresh');
    await expect(card).toContainText('On time');

    await card.getByRole('button', { name: 'Start Table 9' }).click();
    await expect(card).toContainText('Preparing');
    await card.getByRole('button', { name: 'Ready Table 9' }).click();
    await expect(card).toContainText('Ready: sent to the waiter');

    // Done criterion 2: the Ready alert reaches the waiter within 2 seconds.
    await expect(waiter.page.getByText('Table 9 is ready')).toBeVisible({ timeout: 2_000 });

    // The Ready ticket leaves the board after a few seconds, into Recently ready.
    const recent = page.getByRole('region', { name: 'Recently ready' });
    await expect(recent).toContainText('Table 9');
    await expect(card).toHaveCount(0);

    // Add more items: the kitchen sees only the new batch, marked ADD-ON (BR-06).
    await waiter.page.getByRole('button', { name: 'Open' }).click();
    await waiter.page.getByRole('link', { name: 'Add more items' }).click();
    await waiter.page.getByRole('button', { name: 'Add Mixed BBQ Platter' }).click();
    await waiter.page.getByRole('button', { name: 'Send add-on' }).click();
    const addOn = ticket(page, 'Table 9');
    await expect(addOn).toBeVisible({ timeout: 2_000 });
    await expect(addOn).toContainText(`ADD-ON for ${orderNumber}`);
    await expect(addOn).toContainText('Mixed BBQ Platter');
    await expect(addOn).not.toContainText('Chicken Wings');
    await expectNoSeriousAxe(page);

    // G6: no price, cost or total reached the chef, in any answer or Realtime frame.
    expect(money).toEqual([]);
  } finally {
    await waiter.close();
    freeTable(9);
  }
});

test('a drinks-only order never reaches the kitchen (BR-07)', async ({ page, browser }) => {
  freeTable(10);
  await openKitchen(page);
  const waiter = await waiterPhone(browser);
  try {
    await waiter.page.getByRole('link', { name: /^Table 10 / }).click();
    await waiter.page.getByRole('button', { name: 'Add Soft Drink (1.5 L)' }).click();
    await waiter.page.getByRole('button', { name: 'Send to Kitchen' }).click();
    await expect(waiter.page.getByText(/^Sent to the kitchen: ORD-/)).toBeVisible();
    // A fresh queue after the order exists: reload and wait for its answer.
    const reloaded = page.waitForResponse((r) => r.url().includes('/rpc/get_kitchen_queue'));
    await page.reload();
    await reloaded;
    await expect(
      page
        .getByRole('list', { name: 'Kitchen tickets' })
        .or(page.getByText('No tickets right now')),
    ).toBeVisible();
    await expect(ticket(page, 'Table 10')).toHaveCount(0);
    // The server agrees: no ticket for table 10 in the chef's queue.
    expect(
      psql(`select count(*) from public.order_batches b join public.orders o on o.id = b.order_id
             join public.restaurant_tables t on t.id = o.table_id
            where t.number = 10 and t.is_active and o.status not in ('completed', 'cancelled')
              and exists (select 1 from public.order_items i where i.order_id = o.id and i.needs_kitchen)`),
    ).toBe('0');
  } finally {
    await waiter.close();
    freeTable(10);
  }
});

test('age colours from the settings: green, amber and red, each with minutes and a word; ADD-ON', async ({
  page,
  request,
}) => {
  cancelTakeAway('E2E Age');
  const cashier = await apiAs(request, 'cashier');
  freeTable(1);
  const waiter = await apiAs(request, 'waiter2');
  const fresh = await takeAway(cashier, 'E2E Age Green', 'Chicken Biryani');
  const amber = await takeAway(cashier, 'E2E Age Amber', 'Chicken Malai Boti');
  const red = await takeAway(cashier, 'E2E Age Red', 'Daal Makhani');
  // An ADD-ON for the screenshot: table 1 (no other test uses it) with a second batch.
  const dineIn = await waiter.rpc<{ order_id: string }>('create_order', {
    p_request_id: crypto.randomUUID(),
    p_type: 'dine_in',
    p_table_id: tableId(1),
    p_customer_name: '',
    p_customer_phone: '',
    p_items: [{ menu_item_id: menuItemId('Seekh Kebab (4 pcs)'), quantity: 2 }],
  });
  await waiter.rpc('add_items_to_order', {
    p_request_id: crypto.randomUUID(),
    p_order_id: dineIn.order_id,
    p_items: [{ menu_item_id: menuItemId('Garlic Naan'), quantity: 3, notes: 'well done' }],
  });
  // kitchen_warn_min 10 and kitchen_late_min 20 in the seed settings.
  psql(`update public.order_batches set sent_at = now() - interval '12 minutes'
         where order_id = '${amber.order_id}';
        update public.order_batches set sent_at = now() - interval '25 minutes'
         where order_id = '${red.order_id}';
        update public.order_batches set sent_at = now() - interval '1 minute'
         where order_id = '${fresh.order_id}';`);
  try {
    await openKitchen(page);
    await expect(ticket(page, 'E2E Age Green')).toHaveAttribute('data-band', 'fresh');
    await expect(ticket(page, 'E2E Age Green')).toContainText('1 min · On time');
    await expect(ticket(page, 'E2E Age Amber')).toHaveAttribute('data-band', 'aging');
    await expect(ticket(page, 'E2E Age Amber')).toContainText('12 min · Waiting');
    await expect(ticket(page, 'E2E Age Red')).toHaveAttribute('data-band', 'late');
    await expect(ticket(page, 'E2E Age Red')).toContainText('25 min · Late');
    await expect(ticket(page, 'E2E Age Red')).toContainText('Take Away');
    await expect(page.getByText(/^ADD-ON for ORD-/).first()).toBeVisible();
    await shot(page, 'board');
    await expectNoSeriousAxe(page);
  } finally {
    cancelTakeAway('E2E Age');
    freeTable(1);
  }
});

test('the kitchen cannot skip Preparing; a stale ticket explains itself', async ({
  page,
  request,
}) => {
  cancelTakeAway('E2E Stale');
  const cashier = await apiAs(request, 'cashier');
  const chef = await apiAs(request, 'chef');
  await takeAway(cashier, 'E2E Stale', 'Vegetable Pulao');
  try {
    await openKitchen(page);
    const card = ticket(page, 'E2E Stale');
    await expect(card.getByRole('button', { name: 'Start E2E Stale' })).toBeVisible();
    // The screen offers only Start for a new ticket; the server refuses Sent to Ready too.
    const queue = await chef.rpc<{ tickets: { batch_id: string; customer_name: string | null }[] }>(
      'get_kitchen_queue',
    );
    const batchId = queue.tickets.find((t) => t.customer_name === 'E2E Stale')?.batch_id ?? '';
    await expect(
      chef.rpc('set_batch_status', {
        p_request_id: crypto.randomUUID(),
        p_batch_id: batchId,
        p_status: 'ready',
      }),
    ).rejects.toThrow('BATCH_TRANSITION_NOT_ALLOWED');

    // Another kitchen device moves the ticket on while this screen still shows it as new
    // (its queue reloads are held back): Start is refused in plain words, not a code.
    await page.route('**/rpc/get_kitchen_queue', (route) => route.abort());
    await chef.rpc('set_batch_status', {
      p_request_id: crypto.randomUUID(),
      p_batch_id: batchId,
      p_status: 'preparing',
    });
    await chef.rpc('set_batch_status', {
      p_request_id: crypto.randomUUID(),
      p_batch_id: batchId,
      p_status: 'ready',
    });
    await card.getByRole('button', { name: 'Start E2E Stale' }).click();
    await expect(card.getByRole('alert')).toHaveText(
      'That kitchen ticket has moved on. Check its status and try again.',
    );
  } finally {
    await page.unroute('**/rpc/get_kitchen_queue');
    cancelTakeAway('E2E Stale');
  }
});

test('Sold Out sheet: the chef switches an item off and the waiter sees it within 2 s', async ({
  page,
  browser,
  request,
}) => {
  freeTable(12);
  const chef = await apiAs(request, 'chef');
  const roghni = menuItemId('Roghni Naan');
  const money = watchForMoney(page);
  await openKitchen(page);
  const waiter = await waiterPhone(browser);
  try {
    await waiter.page.getByRole('link', { name: /^Table 12 / }).click();
    const waiterRow = waiter.page
      .getByRole('main')
      .getByRole('listitem')
      .filter({ hasText: 'Roghni Naan' });
    await expect(waiterRow.getByRole('button', { name: 'Add Roghni Naan' })).toBeVisible();

    await page.getByRole('button', { name: 'Sold out list' }).click();
    const sheet = page.getByRole('dialog', { name: 'Sold out list' });
    await sheet.getByRole('searchbox', { name: 'Search the menu' }).fill('naan');
    const toggle = sheet.getByRole('switch', { name: 'Roghni Naan' });
    await expect(toggle).toBeChecked();
    await shot(page, 'sold-out-sheet');
    await expectNoSeriousAxe(page);
    await toggle.click();
    await expect(toggle).not.toBeChecked();
    await expect(sheet.getByRole('listitem').filter({ hasText: 'Roghni Naan' })).toContainText(
      'Sold out',
    );

    // Done criterion 4: on the waiter's screen within 2 seconds, and it cannot be added.
    await expect(waiterRow).toContainText('Sold out', { timeout: 2_000 });
    await expect(waiterRow.getByRole('button')).toHaveCount(0);

    await toggle.click();
    await expect(toggle).toBeChecked();
    await expect(waiterRow.getByRole('button', { name: 'Add Roghni Naan' })).toBeVisible({
      timeout: 2_000,
    });
    expect(money).toEqual([]);
  } finally {
    await chef.rpc('set_item_availability', {
      p_request_id: crypto.randomUUID(),
      p_menu_item_id: roghni,
      p_is_available: true,
    });
    await waiter.close();
    freeTable(12);
  }
});

test('offline: the banner shows and every kitchen action is disabled', async ({
  page,
  context,
  request,
}) => {
  cancelTakeAway('E2E Offline');
  const cashier = await apiAs(request, 'cashier');
  await takeAway(cashier, 'E2E Offline', 'Plain Rice');
  try {
    await openKitchen(page);
    const start = ticket(page, 'E2E Offline').getByRole('button', { name: 'Start E2E Offline' });
    await expect(start).toBeEnabled();
    await context.setOffline(true);
    await expect(page.getByText("Offline: orders can't be sent.")).toBeVisible({ timeout: 2_000 });
    await expect(start).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Sold out list' })).toBeDisabled();
    await context.setOffline(false);
    await expect(liveDot(page)).toBeVisible({ timeout: 15_000 });
    await expect(start).toBeEnabled();
  } finally {
    cancelTakeAway('E2E Offline');
  }
});
