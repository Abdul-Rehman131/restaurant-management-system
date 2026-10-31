import type { Page } from '@playwright/test';

import { expect, test } from './fixtures';
import {
  createAdmin,
  createStaff,
  expectNoSeriousAxe,
  liveDot,
  png,
  setStaffActive,
  shot,
  signIn,
  signInAs,
} from './support';

// The Admin screens at phone width (plan 4.5: the sidebar is a sheet, tables become cards),
// with axe on each and the phone screenshots. The flows themselves are in admin.spec.ts
// (desktop). One test per screen, each with its own disposable Admin.

async function openAdmin(page: Page, path: string, heading: string) {
  const admin = await createAdmin();
  await signInAs(page, admin);
  await expect(page).toHaveURL(/\/admin$/);
  if (path !== '/admin') await page.goto(path);
  await expect(liveDot(page)).toBeVisible();
  await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible();
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
  return admin;
}

for (const [path, heading, name] of [
  ['/admin', 'Dashboard', 'admin-dashboard-phone'],
  ['/admin/menu', 'Menu', 'admin-menu-phone'],
  ['/admin/categories', 'Categories', 'admin-categories-phone'],
  ['/admin/tables', 'Tables', 'admin-tables-phone'],
  ['/admin/settings', 'Settings', 'admin-settings-phone'],
  ['/admin/bill-check', 'Bill check', 'admin-bill-check-phone'],
] as const) {
  test(`phone: ${heading} has no serious axe violations`, async ({ page }) => {
    const admin = await openAdmin(page, path, heading);
    try {
      // The dashboard's chart library loads lazily: wait for the chart (or, on a day without
      // sales, the empty state) before the picture.
      if (path === '/admin') {
        await expect(
          page.locator('.recharts-surface').or(page.getByText('No completed sales')).first(),
        ).toBeVisible();
      }
      await shot(page, name);
      await expectNoSeriousAxe(page);
    } finally {
      setStaffActive(admin, false);
    }
  });
}

test('phone: the navigation sheet', async ({ page }) => {
  const admin = await openAdmin(page, '/admin', 'Dashboard');
  try {
    await page.getByRole('button', { name: 'Open menu' }).click();
    const sheet = page.getByRole('dialog', { name: 'Admin' });
    await expect(sheet.getByRole('link', { name: 'Bill check' })).toBeVisible();
    await expectNoSeriousAxe(page);
    await sheet.getByRole('link', { name: 'Menu' }).click();
    await expect(sheet).toBeHidden();
    await expect(page.getByRole('heading', { name: 'Menu', level: 1 })).toBeVisible();
  } finally {
    setStaffActive(admin, false);
  }
});

test('phone: staff list as cards and the create dialog', async ({ page }) => {
  const admin = await openAdmin(page, '/admin/staff', 'Staff');
  try {
    await shot(page, 'admin-staff-phone');
    await expectNoSeriousAxe(page);
    await page.getByRole('button', { name: 'New staff member' }).click();
    await expect(page.getByRole('dialog', { name: 'New staff member' })).toBeVisible();
    await shot(page, 'admin-staff-create-phone');
    await expectNoSeriousAxe(page);
  } finally {
    setStaffActive(admin, false);
  }
});

test('phone: the item form with a photo', async ({ page }) => {
  const admin = await openAdmin(page, '/admin/menu/new', 'New menu item');
  try {
    await page.getByLabel('Name', { exact: true }).fill('Lentil Soup');
    await page.getByRole('textbox', { name: /^Price \(/ }).fill('450');
    await page.locator('input[type=file]').setInputFiles({
      name: 'soup.png',
      mimeType: 'image/png',
      buffer: png(1200, 900),
    });
    await expect(page.getByRole('img', { name: 'Preview of the new photo' })).toBeVisible();
    await page.getByRole('img', { name: 'Preview of the new photo' }).scrollIntoViewIfNeeded();
    await shot(page, 'admin-item-form-phone');
    await expectNoSeriousAxe(page);
  } finally {
    setStaffActive(admin, false);
  }
});

test('phone: MFA enrolment', async ({ page }) => {
  const username = createStaff('admin');
  try {
    await signIn(page, username);
    await expect(page.getByRole('heading', { name: 'Set up two-step sign-in' })).toBeVisible();
    await expect(page.getByRole('img', { name: /QR code/ })).toBeVisible();
    await shot(page, 'admin-mfa-enrolment-phone');
    await expectNoSeriousAxe(page);
  } finally {
    setStaffActive(username, false);
  }
});
