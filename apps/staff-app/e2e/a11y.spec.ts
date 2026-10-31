import type { APIRequestContext, Page, TestInfo } from '@playwright/test';

import { expect, test } from './fixtures';
import {
  apiAs,
  archiveTable,
  createAdmin,
  createTable,
  expectNoSeriousAxe,
  liveDot,
  menuItemId,
  setStaffActive,
  signIn,
  signInAs,
  tableId,
} from './support';

// S6 accessibility sweep: axe (serious and critical, WCAG 2.2 AA) on every screen of every
// role, in the light and the dark theme, on the phone and the desktop project. The theme is
// the device's (colorScheme), which the app follows while no theme is chosen. Each test owns
// a table (161 to 170: by screen, project and theme) and its order, so tests run in parallel. The
// kitchen is always dark (M6), so it runs once per project. Keyboard-only use of the cashier
// and admin screens and the kitchen's sizes at tablet size are in the role specs.

const themes = ['light', 'dark'] as const;
type ThemeName = (typeof themes)[number];

/** The test's own table: waiter 161 to 164, cashier 165 to 168, kitchen 169 and 170. */
function tableFor(info: TestInfo, base: 161 | 165 | 169, theme: ThemeName) {
  return (
    base +
    (info.project.name === 'desktop' ? (base === 169 ? 1 : 2) : 0) +
    (theme === 'dark' ? 1 : 0)
  );
}

/** A Dine-In order by waiter2 on the test's table, with a kitchen item and a drink. */
async function openOrder(request: APIRequestContext, table: number) {
  createTable(table);
  const waiter = await apiAs(request, 'waiter2');
  return waiter.rpc<{ order_id: string; order_number: string }>('create_order', {
    p_request_id: crypto.randomUUID(),
    p_type: 'dine_in',
    p_table_id: tableId(table),
    p_customer_name: '',
    p_customer_phone: '',
    p_items: [
      { menu_item_id: menuItemId('Chicken Corn Soup'), quantity: 1, notes: 'no pepper' },
      { menu_item_id: menuItemId('Soft Drink (Can)'), quantity: 2 },
    ],
  });
}

async function expectTheme(page: Page, theme: ThemeName) {
  await expect(page.locator('html')).toHaveClass(theme === 'dark' ? /\bdark\b/ : /^(?!.*\bdark\b)/);
}

/** Waits until the screen has loaded (no skeletons left), then runs axe. */
async function check(page: Page) {
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
  await expectNoSeriousAxe(page);
}

async function accountMenu(page: Page) {
  await page.getByRole('button', { name: 'Account' }).click();
  await expect(page.getByRole('menuitem', { name: 'Change password' })).toBeVisible();
  await check(page);
  await page.keyboard.press('Escape');
}

