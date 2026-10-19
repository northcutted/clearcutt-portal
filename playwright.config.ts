// Browser tests of the site's scripts (sorting, filters, the package search,
// copy buttons, chips, the theme) and an axe pass over its pages in both
// themes. e2e/site.ts builds a site and serves it; the tests are e2e/*.spec.ts.
//
//   npx playwright install chromium   (once)
//   npx playwright test
import { defineConfig, devices } from '@playwright/test';

const PORT = 4329;

export default defineConfig({
  testDir: 'e2e',
  testMatch: '*.spec.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}/portal/`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `node e2e/site.ts ${PORT}`,
    url: `http://127.0.0.1:${PORT}/portal/`,
    timeout: 180_000,
    reuseExistingServer: !process.env.CI,
    stdout: 'pipe',
  },
});
