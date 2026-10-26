import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readBundle } from '../src/lib/bundle.ts';
import type { EstateReport, Finding } from '../src/lib/contract.gen.ts';
import { advisoryLinks, affectedImages, byFixFirst, findingGroups, fixFirstTier } from '../src/lib/findings.ts';
import { FIXTURE, MINIMAL } from './helpers.ts';

test('fix first: fixable critical, fixable high, then critical and high with no fix, then the rest', () => {
  const order: [string, boolean][] = [
    ['critical', true],
    ['high', true],
    ['critical', false],
    ['high', false],
    ['medium', true],
    ['medium', false],
    ['low', true],
    ['negligible', false],
    ['unknown', true],
    ['unknown', false],
    ['something new', true],
  ];
  const tiers = order.map(([s, f]) => fixFirstTier(s, f));
  assert.deepEqual([...tiers].sort((a, b) => a - b), tiers, 'tiers rise in this order');
  assert.equal(new Set(tiers).size, tiers.length, 'each is its own tier');
});

test("an image's findings, fix first", () => {
  const f = (id: string, severity: Finding['severity'], fixedIn?: string[]): Finding => ({ id, severity, package: 'p', version: '1', platforms: [], ...(fixedIn ? { fixedIn } : {}) });
  const sorted = byFixFirst([f('A', 'critical'), f('B', 'medium', ['2']), f('C', 'high', ['2']), f('D', 'critical', ['2']), f('E', 'high'), f('F', 'medium')]);
  assert.deepEqual(sorted.map((x) => x.id), ['D', 'C', 'A', 'E', 'B', 'F']);
});

test('findings across the estate: one entry per advisory, fixable critical and high first, most images first', () => {
  const report = readBundle(FIXTURE).report;
  const groups = findingGroups(report);
  const ids = groups.map((g) => g.id);
  assert.equal(new Set(ids).size, ids.length, 'one entry per advisory');
  // The first are fixable highs (the fixture's fixable criticals are all VEX-covered).
  assert.equal(groups[0].severity, 'high');
  assert.ok(groups[0].fixable);
  const go6603 = groups.find((g) => g.id === 'GO-2026-6603')!;
  assert.deepEqual(affectedImages(go6603).map((i) => i.id).sort(), ['ghcr-io-northcutted-images-amazonlinux-tools', 'ghcr-io-northcutted-images-debian-tools', 'ghcr-io-northcutted-images-platform-tools']);
  assert.ok(go6603.packages.includes('golang.org/x/net v0.57.0') && go6603.packages.includes('stdlib go1.27.1'));
  // Every fixable high comes before a critical with no fix known.
  const curl = ids.indexOf('CVE-2026-10536');
  assert.ok(curl > 0 && !groups[curl].fixable && groups[curl].severity === 'critical');
  for (const g of groups.slice(0, curl)) assert.ok(g.fixable && (g.severity === 'high' || g.severity === 'critical'), g.id);
  // An advisory a VEX statement covers wherever it is found is counted nowhere, and comes last.
  const vex = groups.find((g) => g.id === 'GO-2026-6604')!;
  assert.deepEqual([vex.counted.length, vex.suppressed.length > 0], [0, true]);
  assert.ok(ids.indexOf('GO-2026-6604') > ids.findLastIndex((id) => groups[ids.indexOf(id)].counted.length > 0));
  // Within a tier, the advisory in the most images first.
  const tier = groups.filter((g) => g.counted.length > 0 && fixFirstTier(g.severity, g.fixable) === fixFirstTier(groups[0].severity, true));
  const sizes = tier.map((g) => affectedImages(g).length);
  assert.deepEqual([...sizes].sort((a, b) => b - a), sizes);
});

test('a finding page name is safe and unique, whatever the ID', () => {
  const report = structuredClone(readBundle(MINIMAL).report) as EstateReport;
  const billing = report.images.find((i) => i.id === 'ghcr-io-acme-images-billing-1-4-2')!;
  const hostile = ['../../../etc/passwd', '"><script>alert(1)</script>', 'CVE-2026-1', 'cve-2026-1', '..', '', 'A'.repeat(300)];
  billing.vulnerabilities!.findings.push(...hostile.map((id) => ({ id, severity: 'high' as const, package: 'p', version: '1', platforms: [] })));
  const slugs = findingGroups(report).map((g) => g.slug);
  assert.equal(new Set(slugs).size, slugs.length);
  for (const slug of slugs) {
    assert.match(slug, /^[a-z0-9][a-z0-9._-]*$/, slug);
    assert.ok(slug.length <= 104, slug);
  }
});

test('advisory IDs link to their canonical pages only when they have a known shape', () => {
  const cases: [string, string[]][] = [
    ['CVE-2026-10536', ['https://www.cve.org/CVERecord?id=CVE-2026-10536', 'https://nvd.nist.gov/vuln/detail/CVE-2026-10536']],
    ['GHSA-6j4f-fj2g-mc7p', ['https://github.com/advisories/GHSA-6j4f-fj2g-mc7p']],
    ['GO-2026-6603', ['https://pkg.go.dev/vuln/GO-2026-6603']],
    ['PYSEC-2024-48', ['https://osv.dev/vulnerability/PYSEC-2024-48']],
    ['RUSTSEC-2024-0001', ['https://rustsec.org/advisories/RUSTSEC-2024-0001.html']],
    // Anything else is text: no guessing, and nothing of a hostile ID in a URL.
    ['cve-2026-10536', []],
    ['CVE-2026-1', []],
    ['CVE-2026-10536"><script>', []],
    ['CVE-2026-10536/../../x', []],
    ['GHSA-aaaa-bbbb-cccc', []],
    ['javascript:alert(1)', []],
    ['ALAS2023-2025-123', []],
    ['', []],
  ];
  for (const [id, urls] of cases) assert.deepEqual(advisoryLinks(id).map((l) => l.url), urls, id);
});
