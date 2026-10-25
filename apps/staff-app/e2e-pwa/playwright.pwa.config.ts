import { defineConfig, devices } from '@playwright/test';

// Production preview (service worker on), unlike playwright.config.ts (dev server).
export default defineConfig({
  testDir: '.',
  timeout: 180_000,
  outputDir: '../test-results/pwa',
  reporter: process.env['CI']
    ? [['github'], ['html', { open: 'never', outputFolder: '../playwright-report-pwa' }]]
    : 'list',
  use: { baseURL: 'http://localhost:4173', ...devices['Desktop Chrome'] },
  webServer: { command: 'pnpm preview', url: 'http://localhost:4173', reuseExistingServer: false },
});
