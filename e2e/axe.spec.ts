// An axe pass (WCAG 2.1 A and AA) over the site's pages, in the light theme
// and the dark one.
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const PAGES = [
  '',
  'lists/failed/',
  'lists/stale-base/',
  'findings/',
  'findings/go-2026-6603/',
  'findings/cve-2026-10536/',
  'images/ghcr-io-northcutted-images-debian-tools/',
  'images/ghcr-io-northcutted-images-hello-app/',
  'images/cgr-dev-chainguard-static/',
  'bases/',
  'stacks/',
  'packages/',
  'packages/deb-openssl/',
  'history/',
  'history/changes/',
  'about/',
  'no-such-page/',
];

for (const theme of ['light', 'dark'] as const) {
  test.describe(`${theme} theme`, () => {
    test.use({ colorScheme: theme });
    for (const path of PAGES) {
      test(`/${path} has no WCAG 2.1 AA violations`, async ({ page }) => {
        await page.goto(path);
        await expect(page.locator('html')).toHaveClass(theme === 'dark' ? /dark/ : /^(?!.*dark)/);
        // Open what is closed, so its contents are checked too.
        await page.locator('details:not([open]) > summary').evaluateAll((summaries) => summaries.forEach((s) => (s.parentElement as HTMLDetailsElement).open = true));
        const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
        const violations = results.violations.map((v) => ({
          rule: v.id,
          impact: v.impact,
          help: v.help,
          nodes: v.nodes.slice(0, 5).map((n) => `${n.target.join(' ')}: ${n.failureSummary?.split('\n').slice(1).join(' ')}`),
        }));
        expect(violations).toEqual([]);
      });
    }
  });
}

// What the scripts change: a sorted table, an open chip, search results.
for (const theme of ['light', 'dark'] as const) {
  test.describe(`${theme} theme, after the scripts run`, () => {
    test.use({ colorScheme: theme });
    test('a sorted table, an open chip, and the package search have no WCAG 2.1 AA violations', async ({ page }) => {
      const check = async () => {
        const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
        expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(', ')}`)).toEqual([]);
      };
      await page.goto('./');
      await page.getByRole('button', { name: 'Vulnerabilities', exact: true }).click();
      await page.locator('button.chip').first().click();
      await check();
      await page.goto('packages/?q=deb:openssl');
      await expect(page.locator('[data-search-results] .search-answer').first()).toBeVisible();
      await check();
    });
  });
}
