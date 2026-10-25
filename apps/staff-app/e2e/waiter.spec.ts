import type { Page } from '@playwright/test';

import { expect, test } from './fixtures';
import {
  apiAs,
  expectNoSeriousAxe,
  freeTable,
  liveDot,
  menuItemId,
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
