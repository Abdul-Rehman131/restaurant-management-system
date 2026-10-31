import { devices, type APIRequestContext, type Browser, type Page } from '@playwright/test';

import { expect, test } from './fixtures';
import {
  apiAs,
  archiveTable,
  createAdmin,
  createStaff,
  createTable,
  enterMfaCode,
  expectNoSeriousAxe,
  freeTable,
  liveDot,
  png,
  menuItemId,
  passwordToken,
  psql,
  setStaffActive,
  shot,
  signIn,
  signInAs,
  supabaseUrl,
  tableId,
} from './support';
import { totp } from './totp';

// S5 Admin, on the desktop project (admin-phone.spec.ts: the same screens at phone width).
// Every test makes its own data (unique names, tables 141 and up, disposable accounts) and
// archives it afterwards: archive, never delete (CLAUDE.md rule 6).

const rand = () => Math.random().toString(36).slice(2, 7);

/**
 * Signs a new disposable Admin in (MFA step included) and opens `path`. Returns the username
 * for apiAs and for archiving it afterwards (test.afterEach).
 */
async function openAdmin(page: Page, path = '/admin'): Promise<string> {
  const admin = await createAdmin();
  admins.push(admin);
  await signInAs(page, admin);
  await expect(page).toHaveURL(/\/admin/);
  if (path !== '/admin') await page.goto(path);
  await expect(liveDot(page)).toBeVisible();
  return admin;
}

/** Admins this worker made for its tests; archived after each test (never deleted). */
const admins: string[] = [];
test.afterEach(() => {
  for (const admin of admins.splice(0)) setStaffActive(admin, false);
});

/** A waiter on a phone, on order entry for a free test table. */
async function waiterOrderEntry(browser: Browser, table: number) {
  const context = await browser.newContext({ ...devices['Pixel 7'] });
  const page = await context.newPage();
  await signInAs(page, 'waiter1');
  await page.goto(`/waiter/table/${tableId(table)}`);
  await expect(page.getByRole('searchbox', { name: 'Search the menu' })).toBeVisible();
  await expect(liveDot(page)).toBeVisible();
  return { page, context };
}

function categoryId(name: string): string {
  return psql(`select id from public.categories where name = '${name}' and is_active`);
}

function archiveMenu(prefix: string) {
  psql(`update public.menu_items set is_active = false where name like '${prefix}%' and is_active;
        update public.categories set is_active = false where name like '${prefix}%' and is_active;`);
}

/** A menu item created through the Admin API (aal2), for tests that start from one. */
async function apiItem(request: APIRequestContext, admin: string, name: string, price: number) {
  const api = await apiAs(request, admin);
  const saved = await api.rpc<{ item: { id: string } }>('save_menu_item', {
    p_request_id: crypto.randomUUID(),
    p_menu_item_id: null,
    p_item: { category_id: categoryId('Starters'), name, price, cost_price: price / 4 },
  });
  return saved.item.id;
}

async function dineIn(request: APIRequestContext, table: number, items: string[]) {
  const waiter = await apiAs(request, 'waiter2');
  return waiter.rpc<{ order_id: string; total: number }>('create_order', {
    p_request_id: crypto.randomUUID(),
    p_type: 'dine_in',
    p_table_id: tableId(table),
    p_customer_name: '',
    p_customer_phone: '',
    p_items: items.map((id) => ({ menu_item_id: id, quantity: 1 })),
  });
}

const digits = (text: string) => text.replace(/\D/g, '');

