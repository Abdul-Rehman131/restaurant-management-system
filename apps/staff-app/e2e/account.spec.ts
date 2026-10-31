import type { Page } from '@playwright/test';

import { expect, test } from './fixtures';
import {
  PASSWORD,
  apiAs,
  createAdmin,
  createStaff,
  enterMfaCode,
  expectNoSeriousAxe,
  passwordToken,
  psql,
  setStaffActive,
  shot,
  signIn,
  totpSecretOf,
} from './support';

// Own password (S6): change it from the account menu; a temporary password (new or reset
// account) must be changed first, enforced by the server. Disposable accounts only.

const fresh = () => `river-${Math.random().toString(36).slice(2, 8)}-lamp`;
const mustChange = (username: string) =>
  psql(`update public.profiles set must_change_password = true where username = '${username}'`);

async function fillPasswords(page: Page, current: string, next: string) {
  await page.getByLabel(/^(Current|Temporary) password$/).fill(current);
  await page.getByLabel('New password', { exact: true }).fill(next);
  await page.getByLabel('New password again').fill(next);
}

test('a temporary password must be changed first; the server refuses everything until then', async ({
  page,
  request,
}) => {
  const username = createStaff('waiter');
  mustChange(username);
  try {
    await signIn(page, username);
    await expect(page).toHaveURL(/\/account\/password$/);
    await expect(page.getByRole('heading', { name: 'Choose your own password' })).toBeVisible();
    // Other screens send the person back here.
    await page.goto('/waiter');
    await expect(page).toHaveURL(/\/account\/password$/);
    // The server refuses the API too, not only the screens.
    const api = await apiAs(request, username);
    await expect(api.rpc('get_settings')).rejects.toThrow(/PASSWORD_CHANGE_REQUIRED/);
    expect(await api.select('restaurant_tables?select=id')).toEqual([]);

    await shot(page, `account-forced-${test.info().project.name}`);
    await expectNoSeriousAxe(page);
    const next = fresh();
    await fillPasswords(page, PASSWORD, next);
    await expect(page.getByText('Both new passwords match')).toBeVisible();
    await page.getByRole('button', { name: 'Save the new password' }).click();
    await expect(page).toHaveURL(/\/waiter$/);
    await expect(page.getByText('Your password is changed.')).toBeVisible();
    expect(
      psql(`select must_change_password from public.profiles where username = '${username}'`),
    ).toBe('f');
    // Only the new password signs in now.
    await expect(passwordToken(username)).rejects.toThrow();
    await expect(passwordToken(username, next)).resolves.toBeTruthy();
  } finally {
    setStaffActive(username, false);
  }
});

test('change your own password from the account menu: rules shown, plain errors', async ({
  page,
}) => {
  const username = createStaff('cashier');
  try {
    await signIn(page, username);
    await expect(page).toHaveURL(/\/cashier$/);
    await page.getByRole('button', { name: 'Account' }).click();
    await page.getByRole('menuitem', { name: 'Change password' }).click();
    await expect(page.getByRole('heading', { name: 'Change your password' })).toBeVisible();

    // The rules are a live checklist; Save waits for all of them.
    await page.getByLabel('New password', { exact: true }).fill(`${username}-x`);
    const save = page.getByRole('button', { name: 'Save the new password' });
    await expect(save).toBeDisabled();
    await expect(page.getByText(/Does not contain your username: not yet/)).toBeAttached();

    // A wrong current password is refused by the server in plain words.
    await fillPasswords(page, 'not-the-password-1', fresh());
    await save.click();
    await expect(page.getByRole('alert')).toContainText('The current password is not right.');

    const next = fresh();
    await fillPasswords(page, PASSWORD, next);
    await save.click();
    await expect(page).toHaveURL(/\/cashier$/);
    // Still signed in on this device after the change.
    await page.reload();
    await expect(page).toHaveURL(/\/cashier$/);
    expect(
      psql(`select count(*) from public.audit_log a join public.profiles p on p.id::text = a.target_id
             where a.action = 'staff.password_changed' and p.username = '${username}'`),
    ).toBe('1');
  } finally {
    setStaffActive(username, false);
  }
});

test('an Admin with a temporary password: MFA step first, then the new password', async ({
  page,
}) => {
  const admin = await createAdmin();
  mustChange(admin);
  try {
    await signIn(page, admin);
    await expect(page.getByRole('heading', { name: 'Enter your sign-in code' })).toBeVisible();
    await enterMfaCode(page, totpSecretOf(admin));
    await expect(page).toHaveURL(/\/account\/password$/);
    await fillPasswords(page, PASSWORD, fresh());
    await page.getByRole('button', { name: 'Save the new password' }).click();
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible();
  } finally {
    setStaffActive(admin, false);
  }
});
