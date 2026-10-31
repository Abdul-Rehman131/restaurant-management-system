import { expect, test } from './fixtures';
import {
  archiveTable,
  createAdmin,
  createTable,
  liveDot,
  menuItemId,
  apiAs,
  setStaffActive,
  signInAs,
  tableId,
} from './support';

// S6 robustness (desktop): no blank screens. Unknown addresses show "not found", a reload on a
// deep link works, a role chunk that fails to load shows the Reload screen, a failed list
// shows its error state and retries, and an expired session ends on the login screen.

test('unknown addresses inside each role show "not found" with the role still around it', async ({
  page,
}) => {
  await signInAs(page, 'cashier');
  await page.goto('/cashier/no-such-screen');
  await expect(page.getByText('This page does not exist')).toBeVisible();
  await expect(page.getByRole('banner')).toBeVisible();
  await page.getByRole('link', { name: 'Home' }).click();
  await expect(page).toHaveURL(/\/cashier$/);

  await page.getByRole('button', { name: 'Account' }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await signInAs(page, 'chef');
  await page.goto('/kitchen/no-such-screen');
  await expect(page.getByText('This page does not exist')).toBeVisible();

  await page.goto('/no-such-area');
  await expect(page.getByText('This page does not exist')).toBeVisible();
});

test('unknown admin and waiter addresses, and a reload on deep links in every role', async ({
  page,
  browser,
  request,
}) => {
  const admin = await createAdmin();
  createTable(151);
  try {
    await signInAs(page, admin);
    await page.goto('/admin/no-such-screen');
    await expect(page.getByText('This page does not exist')).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Admin sections' })).toBeVisible();

    // Deep links survive a reload (the SPA fallback; Vercel rewrites the same way).
    const item = menuItemId('Raita');
    await page.goto(`/admin/menu/${item}`);
    await expect(page.getByRole('heading', { name: 'Edit Raita' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Edit Raita' })).toBeVisible();

    const waiter = await apiAs(request, 'waiter2');
    const order = await waiter.rpc<{ order_id: string }>('create_order', {
      p_request_id: crypto.randomUUID(),
      p_type: 'dine_in',
      p_table_id: tableId(151),
      p_customer_name: '',
      p_customer_phone: '',
      p_items: [{ menu_item_id: item, quantity: 1 }],
    });
    await page.goto(`/cashier/bill/${order.order_id}`);
    await expect(page.getByRole('heading', { name: 'Table 151', level: 2 })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Table 151', level: 2 })).toBeVisible();

    const phone = await browser.newPage();
    await signInAs(phone, 'waiter2');
    await phone.goto(`/waiter/table/${tableId(151)}`);
    await expect(phone.getByRole('heading', { name: 'Table 151' })).toBeVisible();
    await phone.reload();
    await expect(phone.getByRole('heading', { name: 'Table 151' })).toBeVisible();
    await phone.goto('/waiter/no-such-screen');
    await expect(phone.getByText('This page does not exist')).toBeVisible();
    await phone.close();
  } finally {
    archiveTable(151);
    setStaffActive(admin, false);
  }
});

test('a role screen that fails to download shows the Reload screen, and Reload recovers', async ({
  page,
}) => {
  await page.route('**/roles/cashier/CashierApp.tsx*', (route) => route.abort());
  await signInAs(page, 'cashier');
  await expect(page.getByText('Something went wrong')).toBeVisible();
  await page.unroute('**/roles/cashier/CashierApp.tsx*');
  await page.getByRole('button', { name: 'Reload' }).click();
  await expect(page.getByRole('heading', { name: 'Open bills' })).toBeVisible();
  await expect(liveDot(page)).toBeVisible();
});

test('a list that fails to load shows its error and retries', async ({ page }) => {
  await page.route('**/rest/v1/rpc/get_open_bills', (route) =>
    route.fulfill({ status: 503, body: '{"message":"unavailable"}' }),
  );
  await signInAs(page, 'cashier');
  await expect(page.getByText('This could not be loaded')).toBeVisible();
  await page.unroute('**/rest/v1/rpc/get_open_bills');
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByText('This could not be loaded')).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Open bills' })).toBeVisible();
});

test('an expired session ends on the login screen, never a blank page', async ({ page }) => {
  await signInAs(page, 'cashier');
  await expect(page).toHaveURL(/\/cashier$/);
  // The stored session has run out and its refresh token is no longer valid.
  await page.evaluate(() => {
    const stored = localStorage.getItem('rms-staff-auth');
    if (!stored) throw new Error('no session');
    const session = JSON.parse(stored) as Record<string, unknown>;
    localStorage.setItem(
      'rms-staff-auth',
      JSON.stringify({ ...session, expires_at: 1, refresh_token: 'revoked-refresh-token' }),
    );
  });
  await page.reload();
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
});
