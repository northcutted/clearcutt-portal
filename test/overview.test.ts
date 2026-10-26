import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readBundle } from '../src/lib/bundle.ts';
import type { EstateReport } from '../src/lib/contract.gen.ts';
import {
  DEFAULT_SCAN_AGE_DAYS,
  formatAge,
  imageLists,
  oldScans,
  outstanding,
  reasonGroups,
  scanAgeLimit,
  scanAges,
} from '../src/lib/overview.ts';
import { FIXTURE, MINIMAL } from './helpers.ts';

const fixture = () => structuredClone(readBundle(FIXTURE).report) as EstateReport;

test('reasons are grouped: one per reason, however many images give it', () => {
  const groups = reasonGroups(fixture());
  assert.deepEqual(
    groups.map((g) => [g.text, g.images.length, g.failed, g.unverified]),
    [
      ['vulnerabilities are unknown (no scan)', 4, 2, 2],
      ['none of its evidence is verified, so a trusted signer vouched for nothing about it', 2, 2, 0],
      ['provenance is missing', 2, 2, 0],
      ['sbom is missing', 2, 2, 0],
      ['signature is missing', 2, 2, 0],
    ],
  );
});

test('a reason that differs only in its numbers is one group, its numbers a range', () => {
  const report = fixture();
  const reasons = ['3 fixable vulnerabilities at critical or above', '30 fixable vulnerabilities at critical or above', 'base is 40 days behind its newest version (limit 30)'];
  report.images.forEach((image, i) => {
    image.verdict = { status: 'failed', reasons: [reasons[i % 2], ...(i === 0 ? [reasons[2]] : [])] };
  });
  const groups = reasonGroups(report);
  assert.deepEqual(groups.map((g) => [g.text, g.images.length]), [
    ['3–30 fixable vulnerabilities at critical or above', report.images.length],
    ['base is 40 days behind its newest version (limit 30)', 1],
  ]);
  // Each image keeps its own reason.
  assert.deepEqual([...new Set(groups[0].images.map((i) => i.reason))].sort(), reasons.slice(0, 2).sort());
  assert.deepEqual(reasonGroups({ ...report, images: [] }), []);
});

test('a passing policy still has its outstanding work listed', () => {
  const report = fixture();
  for (const image of report.images) image.verdict = { status: 'verified', reasons: [] };
  report.summary.verdicts = { verified: report.images.length, failed: 0, unverified: 0 };
  report.summary.bases.stale = 2;
  const items = outstanding(report, 7).map((o) => [o.text, o.path]);
  assert.deepEqual(items, [
    ['25 critical findings (0 with a fix)', 'findings/'],
    [`${report.summary.vulnerabilities.counts.high} high findings (${report.summary.vulnerabilities.fixable.high} with a fix)`, 'findings/'],
    ['2 images on a stale base', 'lists/stale-base/'],
    ['4 images with no vulnerability data', 'lists/not-scanned/'],
  ]);
  // A failing one leads with that.
  assert.deepEqual(outstanding(fixture(), 7).slice(0, 2).map((o) => o.text), ['2 images fail the policy', '2 images are unverified']);
});

test('scan ages: the oldest first, undated and unscanned apart, flagged past the limit', () => {
  const report = fixture();
  report.images.find((i) => i.id === 'ghcr-io-northcutted-images-hello-app')!.vulnerabilities!.scannedAt = '2026-09-30T16:51:46Z';
  delete report.images.find((i) => i.id === 'ghcr-io-northcutted-images-debian-tools')!.vulnerabilities!.scannedAt;
  const ages = scanAges(report);
  assert.equal(ages.dated[0].image.id, 'ghcr-io-northcutted-images-hello-app');
  assert.equal(formatAge(ages.dated[0].ms), '10 days');
  assert.deepEqual(ages.undated.map((i) => i.id), ['ghcr-io-northcutted-images-debian-tools']);
  assert.equal(ages.unscanned.length, 4);
  assert.deepEqual(oldScans(report, 7).map((s) => s.image.id), ['ghcr-io-northcutted-images-hello-app']);
  assert.deepEqual(oldScans(report, 10).map((s) => s.image.id), []);
  const old = imageLists(report, 7).find((l) => l.key === 'old-scans')!;
  assert.deepEqual(old.images.map((i) => i.id), ['ghcr-io-northcutted-images-hello-app', 'ghcr-io-northcutted-images-debian-tools']);
  assert.deepEqual(outstanding(report, 7).filter((o) => o.path === 'lists/old-scans/').map((o) => o.text), ['1 scan older than 7 days', '1 scan with no date']);
});

test('ages in words', () => {
  const H = 3_600_000;
  const cases: [number, string][] = [[-5, '0 minutes'], [59_999, '0 minutes'], [60_000, '1 minute'], [H, '1 hour'], [27 * H, '27 hours'], [48 * H - 1, '47 hours'], [48 * H, '2 days'], [300 * 24 * H, '300 days']];
  for (const [ms, words] of cases) assert.equal(formatAge(ms), words, String(ms));
});

test("the scan-age limit: the build's setting, else the policy's, else the default", () => {
  const report = fixture();
  assert.equal(scanAgeLimit(report), DEFAULT_SCAN_AGE_DAYS);
  report.policy.maxScanAgeDays = 3;
  assert.equal(scanAgeLimit(report), 3);
  assert.equal(scanAgeLimit(report, 14), 14);
  assert.equal(scanAgeLimit(report, 0), 3);
});

test("each list holds the images its title says, and every list has a page", () => {
  const lists = new Map(imageLists(readBundle(MINIMAL).report, 7).map((l) => [l.key, l.images.map((i) => i.id)]));
  assert.deepEqual(lists.get('failed'), ['ghcr-io-acme-images-billing-1-4-2', 'docker-io-library-redis-7', 'cgr-dev-chainguard-static']);
  assert.deepEqual(lists.get('verified'), ['ghcr-io-acme-images-hello-app']);
  assert.deepEqual(lists.get('base-unresolved'), ['docker-io-library-redis-7']);
  assert.deepEqual(lists.get('not-scanned')?.sort(), ['cgr-dev-chainguard-static', 'docker-io-library-redis-7']);
  for (const o of outstanding(readBundle(MINIMAL).report, 7)) {
    if (o.path.startsWith('lists/')) assert.ok(lists.has(o.path.slice(6, -1)), o.path);
  }
});