test('a new category and item with a photo reach the waiter screen within 2 s', async ({
  page,
  browser,
}) => {
  const prefix = `E2E Soups ${rand()}`;
  createTable(141);
  const waiter = await waiterOrderEntry(browser, 141);
  try {
    await openAdmin(page, '/admin/categories');
    await page.getByRole('button', { name: 'New category' }).click();
    await page.getByLabel('Name', { exact: true }).fill(prefix);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText(`${prefix} is added.`)).toBeVisible();
    await expect(page.locator('[data-row]', { hasText: prefix })).toContainText('0 active items');

    await page.getByRole('link', { name: 'Menu' }).first().click();
    await page.getByRole('link', { name: 'New item' }).click();
    await page.getByLabel('Name', { exact: true }).fill(`${prefix} Lentil`);
    await page.getByLabel('Category').selectOption({ label: prefix });
    await page.getByRole('textbox', { name: /^Price \(/ }).fill('450.50');
    await page.getByRole('textbox', { name: /^Cost price/ }).fill('120');
    await page.getByLabel(/^Preparation time/).fill('12');
    await page.locator('input[type=file]').setInputFiles({
      name: 'soup.png',
      mimeType: 'image/png',
      buffer: png(1600, 1200),
    });
    await expect(page.getByRole('img', { name: 'Preview of the new photo' })).toBeVisible();
    await page.getByRole('img', { name: 'Preview of the new photo' }).scrollIntoViewIfNeeded();
    await shot(page, 'admin-item-form-desktop');
    await expectNoSeriousAxe(page);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText(`${prefix} Lentil is on the menu.`)).toBeVisible();

    // Live on the waiter's phone (menu broadcast), done criterion style: within 2 s.
    await expect(waiter.page.getByText(`${prefix} Lentil`)).toBeVisible({ timeout: 2_000 });
    await expect(waiter.page.getByRole('button', { name: prefix, exact: true })).toBeVisible();

    // Saved as integer minor units with a WebP photo in the bucket.
    const row = psql(`select price || ',' || cost_price || ',' || prep_time_min || ',' || image_path
                        from public.menu_items where name = '${prefix} Lentil' and is_active`);
    const [price, cost, prep, path] = row.split(',');
    expect([price, cost, prep]).toEqual(['45050', '12000', '12']);
    expect(path).toMatch(/^items\/[0-9a-f-]{36}\.webp$/);
    const photo = await page.request.get(
      `${supabaseUrl}/storage/v1/object/public/menu-images/${path ?? ''}`,
    );
    expect(photo.status()).toBe(200);
    expect(photo.headers()['content-type']).toBe('image/webp');
    expect((await photo.body()).length).toBeLessThanOrEqual(1024 * 1024);
  } finally {
    await waiter.context.close();
    archiveMenu(prefix);
    archiveTable(141);
  }
});

test('a price change applies to new orders only; an archived item leaves ordering, old orders keep it', async ({
  page,
  browser,
  request,
}) => {
  const name = `E2E Kebab ${rand()}`;
  createTable(142);
  createTable(145);
  const admin = await openAdmin(page, '/admin/menu');
  const itemId = await apiItem(request, admin, name, 60000);
  const old = await dineIn(request, 142, [itemId]);
  // The waiter takes a free table (142 is another waiter's open order).
  const waiter = await waiterOrderEntry(browser, 145);
  try {
    await page.goto(`/admin/menu/${itemId}`);
    await page.getByRole('textbox', { name: /^Price \(/ }).fill('650');
    await expect(page.getByText('The new price applies to new orders only.')).toBeVisible();
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText(`${name} is saved.`)).toBeVisible();

    expect(psql(`select price from public.menu_items where id = '${itemId}'`)).toBe('65000');
    expect(
      psql(`select price_snapshot from public.order_items where order_id = '${old.order_id}'`),
    ).toBe('60000');
    expect(psql(`select total from public.orders where id = '${old.order_id}'`)).toBe(
      String(old.total),
    );
    const cashier = await apiAs(request, 'cashier');
    const fresh = await cashier.rpc<{ subtotal: number; order_id: string }>('create_order', {
      p_request_id: crypto.randomUUID(),
      p_type: 'take_away',
      p_table_id: null,
      p_customer_name: `${name} guest`,
      p_customer_phone: '',
      p_items: [{ menu_item_id: itemId, quantity: 1 }],
    });
    expect(fresh.subtotal).toBe(65000);
    await cashier.rpc('cancel_order', {
      p_request_id: crypto.randomUUID(),
      p_order_id: fresh.order_id,
      p_reason: 'e2e',
    });

    // Archive with a reason: it leaves every ordering screen live.
    await expect(waiter.page.getByText(name)).toBeVisible();
    await page.goto('/admin/menu');
    await page.getByRole('searchbox', { name: 'Search items' }).fill(name);
    await page.getByRole('button', { name: `Archive ${name}` }).click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog.getByRole('button', { name: 'Archive' })).toBeDisabled();
    await dialog.getByLabel('Reason').fill('Seasonal item');
    await dialog.getByRole('button', { name: 'Archive' }).click();
    await expect(dialog).toBeHidden();
    await expect(waiter.page.getByText(name)).toBeHidden({ timeout: 2_000 });
    expect(
      psql(`select reason from public.audit_log
             where action = 'menu_item.archived' and target_id = '${itemId}'`),
    ).toBe('Seasonal item');
    expect(menuItemId(name)).toBe('');
    // The old order keeps its line (BR-02).
    expect(
      psql(`select name_snapshot from public.order_items where order_id = '${old.order_id}'`),
    ).toBe(name);
  } finally {
    await waiter.context.close();
    archiveMenu(name);
    archiveTable(142);
    archiveTable(145);
  }
});

