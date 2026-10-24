import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// T8 against the LOCAL Supabase stack (`supabase start`, seed.sql demo logins). Runs on phone
// and desktop. Screenshots go to $SHOTS when set. Rider screens are P3.
const PASSWORD = 'demo-password-123';
const shots = process.env['SHOTS'];

const roles = [
  { user: 'admin', home: '/admin', heading: 'Dashboard' },
  { user: 'cashier', home: '/cashier', heading: 'Open bills' },
  { user: 'waiter1', home: '/waiter', heading: null },
  { user: 'chef', home: '/kitchen', heading: 'Kitchen' },
] as const;

async function signIn(page: Page, user: string, password = PASSWORD) {
  await page.goto('/login');
  await page.getByLabel('Username').fill(user);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

/** Admin has no TOTP factor in the seed: skip the set-up prompt (enforcement is P1). */
async function signInAs(page: Page, user: string) {
  await signIn(page, user);
  if (user === 'admin') await page.getByRole('button', { name: 'Skip for now' }).click();
}

const liveDot = (page: Page) =>
  page.getByRole('status').filter({ hasText: 'Live' }).filter({ visible: true });

async function expectNoSeriousAxe(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const serious = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(serious.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
}

test('login screen: accessible, required fields, plain-language errors', async ({ page }, info) => {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  if (shots) await page.screenshot({ path: `${shots}/${info.project.name}-login.png` });
  await expectNoSeriousAxe(page);

  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Fill in this field.')).toHaveCount(2);

  await signIn(page, 'waiter1', 'wrong-password');
  await expect(page.getByRole('alert')).toHaveText(
    'That username or password is not right. Check both and try again.',
  );
  await expect(page).toHaveURL(/\/login$/);
});

for (const { user, home, heading } of roles) {
  test(`${user} signs in and lands on ${home}`, async ({ page }, info) => {
    await signInAs(page, user);
    await expect(page).toHaveURL(new RegExp(`${home}$`));
    if (heading) await expect(page.getByRole('heading', { name: heading })).toBeVisible();
    // Restaurant name from the get_settings RPC (the kitchen bar shows it from md up).
    if (user !== 'chef' || info.project.name === 'desktop') {
      await expect(page.getByText('Ember Kitchen (Demo)').first()).toBeVisible();
    }
    await expect(liveDot(page)).toBeVisible({ timeout: 10_000 });
    await page.evaluate(() => document.fonts.ready);
    if (shots)
      await page.screenshot({ path: `${shots}/${info.project.name}${home.replace('/', '-')}.png` });
    await expectNoSeriousAxe(page);
  });
}

test('the kitchen is dark with display density', async ({ page }) => {
  await signInAs(page, 'chef');
  await expect(page).toHaveURL(/\/kitchen$/);
  await expect(page.locator('html')).toHaveClass(/dark/);
  await expect(page.locator('html')).toHaveAttribute('data-density', 'display');
});

test('wrong-role URLs go to the user’s own home', async ({ page }) => {
  await signInAs(page, 'waiter1');
  await expect(page).toHaveURL(/\/waiter$/);
  for (const path of ['/admin', '/cashier', '/kitchen', '/admin/staff']) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/waiter$/);
  }
});

test('chef and cashier cannot open admin', async ({ browser }) => {
  for (const [user, home] of [
    ['chef', '/kitchen'],
    ['cashier', '/cashier'],
  ] as const) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await signInAs(page, user);
    await expect(page).toHaveURL(new RegExp(`${home}$`));
    await page.goto('/admin');
    await expect(page).toHaveURL(new RegExp(`${home}$`));
    await context.close();
  }
});

test('signed out: any screen goes to login, and back after signing in', async ({ page }) => {
  await page.goto('/cashier');
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel('Username').fill('cashier');
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/cashier$/);
});

test('offline: banner within 2 seconds, primary action disabled, back when online', async ({
  page,
  context,
}) => {
  await signInAs(page, 'waiter1');
  await expect(liveDot(page)).toBeVisible({ timeout: 10_000 });
  const newOrder = page.getByRole('button', { name: 'New order' });
  await expect(newOrder).toBeEnabled();

  await context.setOffline(true);
  await expect(page.getByText("Offline: orders can't be sent.")).toBeVisible({ timeout: 2_000 });
  await expect(newOrder).toBeDisabled();

  await context.setOffline(false);
  await expect(liveDot(page)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Offline: orders can't be sent.")).toBeHidden();
  await expect(newOrder).toBeEnabled();
});

test('a deactivated user is denied', async ({ page }) => {
  await signIn(page, 'former');
  await expect(page.getByRole('alert')).toHaveText(
    'This account is not active. Ask your manager to turn it back on.',
  );
  await expect(page).toHaveURL(/\/login$/);
  await page.goto('/waiter');
  await expect(page).toHaveURL(/\/login$/);
});

test('sign out from the account menu', async ({ page }) => {
  await signInAs(page, 'cashier');
  await expect(page).toHaveURL(/\/cashier$/);
  await page.getByRole('button', { name: 'Account' }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto('/cashier');
  await expect(page).toHaveURL(/\/login$/);
});

test('a session ended elsewhere shows "session ended"', async ({ page, context }) => {
  await signInAs(page, 'waiter1');
  await expect(page).toHaveURL(/\/waiter$/);
  // Signing out in another tab ends this session too (shared storage), like an expired token.
  const other = await context.newPage();
  await other.goto('/waiter');
  await other.getByRole('button', { name: 'Account' }).click();
  await other.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(other).toHaveURL(/\/login$/);

  await expect(page).toHaveURL(/\/login$/, { timeout: 10_000 });
  await expect(page.getByText('Your session ended. Sign in again to continue.')).toBeVisible();
});

test('rider has no screens yet (P3)', async ({ page }) => {
  await signInAs(page, 'rider');
  await expect(page).toHaveURL(/\/not-available$/);
  await expect(page.getByText('No screens for this role yet')).toBeVisible();
});
