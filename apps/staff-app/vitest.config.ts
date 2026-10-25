import { defineConfig } from 'vitest/config';

// Unit tests for screen logic (cart, error mapping). Playwright specs in e2e/ are not Vitest's.
export default defineConfig({
  test: { include: ['src/**/*.test.ts'] },
});
