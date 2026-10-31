// The production build served the way Vercel serves it: dist/ with the header rules and the
// SPA rewrite of apps/staff-app/vercel.json (a small server below), and the
// Content-Security-Policy ENFORCED (vercel.json still sends it as Report-Only). Every role's
// screens, in the dark theme (the pre-paint inline script), must load with no CSP violation.
// Also the PWA manifest and its icons, and a deep-link reload.
// Run after `pnpm build`: pnpm --filter @rms/staff-app e2e:pwa (needs the local Supabase stack)
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test, type Page } from '@playwright/test';

import { createAdmin, enterMfaCode, signIn, supabaseUrl, totpSecretOf } from '../e2e/support';

const vercel = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')) as {
  rewrites: { source: string; destination: string }[];
  headers: { source: string; headers: { key: string; value: string }[] }[];
};
const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const local = new URL(supabaseUrl);
const types: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};
/** vercel.json sources are path patterns with regex groups, like "/assets/(.*)". */
const matches = (source: string, path: string) => new RegExp(`^${source}$`).test(path);

/**
 * Like Vercel: a file that exists is served, anything else is rewritten to index.html; then
 * every matching header rule applies. The CSP is enforced, with the hosted Supabase
 * (*.supabase.co) swapped for the local stack.
 */
function vercelLike(): Server {
  return createServer((request, response) => {
    const path = decodeURIComponent(new URL(request.url ?? '/', 'http://x').pathname);
    let file = normalize(join(dist, path));
    if (!file.startsWith(dist) || !existsSync(file) || statSync(file).isDirectory()) {
      const rewrite = vercel.rewrites.find((rule) => matches(rule.source, path));
      file = join(dist, rewrite?.destination ?? '/index.html');
    }
    for (const rule of vercel.headers.filter((r) => matches(r.source, path))) {
      for (const { key, value } of rule.headers) {
        if (key === 'Content-Security-Policy-Report-Only') {
          response.setHeader(
            'Content-Security-Policy',
            value
              .replaceAll('https://*.supabase.co', local.origin)
              .replace('wss://*.supabase.co', `ws://${local.host}`),
          );
        } else {
          response.setHeader(key, value);
        }
      }
    }
    response.setHeader('Content-Type', types[extname(file)] ?? 'application/octet-stream');
    response.end(readFileSync(file));
  });
}

let server: Server;
const origin = 'http://localhost:4180';
test.beforeAll(async () => {
  server = vercelLike();
  await new Promise<void>((resolve) => server.listen(4180, 'localhost', resolve));
});
test.afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

// No service worker: every load comes from the server above, with its headers.
test.use({ serviceWorkers: 'block', colorScheme: 'dark', baseURL: origin });

async function watchViolations(page: Page) {
  // Enforced here, so a blocked script, style, image or request is recorded, not just reported.
  const csp = (await page.request.get('/login')).headers()['content-security-policy'];
  expect(csp).toBeTruthy();
  await page.addInitScript(() => {
    const w = window as unknown as { violations: string[] };
    w.violations = [];
    document.addEventListener('securitypolicyviolation', (event) => {
      w.violations.push(`${event.effectiveDirective}: ${event.blockedURI || 'inline'}`);
    });
  });
}

const violations = (page: Page) =>
  page.evaluate(() => (window as unknown as { violations: string[] }).violations);

test('every role under the enforced CSP: no violation, dark before first paint', async ({
  page,
}) => {
  await watchViolations(page);
  await page.goto('/login');
  // The pre-paint script ran (allowed by its hash): the page is dark before the app loads.
  await expect(page.locator('html')).toHaveClass(/\bdark\b/);
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();

  for (const [user, home] of [
    ['waiter1', /\/waiter$/],
    ['chef', /\/kitchen$/],
    ['cashier', /\/cashier$/],
  ] as const) {
    await signIn(page, user);
    await expect(page).toHaveURL(home);
    await expect(page.getByRole('status').filter({ hasText: 'Live' }).first()).toBeVisible();
    // A deep-link reload: served by the SPA fallback, under the same headers.
    await page.reload();
    await expect(page).toHaveURL(home);
    await expect(page.getByRole('status').filter({ hasText: 'Live' }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Account' }).click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login$/);
  }

  const admin = await createAdmin();
  await signIn(page, admin);
  await enterMfaCode(page, totpSecretOf(admin));
  await expect(page).toHaveURL(/\/admin$/);
  // The dashboard charts (a lazy chunk) and the menu with its photo upload field.
  await expect(
    page.locator('.recharts-surface').or(page.getByText('No completed sales')).first(),
  ).toBeVisible();
  await page.goto('/admin/menu/new');
  await expect(page.getByRole('heading', { name: 'New menu item', level: 1 })).toBeVisible();

  expect(await violations(page)).toEqual([]);
});

test('the PWA manifest and its icons are served; an unknown path gets the app', async ({
  request,
}) => {
  const deep = await request.get('/kitchen');
  expect(deep.ok()).toBe(true);
  expect(await deep.text()).toContain('<div id="root"></div>');
  expect(deep.headers()['x-frame-options']).toBe('DENY');
  expect(deep.headers()['strict-transport-security']).toContain('max-age=');
  const manifest = await request.get('/manifest.webmanifest');
  expect(manifest.ok()).toBe(true);
  const body = (await manifest.json()) as {
    start_url: string;
    display: string;
    icons: { src: string; sizes: string; purpose?: string }[];
  };
  expect(body.start_url).toBe('/');
  expect(body.display).toBe('standalone');
  expect(body.icons.map((icon) => icon.sizes)).toEqual(
    expect.arrayContaining(['192x192', '512x512']),
  );
  expect(body.icons.some((icon) => icon.purpose === 'maskable')).toBe(true);
  for (const icon of [...body.icons.map((i) => i.src), '/brand/apple-touch-icon-180x180.png']) {
    const response = await request.get(icon);
    expect(response.ok(), icon).toBe(true);
    expect(response.headers()['content-type'], icon).toContain('image/png');
  }
});
