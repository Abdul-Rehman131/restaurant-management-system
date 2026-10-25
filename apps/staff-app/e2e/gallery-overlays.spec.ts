import AxeBuilder from '@axe-core/playwright';
import type { Locator, Page } from '@playwright/test';

import { expect, test } from './fixtures';
import { animationsDone } from './support';

// Overlays render in a portal only while open, so the static gallery check cannot see them.
// Open each one and run axe again, in both themes and directions. Closing with Escape must
// return focus to the trigger (the page behind an overlay is inert while it is open).
async function expectNoSeriousViolations(page: Page, label: string) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const serious = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  const details = serious.map(
    (v) => `${v.id} ${v.help}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`,
  );
  expect(serious, `${label}: ${details.join('\n')}`).toEqual([]);
}

const shotsDir = process.env['GALLERY_SHOTS'];

/** The open overlay: every overlay in the gallery renders one of these roles while open. */
const overlayLayer = (page: Page) =>
  page.locator('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]');

const overlays: { name: string; trigger: (page: Page) => Locator }[] = [
  { name: 'dialog', trigger: (page) => page.getByRole('button', { name: 'Dialog', exact: true }) },
  {
    name: 'alert dialog',
    trigger: (page) => page.getByRole('button', { name: 'Confirm (destructive)' }),
  },
  { name: 'sheet', trigger: (page) => page.getByRole('button', { name: 'Sheet' }) },
  { name: 'drawer', trigger: (page) => page.getByRole('button', { name: 'Drawer' }) },
  { name: 'popover', trigger: (page) => page.getByRole('button', { name: 'Popover' }) },
  { name: 'menu', trigger: (page) => page.getByRole('button', { name: 'Order actions' }) },
  { name: 'select', trigger: (page) => page.getByRole('combobox', { name: 'Table' }) },
  { name: 'combobox', trigger: (page) => page.getByRole('combobox', { name: 'Menu item' }) },
  {
    name: 'search palette',
    trigger: (page) => page.getByRole('button', { name: /Search palette/ }),
  },
];

for (const theme of ['light', 'dark'] as const) {
  for (const dir of ['ltr', 'rtl'] as const) {
    test(`overlays ${theme} ${dir}: accessible when open, focus returns on close`, async ({
      page,
    }, testInfo) => {
      await page.goto(`/dev/ui?theme=${theme}&dir=${dir}`);
      await expect(page.locator('h1')).toBeVisible();
      for (const overlay of overlays) {
        const trigger = overlay.trigger(page);
        await trigger.click();
        // Open means the overlay is in the page and its enter animation finished, so axe sees
        // final colours and Escape reaches it.
        await expect(overlayLayer(page).first(), `${overlay.name}: opens`).toBeVisible();
        await animationsDone(page);
        if (shotsDir) {
          const name = `${testInfo.project.name}-${theme}-${dir}-${overlay.name.replace(' ', '-')}`;
          await page.screenshot({ path: `${shotsDir}/overlays/${name}.png` });
        }
        await expectNoSeriousViolations(page, overlay.name);
        await page.keyboard.press('Escape');
        await expect(trigger, `${overlay.name}: focus returns to the trigger`).toBeFocused();
        await expect(overlayLayer(page), `${overlay.name}: closes`).toHaveCount(0);
        await animationsDone(page);
      }
    });
  }
}
