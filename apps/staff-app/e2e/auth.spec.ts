import { expect, test } from './fixtures';
import {
  PASSWORD,
  createStaff,
  expectNoSeriousAxe,
  liveDot,
  setStaffActive,
  shots,
  signIn,
  signInAs,
} from './support';

// T8 against the LOCAL Supabase stack (`supabase start`, seed.sql demo logins). Runs on phone
// and desktop. Screenshots go to $SHOTS when set. Rider screens are P3.
const roles = [
  { user: 'admin', home: '/admin', heading: 'Dashboard' },
  { user: 'cashier', home: '/cashier', heading: 'Open bills' },
  { user: 'waiter1', home: '/waiter', heading: null },
  { user: 'chef', home: '/kitchen', heading: 'Kitchen' },
] as const;

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
  const answer = page.waitForResponse((r) => r.url().includes('/auth/v1/token'));
  await page.getByRole('button', { name: 'Sign in' }).click();
  await answer;
  await expect(page).toHaveURL(/\/cashier$/);
});

test('offline: banner within 2 seconds, primary action disabled, back when online', async ({
  page,
  context,
}) => {
  // The shell's connection state; the waiter's Send to Kitchen is covered in waiter.spec.ts.
  await signInAs(page, 'cashier');
  await expect(liveDot(page)).toBeVisible({ timeout: 10_000 });
  const newOrder = page
    .getByRole('button', { name: 'New counter order' })
    .filter({ visible: true });
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

// Deactivation while signed in: the token is still valid, but my_role() turns NULL at once.
// A disposable account per run (createStaff), so no shared demo login is ever switched off.
test('deactivated while signed in: the next check signs the user out with "not active"', async ({
  page,
}) => {
  const username = createStaff('waiter');
  try {
    await signInAs(page, username);
    await expect(page).toHaveURL(/\/waiter$/);
    setStaffActive(username, false);
    await page.reload();
    await expect(page).toHaveURL(/\/login$/);
    await expect(
      page.getByText('This account is not active any more. Ask your manager.'),
    ).toBeVisible();
  } finally {
    // Archived, never deleted (CLAUDE.md rule 6): it stays inactive.
    setStaffActive(username, false);
  }
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

test('rider has no screens yet (P3) and stays signed in', async ({ page }) => {
  // The account-status check (my_role) must not mistake "no screens yet" for "not active":
  // wait for its answer, then the rider must still be on the notice, not back at login.
  const status = page.waitForResponse((r) => r.url().includes('/rest/v1/rpc/my_role'));
  await signInAs(page, 'rider');
  await expect(page).toHaveURL(/\/not-available$/);
  expect((await status).ok()).toBe(true);
  await expect(page.getByText('No screens for this role yet')).toBeVisible();
  await expect(page).toHaveURL(/\/not-available$/);
});