test('a table with an open order cannot be archived; after it closes it can', async ({
  page,
  request,
}) => {
  createTable(143);
  await dineIn(request, 143, [menuItemId('Raita')]);
  try {
    await openAdmin(page, '/admin/tables');
    const tile = page.locator('[data-table="143"]');
    await expect(tile).toContainText('Occupied');
    await tile.getByRole('button', { name: 'Archive table 143' }).click();
    const dialog = page.getByRole('alertdialog');
    await dialog.getByLabel('Reason').fill('Broken leg');
    await dialog.getByRole('button', { name: 'Archive' }).click();
    await expect(dialog.getByRole('alert')).toContainText('already has an open order');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Keep it' }).click();

    freeTable(143);
    await expect(tile).toContainText('Available', { timeout: 2_000 });
    await tile.getByRole('button', { name: 'Archive table 143' }).click();
    await dialog.getByLabel('Reason').fill('Broken leg');
    await dialog.getByRole('button', { name: 'Archive' }).click();
    await expect(dialog).toBeHidden();
    await expect(
      page.getByRole('region', { name: 'E2E' }).locator('[data-table="143"]'),
    ).toHaveCount(0);
    await expect(page.getByText('Archived tables')).toBeVisible();
  } finally {
    archiveTable(143);
  }
});

test('a settings change shows on the header and the receipt', async ({ page, request }) => {
  const saved = psql(
    `select restaurant_name || '|' || coalesce(tax_registration_number, '') from public.settings`,
  );
  const [name] = saved.split('|');
  // The temporary name keeps the prefix that other specs check, so parallel runs agree.
  const temporary = `Ember Kitchen (E2E ${rand()})`;
  const taxNumber = `NTN ${rand()}`;
  try {
    await openAdmin(page, '/admin/settings');
    await page.getByLabel('Restaurant name').fill(temporary);
    await page.getByLabel(/^Tax registration number/).fill(taxNumber);
    await expect(page.getByText('You have changes that are not saved.')).toBeVisible();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Settings saved.')).toBeVisible();
    await expect(page.getByRole('banner')).toContainText(temporary);
    expect(
      psql(`select count(*) from public.audit_log
             where action = 'settings.changed' and new_value ->> 'tax_registration_number' = '${taxNumber}'`),
    ).toBe('1');

    // The receipt (the cashier's preview, as Admin) prints both.
    const cashier = await apiAs(request, 'cashier');
    const order = await cashier.rpc<{ order_id: string; total: number }>('create_order', {
      p_request_id: crypto.randomUUID(),
      p_type: 'take_away',
      p_table_id: null,
      p_customer_name: 'E2E Settings',
      p_customer_phone: '',
      p_items: [{ menu_item_id: menuItemId('Mineral Water (500 ml)'), quantity: 1 }],
    });
    await cashier.rpc('record_payment', {
      p_request_id: crypto.randomUUID(),
      p_order_id: order.order_id,
      p_tenders: [{ method: 'card', amount: order.total }],
    });
    await page.goto(`/cashier/bill/${order.order_id}`);
    await page.getByRole('button', { name: /Preview receipt/ }).click();
    const receipt = page.getByRole('dialog');
    await expect(receipt).toContainText(temporary);
    await expect(receipt).toContainText(`Tax reg. no. ${taxNumber}`);
  } finally {
    psql(`update public.settings set restaurant_name = '${name ?? 'Ember Kitchen (Demo)'}',
                                     tax_registration_number = null`);
  }
});

