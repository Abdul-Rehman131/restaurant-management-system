import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

// T7 acceptance: the gallery renders in light, dark, LTR and RTL, and axe reports no serious
// or critical violations (WCAG 2.2 AA). Screenshots go to test-results/gallery/ (or
// $GALLERY_SHOTS) for design review.
const combinations = [
  { theme: 'light', dir: 'ltr' },
  { theme: 'dark', dir: 'ltr' },
  { theme: 'light', dir: 'rtl' },
  { theme: 'dark', dir: 'rtl' },
] as const;

const shotsDir = process.env['GALLERY_SHOTS'] ?? 'test-results/gallery';

for (const { theme, dir } of combinations) {
  test(`gallery ${theme} ${dir}: renders and has no serious axe violations`, async ({
    page,
  }, testInfo) => {
    await page.goto(`/dev/ui?theme=${theme}&dir=${dir}`);
    await expect(page.locator('h1')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('dir', dir);
    await expect(page.locator('html')).toHaveClass(theme === 'dark' ? /dark/ : /^(?!.*dark)/);
    // Fonts loaded, so screenshots and contrast use Inter.
    await page.evaluate(() => document.fonts.ready);

    await page.screenshot({
      path: `${shotsDir}/${testInfo.project.name}-${theme}-${dir}.png`,
      fullPage: true,
    });

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
      .analyze();
    const serious = results.violations.filter(
      (violation) => violation.impact === 'serious' || violation.impact === 'critical',
    );
    const summary = results.violations.map(
      (v) => `${v.impact ?? 'unknown'}: ${v.id} (${String(v.nodes.length)}) ${v.help}`,
    );
    testInfo.annotations.push({ type: 'axe', description: summary.join('\n') || 'no violations' });
    expect(serious, summary.join('\n')).toEqual([]);
  });
}
