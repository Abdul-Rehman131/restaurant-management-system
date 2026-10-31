// The Admin MFA switch (settings.require_admin_mfa) on a production build. Here, not in e2e/,
// because the switch is global and this suite runs one test at a time: switched off, the
// parallel Admin tests of e2e/ would not see their MFA step. Always switched back on.
// Run after `pnpm build`: pnpm --filter @rms/staff-app e2e:pwa (needs the local Supabase stack)
import { expect, test } from '@playwright/test';

import { createStaff, psql, setStaffActive, signIn } from '../e2e/support';

const setAdminMfa = (on: boolean) => psql(`select public.ops_set_require_admin_mfa(${String(on)})`);
const factors = (username: string) =>
  psql(`select count(*) from auth.mfa_factors f join public.profiles p on p.id = f.user_id
         where p.username = '${username}'`);

test.afterEach(() => {
  setAdminMfa(true);
});

test('switched off: an Admin without a second step works, and the account menu says it is off', async ({
  page,
}) => {
  setAdminMfa(false);
  // A new Admin with no authenticator at all.
  const admin = createStaff('admin');
  try {
    await signIn(page, admin);
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible();
    // Admin data loads at aal1 (the server allows it while the switch is off).
    await expect(
      page.locator('.recharts-surface').or(page.getByText('No completed sales')).first(),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Account' }).click();
    await expect(page.getByRole('menu')).toContainText('Two-step sign-in is off (demo)');
    await page.keyboard.press('Escape');

    // The MFA screen is never shown: opening it sends the Admin home, with nothing enrolled.
    await page.goto('/login/mfa');
    await expect(page).toHaveURL(/\/admin$/);
    expect(factors(admin)).toBe('0');

    // Switched on again: the same Admin must set up the second step before any screen.
    setAdminMfa(true);
    await page.getByRole('button', { name: 'Account' }).click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();
    await signIn(page, admin);
    await expect(page).toHaveURL(/\/login\/mfa$/);
    await expect(page.getByText('Set up two-step sign-in')).toBeVisible();
  } finally {
    setStaffActive(admin, false);
  }
});

test('switched on (the default): the account menu has no notice', async ({ page }) => {
  // The waiter's menu never has it; the Admin's only while the switch is off (above).
  await signIn(page, 'waiter1');
  await expect(page).toHaveURL(/\/waiter$/);
  await page.getByRole('button', { name: 'Account' }).click();
  await expect(page.getByRole('menu')).not.toContainText('Two-step sign-in is off');
});