for (const theme of themes) {
  test.describe(`${theme} theme`, () => {
    test.use({ colorScheme: theme });

    test(`sign-in screen: empty, required fields, wrong password (${theme})`, async ({ page }) => {
      await page.goto('/login');
      await expectTheme(page, theme);
      await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
      await check(page);
      await page.getByRole('button', { name: 'Sign in' }).click();
      await expect(page.getByLabel('Username')).toBeFocused();
      await check(page);
      await signIn(page, 'waiter1', 'not-the-password');
      await expect(page.getByText('That username or password is not right.')).toBeVisible();
      await check(page);
    });

    test(`waiter screens (${theme})`, async ({ page, request }, info) => {
      test.slow();
      const table = tableFor(info, 161, theme);
      const order = await openOrder(request, table);
      try {
        await signInAs(page, 'waiter2');
        await expect(page).toHaveURL(/\/waiter$/);
        await expect(liveDot(page)).toBeVisible();
        await expectTheme(page, theme);
        await expect(
          page.getByRole('link', { name: new RegExp(`^Table ${String(table)} `) }),
        ).toBeVisible();
        await check(page);

        await page.goto(`/waiter/table/${tableId(table)}`);
        await expect(page.getByRole('region', { name: 'First send' })).toContainText(
          'Chicken Corn Soup',
        );
        await check(page);

        await page.getByRole('link', { name: 'Add more items' }).click();
        await expect(page.getByText(`Adding to ${order.order_number}`)).toBeVisible();
        await check(page);
        await page.getByRole('button', { name: 'Add Raita' }).click();
        await page.getByRole('button', { name: 'Review' }).click();
        await expect(page.getByRole('dialog')).toBeVisible();
        await check(page);
        await page.keyboard.press('Escape');

        await page.goto('/waiter/orders');
        await expect(page.getByText(order.order_number)).toBeVisible();
        await check(page);
        await page.goto('/waiter/alerts');
        await expect(
          page.getByText('No alerts yet').or(page.getByRole('list')).first(),
        ).toBeVisible();
        await check(page);
        await accountMenu(page);
        await page.goto('/account/password');
        await expect(page.getByRole('heading', { name: 'Change your password' })).toBeVisible();
        await check(page);
        await page.goto('/waiter/no-such-screen');
        await expect(page.getByText('This page does not exist')).toBeVisible();
        await check(page);
      } finally {
        archiveTable(table);
      }
    });

    test(`cashier screens (${theme})`, async ({ page, request }, info) => {
      test.slow();
      const table = tableFor(info, 165, theme);
      const order = await openOrder(request, table);
      try {
        await signInAs(page, 'cashier');
        await expect(page).toHaveURL(/\/cashier$/);
        await expect(liveDot(page)).toBeVisible();
        await expectTheme(page, theme);
        await expect(
          page.locator('[data-bill-row]').filter({ hasText: order.order_number }),
        ).toBeVisible();
        await check(page);

        await page.goto(`/cashier/bill/${order.order_id}`);
        await expect(
          page.getByText(order.order_number).filter({ visible: true }).first(),
        ).toBeVisible();
        await expect(
          page.getByText('Total', { exact: true }).filter({ visible: true }).first(),
        ).toBeVisible();
        await check(page);
        // The payment pad is part of the bill: Card chosen by its key.
        await page.keyboard.press('2');
        await expect(page.getByRole('radio', { name: /Card/ })).toHaveAttribute(
          'aria-checked',
          'true',
        );
        await check(page);

        await page.getByRole('button', { name: /^Cancel order/ }).click();
        await expect(
          page.getByRole('alertdialog').or(page.getByRole('dialog')).first(),
        ).toBeVisible();
        await check(page);
        await page.getByRole('button', { name: 'Keep it' }).click();
        await expect(page.getByRole('alertdialog').or(page.getByRole('dialog'))).toHaveCount(0);

        await page.keyboard.press('?');
        await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
        await check(page);
        await page.keyboard.press('Escape');

        // Paid by card: the paid state, then the receipt preview (shown once a payment exists).
        await page.getByRole('button', { name: /^Pay/ }).click();
        await expect(page.getByText('Payment recorded')).toBeVisible();
        await check(page);
        await page.getByRole('button', { name: 'Preview receipt' }).click();
        await expect(page.getByRole('dialog')).toBeVisible();
        await check(page);
        await page.keyboard.press('Escape');
        await expect(page.getByRole('dialog')).toBeHidden();

        await page.goto('/cashier/new');
        await expect(page.getByRole('heading', { name: 'New counter order' })).toBeVisible();
        await check(page);
        await accountMenu(page);
        await page.goto('/cashier/no-such-screen');
        await expect(page.getByText('This page does not exist')).toBeVisible();
        await check(page);
      } finally {
        archiveTable(table);
      }
    });

    test(`admin screens, part 1 (${theme})`, async ({ page }) => {
      test.slow();
      const admin = await createAdmin();
      try {
        await signInAs(page, admin);
        await expect(page).toHaveURL(/\/admin$/);
        await expect(liveDot(page)).toBeVisible();
        await expectTheme(page, theme);
        await expect(
          page.locator('.recharts-surface').or(page.getByText('No completed sales')).first(),
        ).toBeVisible();
        await check(page);
        for (const [path, heading] of [
          ['/admin/menu', 'Menu'],
          ['/admin/menu/new', 'New menu item'],
          [`/admin/menu/${menuItemId('Raita')}`, 'Edit Raita'],
          ['/admin/categories', 'Categories'],
        ] as const) {
          await page.goto(path);
          await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible();
          await check(page);
        }
      } finally {
        setStaffActive(admin, false);
      }
    });

    test(`admin screens, part 2 (${theme})`, async ({ page }) => {
      test.slow();
      const admin = await createAdmin();
      try {
        await signInAs(page, admin);
        await expect(page).toHaveURL(/\/admin$/);
        await expectTheme(page, theme);
        for (const [path, heading] of [
          ['/admin/tables', 'Tables'],
          ['/admin/staff', 'Staff'],
          ['/admin/settings', 'Settings'],
          ['/admin/bill-check', 'Bill check'],
        ] as const) {
          await page.goto(path);
          await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible();
          await check(page);
        }
        await page.goto('/admin/staff');
        await page.getByRole('button', { name: 'New staff member' }).click();
        await expect(page.getByRole('dialog')).toBeVisible();
        await check(page);
        await page.keyboard.press('Escape');
        await accountMenu(page);
        await page.goto('/admin/no-such-screen');
        await expect(page.getByText('This page does not exist')).toBeVisible();
        await check(page);
      } finally {
        setStaffActive(admin, false);
      }
    });
  });
}

test('kitchen screens (always dark)', async ({ page, request }, info) => {
  test.slow();
  const table = tableFor(info, 169, 'light');
  const order = await openOrder(request, table);
  try {
    await signInAs(page, 'chef');
    await expect(page).toHaveURL(/\/kitchen$/);
    await expect(liveDot(page)).toBeVisible();
    await expectTheme(page, 'dark');
    const card = page.getByRole('article', { name: new RegExp(`Table ${String(table)}\\b`) });
    await expect(card).toContainText(order.order_number);
    await check(page);
    await page.getByRole('button', { name: 'Sold out list' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await check(page);
    await page.keyboard.press('Escape');
    await page.goto('/kitchen/no-such-screen');
    await expect(page.getByText('This page does not exist')).toBeVisible();
    await check(page);
  } finally {
    archiveTable(table);
  }
});
