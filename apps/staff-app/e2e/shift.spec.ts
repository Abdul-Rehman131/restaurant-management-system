import type { Page } from '@playwright/test';

import { expect, test } from './fixtures';
import { liveDot, signInAs } from './support';

// Start shift on the waiter, kitchen and cashier screens (phone and desktop projects). The bug
// it guards: the button waited on AudioContext.resume() and the wake lock request before
// anything changed, so a browser that left either unanswered (iOS Safari with its audio session
// interrupted, a wake lock request that never settles) got a button that did nothing at all.
// The browser APIs are replaced per test so each case is exact and needs no device.

type Mode = 'hang' | 'grant' | 'unsupported';

async function stubBrowser(page: Page, mode: Mode) {
  await page.addInitScript((m: Mode) => {
    const w = window as unknown as {
      tones: number;
      wakeRequests: number;
      sentinel: { released: boolean } | null;
    };
    w.tones = 0;
    w.wakeRequests = 0;
    w.sentinel = null;
    const Base = window.AudioContext;
    window.AudioContext = class extends Base {
      override createOscillator() {
        w.tones += 1;
        return super.createOscillator();
      }
      override resume() {
        return m === 'hang' ? new Promise<void>(() => undefined) : super.resume();
      }
    };
    const request = () => {
      w.wakeRequests += 1;
      if (m === 'hang') return new Promise(() => undefined);
      const sentinel = { released: false, release: () => Promise.resolve() };
      w.sentinel = sentinel;
      return Promise.resolve(sentinel);
    };
    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      value: m === 'unsupported' ? undefined : { request },
    });
  }, mode);
}

const stats = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as { tones: number; wakeRequests: number };
    return { tones: w.tones, wakeRequests: w.wakeRequests };
  });

const roles = [
  { user: 'waiter1', home: /\/waiter$/, mute: 'Mute alerts', muteKey: 'rms-waiter-muted' },
  {
    user: 'chef',
    home: /\/kitchen$/,
    mute: 'Mute the new-ticket chime',
    muteKey: 'rms-kitchen-muted',
  },
  {
    user: 'cashier',
    home: /\/cashier$/,
    mute: 'Mute the bill-request tone',
    muteKey: 'rms-cashier-muted',
  },
] as const;

async function open(page: Page, user: string, home: RegExp) {
  await signInAs(page, user);
  await expect(page).toHaveURL(home);
  await expect(liveDot(page)).toBeVisible();
}

const shiftOn = (page: Page) => page.getByRole('button', { name: 'Shift on: options' });
const startShift = (page: Page) => page.getByRole('button', { name: 'Start shift' });
/** On a phone the toasts sit over the header for a few seconds: tap the header after them. */
async function openShiftMenu(page: Page) {
  // The pointer still rests where Start shift was, under the toasts, and a hovered toast never
  // leaves (Sonner pauses it): move it away first, as a finger lifts off.
  await page.mouse.move(1, (page.viewportSize()?.height ?? 600) - 1);
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0, { timeout: 15_000 });
  await shiftOn(page).click();
}
const toast = (page: Page, text: string | RegExp) =>
  page.locator('[data-sonner-toast]').filter({ hasText: text });

for (const role of roles) {
  test.describe(role.user, () => {
    test('a browser that never answers: the click still turns into Shift on, and says why the screen may sleep', async ({
      page,
    }) => {
      await stubBrowser(page, 'hang');
      await open(page, role.user, role.home);
      await startShift(page).click();
      // At once, not after the browser answers (it never does here).
      await expect(shiftOn(page)).toBeVisible({ timeout: 1_000 });
      await expect(toast(page, 'Shift started')).toBeVisible({ timeout: 1_000 });
      await expect(page.getByRole('button', { name: role.mute })).toBeVisible();
      // The wake lock request has a time limit; then a plain-words warning.
      await expect(toast(page, 'Screen may turn off')).toContainText('did not answer');
      await openShiftMenu(page);
      await expect(page.getByRole('menu')).toContainText('did not answer');
    });

    test('Start shift: chime, wake lock, remembered after a reload, asked again when visible, End shift', async ({
      page,
    }) => {
      await stubBrowser(page, 'grant');
      await open(page, role.user, role.home);
      await startShift(page).click();
      await expect(shiftOn(page)).toBeVisible();
      await expect(toast(page, 'Shift started')).toContainText('A sound plays for new work');
      // The confirmation chime (two notes) and one wake lock request.
      await expect.poll(() => stats(page)).toEqual({ tones: 2, wakeRequests: 1 });
      await openShiftMenu(page);
      await expect(page.getByRole('menu')).toContainText(
        'The screen stays awake while this app is open.',
      );
      await page.keyboard.press('Escape');

      // Remembered on this device: after a reload the shift is still on and the lock is asked
      // for again (no tap needed for that). The dev build mounts twice (React StrictMode), so
      // the counts below are compared, not fixed.
      await page.reload();
      await expect(liveDot(page)).toBeVisible();
      await expect(shiftOn(page)).toBeVisible();
      await expect(startShift(page)).toHaveCount(0);
      await expect.poll(() => stats(page).then((s) => s.wakeRequests)).toBeGreaterThan(0);
      const held = (await stats(page)).wakeRequests;

      // The browser drops the lock when the tab is hidden; back on screen it is asked again.
      await page.evaluate(() => {
        const w = window as unknown as { sentinel: { released: boolean } };
        w.sentinel.released = true;
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await expect.poll(() => stats(page).then((s) => s.wakeRequests)).toBe(held + 1);

      // End shift: back to Start shift, and it stays off after a reload.
      await openShiftMenu(page);
      await page.getByRole('menuitem', { name: 'End shift' }).click();
      await expect(toast(page, 'Shift ended')).toBeVisible();
      await expect(startShift(page)).toBeVisible();
      await page.reload();
      await expect(liveDot(page)).toBeVisible();
      await expect(startShift(page)).toBeVisible();
    });

    test('muted on this device: no chime, and the toast says the sound is muted', async ({
      page,
    }) => {
      await page.addInitScript((key) => {
        localStorage.setItem(key, '1');
      }, role.muteKey);
      await stubBrowser(page, 'grant');
      await open(page, role.user, role.home);
      await startShift(page).click();
      await expect(toast(page, 'Shift started')).toContainText('Sound is muted on this device');
      await expect.poll(() => stats(page).then((s) => s.wakeRequests)).toBe(1);
      expect((await stats(page)).tones).toBe(0);
    });
  });
}

test('no Screen Wake Lock in this browser: Start shift works and says so in plain words', async ({
  page,
}) => {
  await stubBrowser(page, 'unsupported');
  await open(page, 'cashier', /\/cashier$/);
  await startShift(page).click();
  await expect(shiftOn(page)).toBeVisible();
  await expect(toast(page, 'Screen may turn off')).toContainText(
    "This browser can't keep the screen awake",
  );
});
