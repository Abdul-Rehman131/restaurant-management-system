// PWA update flow on a production preview: v1 is served by the service worker, a v2 build
// appears, the "update available" toast shows, and Update reloads into v2.
// Run after `pnpm build`: pnpm --filter @rms/staff-app e2e:pwa
import { execSync } from 'node:child_process';
import { expect, test } from '@playwright/test';

test('update available toast', async ({ page }) => {
  await page.goto('/login');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
    .toBe(true);
  execSync('pnpm exec vite build', {
    env: { ...process.env, VITE_APP_NAME: `Staff App ${Date.now()}` },
    stdio: 'ignore',
  });
  await page.evaluate(async () => {
    const r = await navigator.serviceWorker.getRegistration();
    await r?.update();
  });
  const toast = page.getByText('A new version of the app is ready.');
  await expect(toast).toBeVisible({ timeout: 30000 });
  if (process.env['SHOTS']) {
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${process.env['SHOTS']}/pwa-update-toast.png` });
  }
  await Promise.all([
    page.waitForEvent('load'),
    page.getByRole('button', { name: 'Update' }).click(),
  ]);
  await expect(toast).toBeHidden();
});