test('staff created here sign in; a deactivated one is refused and loses the session', async ({
  page,
  browser,
}) => {
  const username = `e2e-${rand()}`;
  await openAdmin(page, '/admin/staff');
  await page.getByRole('button', { name: 'New staff member' }).click();
  const create = page.getByRole('dialog');
  await create.getByLabel('Username').fill(username);
  await create.getByLabel('Full name').fill('Sara E2E');
  await create.getByLabel('Role').selectOption('waiter');
  await shot(page, 'admin-staff-create-desktop');
  await expectNoSeriousAxe(page);
  await create.getByRole('button', { name: 'Create' }).click();
  const shown = page.getByRole('alertdialog');
  await expect(shown).toContainText('shown only once');
  const password = (await shown.getByTestId('new-password').textContent()) ?? '';
  expect(password).toMatch(/^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/);
  await shown.getByRole('button', { name: 'Done' }).click();

  const staff = await browser.newContext({ ...devices['Pixel 7'] });
  const phone = await staff.newPage();
  try {
    await signIn(phone, username, password);
    // A temporary password must be changed at the first sign-in (S6).
    await expect(phone).toHaveURL(/\/account\/password$/);
    const own = `river-${Math.random().toString(36).slice(2, 8)}-lamp`;
    await phone.getByLabel('Temporary password').fill(password);
    await phone.getByLabel('New password', { exact: true }).fill(own);
    await phone.getByLabel('New password again').fill(own);
    await phone.getByRole('button', { name: 'Save the new password' }).click();
    await expect(phone).toHaveURL(/\/waiter$/);

    // Deactivate with a reason: the open session ends at the next request.
    await page.getByRole('searchbox', { name: 'Search staff' }).fill(username);
    await page.getByRole('button', { name: 'Deactivate Sara E2E' }).click();
    const dialog = page.getByRole('alertdialog');
    await dialog.getByLabel('Reason').fill('Left the job');
    await dialog.getByRole('button', { name: 'Deactivate' }).click();
    await expect(dialog).toBeHidden();
    expect(psql(`select is_active from public.profiles where username = '${username}'`)).toBe('f');
    expect(
      psql(`select count(*) from auth.sessions s join public.profiles p on p.id = s.user_id
             where p.username = '${username}'`),
    ).toBe('0');

    await phone.reload();
    await expect(phone).toHaveURL(/\/login/);
    await expect(phone.getByText(/not active any more/i)).toBeVisible();
    await signIn(phone, username, own);
    await expect(phone.getByText(/not active/i)).toBeVisible();
    await expect(phone).toHaveURL(/\/login/);
  } finally {
    await staff.close();
    setStaffActive(username, false);
  }
});

