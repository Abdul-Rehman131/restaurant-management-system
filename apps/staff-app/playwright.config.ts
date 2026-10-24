import { defineConfig, devices } from '@playwright/test';

// E2E for the staff app. T7: the /dev/ui gallery (axe and screenshots), which exists only in
// the Vite dev server. Role flows are added from T8/P1.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  // One dev server serves every worker; keep it from being the bottleneck.
  workers: 3,
  timeout: 60_000,
  forbidOnly: Boolean(process.env['CI']),
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'phone', use: { ...devices['Pixel 7'] } },
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
    },
  ],
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env['CI'],
    timeout: 60_000,
  },
});
