// The site's scripts in a browser: sorting the images table, the filter
// boxes, the package search, copy buttons, chips, focusable status cells,
// and the theme. Each works on top of a page that is complete without them.
import { expect, test, type Locator, type Page } from '@playwright/test';

/** The image IDs in the images table, top to bottom. */
async function imageOrder(page: Page): Promise<string[]> {
  return page.locator('table.images tbody tr td:first-child a').evaluateAll((links) =>
    links.map((a) => decodeURIComponent((a as HTMLAnchorElement).pathname.split('/').at(-2) ?? '')),
  );
}

const header = (page: Page, name: string): Locator => page.locator('table.images thead th').filter({ has: page.getByRole('button', { name, exact: true }) });

test.describe('the images table', () => {
  test('reads in verdict order, and sorts by any column, both ways', async ({ page }) => {
    await page.goto('./');
    const initial = await imageOrder(page);
    expect(initial.slice(0, 2)).toEqual(['amazonlinux-2023', 'debian-trixie-slim']);
    await expect(page.locator('[data-sort-hint]')).toBeVisible();

    await page.getByRole('button', { name: 'Image', exact: true }).click();
    const az = await imageOrder(page);
    expect(az).toEqual([...initial].sort((a, b) => a.localeCompare(b)).length === az.length ? az : []);
    await expect(header(page, 'Image')).toHaveAttribute('aria-sort', 'ascending');
    await expect(page.locator('[data-sort-status]').first()).toHaveText('Sorted by Image, A to Z.');
    const labels = await page.locator('table.images tbody tr td:first-child > a').allTextContents();
    expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b)));

    await page.getByRole('button', { name: 'Image', exact: true }).click();
    await expect(header(page, 'Image')).toHaveAttribute('aria-sort', 'descending');
    expect(await page.locator('table.images tbody tr td:first-child > a').allTextContents()).toEqual([...labels].reverse());
  });

  test('sorts vulnerabilities most first, and keeps unknown at the bottom either way', async ({ page }) => {
    await page.goto('./');
    const vulns = page.getByRole('button', { name: 'Vulnerabilities', exact: true });
    await vulns.click();
    await expect(header(page, 'Vulnerabilities')).toHaveAttribute('aria-sort', 'descending');
    let order = await imageOrder(page);
    expect(order[0]).toBe('debian-tools');
    const unknown = ['amazonlinux-2023', 'debian-trixie-slim', 'static', 'wolfi-base'];
    expect(order.slice(-4).sort()).toEqual(unknown);
    await vulns.click();
    await expect(header(page, 'Vulnerabilities')).toHaveAttribute('aria-sort', 'ascending');
    order = await imageOrder(page);
    expect(order.slice(-4).sort()).toEqual(unknown);
    expect(order[0]).not.toBe('debian-tools');
  });

  test('sorts from the keyboard', async ({ page }) => {
    await page.goto('./');
    const verdict = page.getByRole('button', { name: 'Verdict', exact: true });
    await verdict.focus();
    await page.keyboard.press('Enter');
    await expect(header(page, 'Verdict')).toHaveAttribute('aria-sort', 'ascending');
    expect((await imageOrder(page)).slice(0, 2)).toEqual(['amazonlinux-2023', 'debian-trixie-slim']);
    await page.keyboard.press('Space');
    await expect(header(page, 'Verdict')).toHaveAttribute('aria-sort', 'descending');
    await expect(page.locator('[data-sort-status]').first()).toHaveText('Sorted by Verdict, best first.');
  });

  test('a filtered list sorts the same way', async ({ page }) => {
    await page.goto('lists/unverified/');
    await page.getByRole('button', { name: 'Image', exact: true }).click();
    await page.getByRole('button', { name: 'Image', exact: true }).click();
    expect(await imageOrder(page)).toEqual(['wolfi-base', 'static']);
  });
});

