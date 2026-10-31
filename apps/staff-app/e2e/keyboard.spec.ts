import type { APIRequestContext, Locator, Page } from '@playwright/test';

import { expect, test } from './fixtures';
import {
  apiAs,
  createAdmin,
  liveDot,
  menuItemId,
  psql,
  setStaffActive,
  totpSecretOf,
  PASSWORD,
} from './support';
import { totp } from './totp';

// S6: keyboard-only use of the cashier and admin screens (desktop project only). No mouse
// click anywhere: every step is a key, and every element reached with Tab shows a visible
// focus indicator (an outline or a ring).

/** The focused element draws a visible indicator: an outline or a box-shadow ring. */
async function expectFocusVisible(page: Page) {
  const shown = await page.evaluate(() => {
    const element = document.activeElement;
    if (!element || element === document.body) return 'nothing focused';
    const style = getComputedStyle(element);
    const outline = style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0;
    const ring = style.boxShadow !== 'none';
    const label = element.getAttribute('aria-label') ?? element.textContent.trim().slice(0, 40);
    return outline || ring
      ? 'ok'
      : `no focus indicator on ${element.tagName} "${label}" (outline ${style.outlineStyle} ${style.outlineWidth}, :focus-visible ${String(element.matches(':focus-visible'))})`;
  });
  expect(shown).toBe('ok');
}

/**
 * Presses Tab (or Shift+Tab, `back`) until `target` has focus, at most `max` times, checking each
 * stop's focus ring. The admin navigation comes before the screen, so it is reached backwards.
 */
async function tabTo(page: Page, target: Locator, { back = false, max = 60 } = {}) {
  const focused = () => target.evaluate((element) => element === document.activeElement);
  if (await focused()) return;
  for (let i = 0; i < max; i++) {
    await page.keyboard.press(back ? 'Shift+Tab' : 'Tab');
    await expectFocusVisible(page);
    if (await focused()) return;
  }
  throw new Error(`Tab never reached ${target.toString()}`);
}

/** Signs in with the keyboard only: type, Tab, Enter. */
async function keyboardSignIn(page: Page, user: string) {
  await page.goto('/login');
  await expect(page.getByLabel('Username')).toBeVisible();
  await tabTo(page, page.getByLabel('Username'));
  await page.keyboard.type(user);
  await tabTo(page, page.getByLabel('Password', { exact: true }));
  await page.keyboard.type(PASSWORD);
  await page.keyboard.press('Enter');
}

async function takeAway(request: APIRequestContext, name: string) {
  const cashier = await apiAs(request, 'cashier');
  return cashier.rpc<{ order_id: string; total: number }>('create_order', {
    p_request_id: crypto.randomUUID(),
    p_type: 'take_away',
    p_table_id: null,
    p_customer_name: name,
    p_customer_phone: '',
    p_items: [{ menu_item_id: menuItemId('Soft Drink (Can)'), quantity: 1 }],
  });
}

test('cashier, keyboard only: sign in, find a bill, pay it in cash, start a counter order', async ({
  page,
  request,
}) => {
  test.slow();
  const name = `E2E Keyboard ${crypto.randomUUID().slice(0, 6)}`;
  const order = await takeAway(request, name);
  try {
    await keyboardSignIn(page, 'cashier');
    await expect(page).toHaveURL(/\/cashier$/);
    await expect(liveDot(page)).toBeVisible();

    await page.keyboard.press('/');
    await page.keyboard.type(name);
    await expect(page.locator('[data-bill-row]')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await page.keyboard.press('ArrowDown');
    await expectFocusVisible(page);
    await page.keyboard.press('Enter');
    await expect(
      page.getByRole('heading', { name: `Take Away · ${name}`, level: 2 }),
    ).toBeVisible();

    // Cash, full amount (1), then the Pay button reached with Tab and pressed with Enter.
    await page.keyboard.press('1');
    await expect(page.getByRole('radio', { name: /Cash/ })).toHaveAttribute('aria-checked', 'true');
    await tabTo(page, page.getByRole('button', { name: /^Exact/ }));
    await page.keyboard.press('Enter');
    await tabTo(page, page.getByRole('button', { name: /^Pay/ }));
    await page.keyboard.press('Enter');
    await expect(page.getByText('Payment recorded')).toBeVisible();
    expect(
      psql(`select method || ':' || amount from public.payments
             where order_id = '${order.order_id}' and voided_at is null`),
    ).toBe(`cash:${String(order.total)}`);

    // Back to the list (Esc), then a new counter order (N): the first field takes the keys.
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(/\/cashier$/);
    await page.keyboard.press('n');
    await expect(page).toHaveURL(/\/cashier\/new$/);
    await tabTo(page, page.getByLabel('Customer name'));
    await page.keyboard.type('E2E Keyboard counter');
    await expect(page.getByLabel('Customer name')).toHaveValue('E2E Keyboard counter');
  } finally {
    psql(`update public.orders set status = 'cancelled', cancel_reason = 'e2e reset', cancelled_at = now()
           where customer_name like 'E2E Keyboard%' and status not in ('completed', 'cancelled')`);
  }
});

test('admin, keyboard only: sign in with the code, open Categories, add one, open the menu', async ({
  page,
}) => {
  test.slow();
  const admin = await createAdmin();
  const category = `E2E Keys ${crypto.randomUUID().slice(0, 6)}`;
  try {
    await keyboardSignIn(page, admin);
    // The code field has focus on the MFA step; Enter submits it.
    await expect(page.getByLabel('6-digit code')).toBeFocused();
    await page.keyboard.type(totp(totpSecretOf(admin)));
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/admin$/);
    await expect(liveDot(page)).toBeVisible();

    await tabTo(page, page.getByRole('link', { name: 'Categories' }));
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Categories', level: 1 })).toBeVisible();

    await tabTo(page, page.getByRole('button', { name: 'New category' }));
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByLabel('Name')).toBeFocused();
    await page.keyboard.type(category);
    await page.keyboard.press('Enter');
    await expect(page.getByText(`${category} is added.`)).toBeVisible();
    await expect(dialog).toBeHidden();

    // A dialog opened with the keyboard closes with Escape and gives focus back.
    await tabTo(page, page.getByRole('button', { name: 'New category' }));
    await page.keyboard.press('Enter');
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('button', { name: 'New category' })).toBeFocused();

    await tabTo(page, page.getByRole('link', { name: 'Menu' }), { back: true });
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Menu', level: 1 })).toBeVisible();
    await tabTo(
      page,
      page
        .getByRole('link', { name: 'New item' })
        .or(page.getByRole('button', { name: 'New item' })),
    );
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'New menu item', level: 1 })).toBeVisible();
  } finally {
    psql(`update public.categories set is_active = false where name = '${category}'`);
    setStaffActive(admin, false);
  }
});