test('the last-admin and self guards: no admin can remove or demote their own account', async ({
  page,
  request,
}) => {
  const admin = await openAdmin(page, '/admin/staff');
  const fullName = `E2E ${admin}`;
  await page.getByRole('searchbox', { name: 'Search staff' }).fill(admin);
  const me = page.locator('[data-row]', { hasText: fullName }).filter({ visible: true });
  await expect(me).toContainText('You');
  await expect(me.getByRole('button', { name: /Deactivate|Reset/ })).toHaveCount(0);

  // Demoting yourself is refused by the server, with a plain message.
  await me.getByRole('button', { name: `Edit ${fullName}` }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Role').selectOption('cashier');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog.getByRole('alert')).toContainText("can't do this to your own account");
  expect(psql(`select role from public.profiles where username = '${admin}'`)).toBe('admin');

  // The same through the Edge Function: deactivating yourself.
  const api = await apiAs(request, admin);
  const self = await request.post(`${supabaseUrl}/functions/v1/staff-admin`, {
    headers: { Authorization: `Bearer ${api.token}`, 'Content-Type': 'application/json' },
    data: {
      action: 'set_active',
      request_id: crypto.randomUUID(),
      user_id: psql(`select id from public.profiles where username = '${admin}'`),
      is_active: false,
      reason: 'e2e',
    },
  });
  expect(self.status()).toBe(400);
  expect(await self.json()).toEqual({ error: 'CANNOT_CHANGE_SELF' });
  // LAST_ADMIN itself only happens when two Admins demote each other at once (the actor is
  // always another active Admin); pgTAP 380_staff_admin proves the guard.
});

test('MFA: a new Admin enrols TOTP at sign-in; Admin calls need aal2', async ({
  browser,
  request,
}) => {
  const username = createStaff('admin');
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await signIn(page, username);
    await expect(page).toHaveURL(/\/login\/mfa/);
    await expect(page.getByRole('heading', { name: 'Set up two-step sign-in' })).toBeVisible();
    await expect(page.getByRole('img', { name: /QR code/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Skip/ })).toHaveCount(0);
    await shot(page, 'admin-mfa-enrolment-desktop');
    await expectNoSeriousAxe(page);
    const secret = ((await page.locator('code').textContent()) ?? '').trim();
    await enterMfaCode(page, secret);
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible();

    // A session without the code step (aal1) is refused by every Admin entry point.
    const aal1 = await apiAs(request, username, { aal: 'aal1' });
    await expect(aal1.rpc('admin_menu')).rejects.toThrow(/MFA_REQUIRED/);
    await expect(
      aal1.rpc('update_settings', { p_request_id: crypto.randomUUID(), p_changes: {} }),
    ).rejects.toThrow(/MFA_REQUIRED/);
    const fn = await request.post(`${supabaseUrl}/functions/v1/staff-admin`, {
      headers: { Authorization: `Bearer ${aal1.token}` },
      data: {
        action: 'reset_password',
        request_id: crypto.randomUUID(),
        user_id: crypto.randomUUID(),
      },
    });
    expect(await fn.json()).toEqual({ error: 'MFA_REQUIRED' });
    const upload = await request.post(
      `${supabaseUrl}/storage/v1/object/menu-images/items/${crypto.randomUUID()}.webp`,
      {
        headers: { Authorization: `Bearer ${aal1.token}`, 'Content-Type': 'image/webp' },
        data: Buffer.from('RIFF'),
      },
    );
    expect(upload.ok()).toBe(false);

    // The next sign-in asks for the code (no new set-up).
    await context.clearCookies();
    await page.evaluate(() => {
      localStorage.clear();
    });
    await signIn(page, username);
    await expect(page.getByRole('heading', { name: 'Enter your sign-in code' })).toBeVisible();
    await page.getByLabel('6-digit code').fill(totp(secret));
    await page.getByRole('button', { name: 'Verify' }).click();
    await expect(page).toHaveURL(/\/admin$/);
  } finally {
    await context.close();
    setStaffActive(username, false);
  }
});

test('cashier, waiter and chef cannot open admin or call its functions', async ({
  browser,
  request,
}) => {
  for (const user of ['cashier', 'waiter1', 'chef']) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await signInAs(page, user);
    await page.goto('/admin/menu');
    await expect(page).not.toHaveURL(/\/admin/);
    await context.close();

    const api = await apiAs(request, user);
    const refused = /NOT_AUTHORIZED/;
    await expect(api.rpc('admin_menu')).rejects.toThrow(refused);
    await expect(
      api.rpc('save_category', {
        p_request_id: crypto.randomUUID(),
        p_category_id: null,
        p_name: 'X',
      }),
    ).rejects.toThrow(refused);
    await expect(
      api.rpc('update_settings', { p_request_id: crypto.randomUUID(), p_changes: { tax_bps: 0 } }),
    ).rejects.toThrow(refused);
    await expect(
      api.rpc('preview_bill_totals', { p_type: 'dine_in', p_line_amounts: [100], p_discount: 0 }),
    ).rejects.toThrow(refused);
    await expect(
      api.rpc('save_table', {
        p_request_id: crypto.randomUUID(),
        p_table_id: null,
        p_number: 998,
        p_capacity: 2,
        p_section: 'X',
      }),
    ).rejects.toThrow(refused);
    const fn = await request.post(`${supabaseUrl}/functions/v1/staff-admin`, {
      headers: { Authorization: `Bearer ${await passwordToken(user)}` },
      data: {
        action: 'reset_password',
        request_id: crypto.randomUUID(),
        user_id: crypto.randomUUID(),
      },
    });
    expect(fn.status()).toBe(403);
    expect(await fn.json()).toEqual({ error: 'NOT_AUTHORIZED' });
  }
});

