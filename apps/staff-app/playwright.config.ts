import { defineConfig, devices } from '@playwright/test';

// E2E for the staff app. T7: the /dev/ui gallery (axe and screenshots), which exists only in
// the Vite dev server. Role flows are added from T8/P1.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  // One dev server serves every worker; keep it from being the bottleneck.
  workers: 3,
  timeout: 60_000,
  // Assertions wait up to 10 s (default 5). Every API call goes through the local Supabase
  // stack in Docker; in the first seconds of a run (three browsers, cold Auth and gateway)
  // measured round trips reached 5.6 s for sign-in and 5.5 s for a trivial RPC. Waits that
  // prove a done criterion ("within 2 seconds") keep their own explicit timeout.
  expect: { timeout: 10_000 },
  forbidOnly: Boolean(process.env['CI']),
  retries: process.env['CI'] ? 1 : 0,
  // CI: annotations in the run, plus an HTML report uploaded only when the job fails.
  reporter: process.env['CI'] ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  // Each role spec runs on the device that role uses, so "skipped" counts only real skips:
  // the waiter app on a phone, the kitchen on a landscape tablet, the cashier on a desktop;
  // shared screens on all.
  projects: [
    { name: 'phone', use: { ...devices['Pixel 7'] }, testIgnore: /(kitchen|cashier)\.spec\.ts/ },
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
      testIgnore: /(waiter|kitchen)\.spec\.ts/,
    },
    {
      name: 'tablet',
      use: { ...devices['Galaxy Tab S4 landscape'] },
      testMatch: /kitchen\.spec\.ts/,
    },
  ],
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env['CI'],
    timeout: 60_000,
  },
});