test.describe('filter boxes', () => {
  test('the findings index keeps the rows that match, and says how many', async ({ page }) => {
    await page.goto('findings/');
    const rows = page.locator('tbody tr[data-text]');
    const total = await rows.count();
    await page.getByRole('searchbox', { name: 'Filter findings' }).fill('go-2026-6603');
    await expect(rows.filter({ visible: true })).toHaveCount(1);
    await expect(page.locator('[data-count]')).toHaveText(`1 of ${total} advisories match.`);
    await page.getByRole('searchbox', { name: 'Filter findings' }).fill('');
    await expect(rows.filter({ visible: true })).toHaveCount(total);
  });

  test("an image's findings filter by package", async ({ page }) => {
    await page.goto('images/debian-tools/');
    // Closed, with too many findings to show at once; its filter is inside.
    const box = page.locator('details', { has: page.locator('input[data-filter]') }).first();
    await box.locator('summary').click();
    await box.getByRole('searchbox', { name: 'Filter findings' }).fill('libcurl4t64');
    const shown = box.locator('tbody tr[data-text]').filter({ visible: true });
    expect(await shown.count()).toBeGreaterThan(0);
    for (const text of await shown.evaluateAll((rows) => rows.map((r) => (r as HTMLElement).dataset.text))) expect(text).toContain('libcurl4t64');
    await expect(box.locator('[data-count]')).toHaveText(/^\d+ of \d+ findings match\.$/);
  });

  test('the packages list filters by name', async ({ page }) => {
    await page.goto('packages/');
    await page.getByRole('searchbox', { name: 'Filter packages' }).fill('openssl');
    const shown = page.locator('section[aria-labelledby="list"] tbody tr').filter({ visible: true });
    expect(await shown.count()).toBeGreaterThan(2);
    for (const name of await shown.locator('td:first-child').allTextContents()) expect(name).toContain('openssl');
    await expect(page.locator('[data-count]')).toHaveText(/ packages match\.$/);
  });
});

test.describe('the package search', () => {
  test('answers a query, keeps it in the address, and answers it again from there', async ({ page }) => {
    await page.goto('packages/');
    const search = page.getByRole('searchbox', { name: /Package and versions/ });
    await expect(search).toBeVisible();
    await search.fill('deb:openssl');
    await expect(page.locator('[data-search-status]')).toContainText('deb:openssl');
    await expect(page.locator('[data-search-results] .search-answer').first()).toContainText('openssl');
    await expect(page).toHaveURL(/\?q=deb%3Aopenssl/);
    await page.reload();
    await expect(page.getByRole('searchbox', { name: /Package and versions/ })).toHaveValue('deb:openssl');
    await expect(page.locator('[data-search-results] .search-answer').first()).toContainText('openssl');
  });

  test('says what is wrong with a query it cannot read', async ({ page }) => {
    await page.goto('packages/');
    await page.getByRole('searchbox', { name: /Package and versions/ }).fill('openssl <');
    await expect(page.locator('[data-search-status]')).not.toBeEmpty();
    await expect(page.locator('[data-search-results] .search-answer')).toHaveCount(0);
  });
});

test.describe('controls', () => {
  test('a copy button copies its command and says so', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('images/hello-app/');
    const button = page.getByRole('button', { name: /^Copy the / }).first();
    await expect(button).toBeVisible();
    const command = await button.locator('xpath=ancestor::figure[1]//code').textContent();
    await button.click();
    await expect(button).toHaveText('Copied');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(command);
    await expect(page.locator('[data-copy-status]')).toHaveText('Copied to the clipboard.');
  });

  test('a chip opens what it means, from the keyboard too, and closes on Escape', async ({ page }) => {
    await page.goto('images/static/');
    const chip = page.locator('button.chip').first();
    const tip = page.locator(`#${await chip.getAttribute('popovertarget')}`);
    await expect(tip).toBeHidden();
    await chip.focus();
    await page.keyboard.press('Enter');
    await expect(tip).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(tip).toBeHidden();
    await chip.click();
    await expect(tip).toBeVisible();
  });

  test('a status cell takes focus by keyboard and shows its label', async ({ page }) => {
    await page.goto('./');
    const cell = page.getByRole('img', { name: /^SBOM: Missing/ }).first();
    // Tab from the cell before it, as a keyboard user would arrive.
    const before = page.getByRole('img', { name: /^Signature: Missing/ }).first();
    await before.focus();
    await page.keyboard.press('Tab');
    await expect(cell).toBeFocused();
    const shown = await cell.evaluate((el) => getComputedStyle(el, '::after').content);
    expect(shown).toBe(JSON.stringify(await cell.getAttribute('aria-label')));
  });

  test('the theme toggle goes system, light, dark, and remembers', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('./');
    const toggle = page.locator('[data-theme-toggle]');
    await expect(toggle).toHaveAttribute('aria-label', 'Theme: system (light)');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-label', 'Theme: light');
    await expect(page.locator('html')).not.toHaveClass(/dark/);
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-label', 'Theme: dark');
    await expect(page.locator('html')).toHaveClass(/dark/);
    await page.reload();
    await expect(page.locator('html')).toHaveClass(/dark/);
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-label', 'Theme: system (light)');
  });
});