test('Bill check matches the order totals for the same lines', async ({ page, request }) => {
  createTable(144);
  const order = await dineIn(request, 144, [
    menuItemId('Chicken Karahi (Half)'),
    menuItemId('Garlic Naan'),
    menuItemId('Mint Margarita'),
  ]);
  try {
    const lines = psql(`select string_agg(line_total::text, ',' order by created_at)
                          from public.order_items where order_id = '${order.order_id}'`)
      .split(',')
      .map((minor) => (Number(minor) / 100).toFixed(2));
    await openAdmin(page, '/admin/bill-check');
    await page.getByLabel('Order type').selectOption('dine_in');
    await page.getByLabel(/^Line amounts/).fill(lines.join('\n'));
    await page.getByRole('button', { name: 'Check the bill' }).click();
    const result = page.locator('dl').filter({ hasText: 'Total' });
    await expect(result).toBeVisible();
    const total = await result
      .locator('div', { hasText: /^Total/ })
      .locator('dd')
      .textContent();
    expect(digits(total ?? '')).toBe(String(order.total));
    await shot(page, 'admin-bill-check-desktop');
    await expectNoSeriousAxe(page);
  } finally {
    archiveTable(144);
  }
});

test('dashboard: numbers, charts with their tables, axe (desktop)', async ({ page, request }) => {
  // Some completed sales today, so the dashboard has numbers. Drinks only (no kitchen): Ready
  // at once, so the payment completes them (no open bills left for other tests).
  const cashier = await apiAs(request, 'cashier');
  for (const items of [['Mineral Water (500 ml)', '7Up (Can)'], ['Pepsi (Can)']]) {
    const order = await cashier.rpc<{ order_id: string; total: number }>('create_order', {
      p_request_id: crypto.randomUUID(),
      p_type: 'take_away',
      p_table_id: null,
      p_customer_name: 'E2E Dashboard',
      p_customer_phone: '',
      p_items: items.map((n) => ({ menu_item_id: menuItemId(n), quantity: 2 })),
    });
    await cashier.rpc('record_payment', {
      p_request_id: crypto.randomUUID(),
      p_order_id: order.order_id,
      p_tenders: [{ method: 'cash', amount: order.total, tendered: order.total }],
    });
  }
  await openAdmin(page);
  await expect(page.getByText('Sales by hour')).toBeVisible();
  await expect(page.locator('.recharts-surface').first()).toBeVisible();
  await shot(page, 'admin-dashboard-desktop');
  await expectNoSeriousAxe(page);
  await page.getByRole('tab', { name: 'Table' }).first().click();
  await expectNoSeriousAxe(page);
});

// One test per screen (each with its own Admin), so a slow machine never runs out of time.
for (const [path, heading, name] of [
  ['/admin/menu', 'Menu', 'admin-menu-desktop'],
  ['/admin/categories', 'Categories', 'admin-categories-desktop'],
  ['/admin/tables', 'Tables', 'admin-tables-desktop'],
  ['/admin/settings', 'Settings', 'admin-settings-desktop'],
  ['/admin/bill-check', 'Bill check', 'admin-bill-check-empty-desktop'],
  ['/admin/staff', 'Staff', 'admin-staff-desktop'],
  ['/admin/menu/new', 'New menu item', 'admin-item-form-empty-desktop'],
] as const) {
  test(`desktop: ${heading} has no serious axe violations`, async ({ page }) => {
    await openAdmin(page, path);
    await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible();
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
    await shot(page, name);
    await expectNoSeriousAxe(page);
  });
}

test('desktop: the collapsed sidebar (icon rail) has no serious axe violations', async ({
  page,
}) => {
  await openAdmin(page);
  await page.getByRole('button', { name: 'Collapse menu' }).click();
  await expectNoSeriousAxe(page);
  await page.getByRole('button', { name: 'Expand menu' }).click();
  await expect(page.getByRole('link', { name: 'Bill check' })).toBeVisible();
});
