import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readBundle } from '../src/lib/bundle.ts';
import type { EstateReport } from '../src/lib/contract.gen.ts';
import { byVerdict } from '../src/lib/estate.ts';
import {
  DEFAULT_SCAN_AGE_DAYS,
  formatAge,
  imageLists,
  oldScans,
  outstanding,
  reasonGroups,
  reasonKind,
  scanAgeLimit,
  type ReasonKind,
  scanAges,
} from '../src/lib/overview.ts';
import { FIXTURE, MINIMAL } from './helpers.ts';

const fixture = () => structuredClone(readBundle(FIXTURE).report) as EstateReport;

test('reasons are grouped: one per reason, however many images give it, failed apart from undecided', () => {
  const groups = reasonGroups(fixture());
  assert.deepEqual(
    groups.map((g) => [g.kind, g.text, g.images.length, g.failed, g.unverified]),
    [
      ['failed', 'provenance is missing', 2, 2, 0],
      ['failed', 'sbom is missing', 2, 2, 0],
      ['failed', 'signature is missing', 2, 2, 0],
      // Given by failed images too, but these requirements weren't failed: they couldn't be decided.
      ['unknown', 'vulnerabilities are unknown (no scan)', 4, 2, 2],
      ['unknown', 'none of its evidence is verified, so a trusted signer vouched for nothing about it', 2, 2, 0],
    ],
  );
});

// Every reason clearcutt-verify gives (estateverify.verdictAt), as a failed
// image gives it: what the requirement came to, whatever the image's verdict.
const REASONS: [string, ReasonKind][] = [
  ['signature failed verification', 'failed'],
  ['sbom is missing', 'failed'],
  ['vulnerabilityScan is missing', 'failed'],
  ['3 vulnerabilities at critical or above', 'failed'],
  ['12 fixable vulnerabilities at high or above', 'failed'],
  ["1 fixable vulnerabilities at critical or above in this run's scan (grype 0.121.0, database built 2026-10-06)", 'failed'],
  ['base is 40 days behind its newest version (limit 30)', 'failed'],
  ['rebuilding gave a different digest', 'failed'],
  ['no trusted signer is configured, so nothing about it can be verified', 'unknown'],
  ['none of its evidence is verified, so a trusted signer vouched for nothing about it', 'unknown'],
  ['recipe is not applicable, and no verified evidence stands in for it', 'unknown'],
  ['sbom is present but not verified', 'unknown'],
  ["sbom is unknown (couldn't be read or checked)", 'unknown'],
  ['recipe is missing, and the rebase record that would stand in for it is present, not verified', 'unknown'],
  ['recipe is missing, and the rebase record that would stand in for it is unknown, not verified', 'unknown'],
  ['tests has status "weird", which isn\'t verified', 'unknown'],
  ['vulnerabilities are unknown (no scan)', 'unknown'],
  ['vulnerabilities are unknown (the vulnerability scan is present, not verified)', 'unknown'],
  ["vulnerabilities are unknown (the verified scan couldn't be read)", 'unknown'],
  ["current vulnerabilities are unknown (this run didn't rescan the image)", 'unknown'],
  ['current vulnerabilities are unknown (the rescan is unknown: no verified SBOM for linux/arm64)', 'unknown'],
  ["the rescan's age is unknown (no database build time or scan time)", 'unknown'],
  ["the rescan's vulnerability database is 9 days old (limit 7); what was published since is unknown", 'unknown'],
  ["the vulnerability scan's age is unknown (no verified scan of every platform)", 'unknown'],
  ['the vulnerability scan is 12 days old (limit 7); what was found since is unknown', 'unknown'],
  ["its base is 40 days behind its newest version (limit 30) by what the image claims (declared, oci-base-digest), which isn't proven by layer digests", 'unknown'],
  ["its base is behind its newest version, by how many days couldn't be measured", 'unknown'],
  ["how far its base is behind couldn't be measured", 'unknown'],
  ["reproducibility couldn't be checked", 'unknown'],
];

test("a failed image's reasons: each failed or couldn't be checked, by what it says", () => {
  for (const [reason, kind] of REASONS) assert.equal(reasonKind(reason, 'failed'), kind, reason);
});

test('an unverified image has nothing failed, and a reason this portal does not know is failed only on a failed image', () => {
  for (const [reason] of REASONS.filter(([, k]) => k === 'unknown')) assert.equal(reasonKind(reason, 'unverified'), 'unknown', reason);
  // Never quietly softened: an unknown reason on a failed image counts as failed.
  assert.equal(reasonKind('the moon is in the wrong phase', 'failed'), 'failed');
  assert.equal(reasonKind('the moon is in the wrong phase', 'unverified'), 'unknown');
  // Almost a failing reason, but not one.
  assert.equal(reasonKind('signature is missing, and something else', 'unverified'), 'unknown');
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
  // The static image failed, but the policy only observes it: it is listed apart.
  assert.deepEqual(lists.get('failed'), ['ghcr-io-acme-images-billing-1-4-2', 'docker-io-library-redis-7']);
  assert.deepEqual(lists.get('observe-only'), ['cgr-dev-chainguard-static']);
  assert.deepEqual(lists.get('verified'), ['ghcr-io-acme-images-hello-app']);
  assert.deepEqual(lists.get('base-unresolved'), ['docker-io-library-redis-7']);
  assert.deepEqual(lists.get('not-scanned')?.sort(), ['cgr-dev-chainguard-static', 'docker-io-library-redis-7']);
  for (const o of outstanding(readBundle(MINIMAL).report, 7)) {
    if (o.path.startsWith('lists/')) assert.ok(lists.has(o.path.slice(6, -1)), o.path);
  }
});

test('the verdict lists count what summary.verdicts counts, observe-only images apart', () => {
  for (const bundle of [MINIMAL, FIXTURE]) {
    const report = readBundle(bundle).report;
    const lists = new Map(imageLists(report, 7).map((l) => [l.key, l.images]));
    const v = report.summary.verdicts;
    assert.equal(lists.get('verified')!.length, v.verified, bundle);
    assert.equal(lists.get('failed')!.length, v.failed, bundle);
    assert.equal(lists.get('unverified')!.length, v.unverified, bundle);
    assert.equal(lists.get('observe-only')!.length, v.observeOnly ?? 0, bundle);
    assert.equal(v.verified + v.failed + v.unverified + (v.observeOnly ?? 0), report.summary.images, bundle);
  }
});

test('an observe-only image holds nothing back, and comes after every image the policy gates on', () => {
  const report = readBundle(MINIMAL).report;
  const reasons = reasonGroups(report).flatMap((g) => g.images.map((i) => i.image.id));
  assert.ok(reasons.includes('ghcr-io-acme-images-billing-1-4-2'));
  assert.ok(!reasons.includes('cgr-dev-chainguard-static'), 'the observe-only image is on no card');
  assert.deepEqual(byVerdict(report.images).map((i) => i.id), [
    'ghcr-io-acme-images-billing-1-4-2',
    'docker-io-library-redis-7',
    'ghcr-io-acme-images-hello-app',
    'cgr-dev-chainguard-static',
  ]);
});

test("with a rescan, what is outstanding counts this run's findings too, and the images it couldn't rescan", () => {
  const report = readBundle(MINIMAL).report;
  const items = outstanding(report, 7).map((o) => [o.text, o.path, o.tone]);
  assert.deepEqual(items.slice(1, 5), [
    ["1 high finding in the publishers' scans (0 with a fix)", 'findings/', 'warn'],
    ["1 critical finding in this run's scan (1 with a fix)", 'findings/', 'bad'],
    ["1 high finding in this run's scan (1 with a fix)", 'findings/', 'warn'],
    ["2 images this run couldn't rescan", 'lists/not-rescanned/', 'unknown'],
  ]);
  const lists = new Map(imageLists(report, 7).map((l) => [l.key, l.images.map((i) => i.id)]));
  assert.deepEqual(lists.get('not-rescanned'), ['docker-io-library-redis-7', 'cgr-dev-chainguard-static']);
  // Critical or high in the worse of the gated scans: billing's critical is this run's.
  assert.deepEqual(lists.get('critical-high'), ['ghcr-io-acme-images-billing-1-4-2']);
  // A run that didn't rescan has no such list, and says nothing of this run's scan.
  const plain = fixture();
  assert.ok(!imageLists(plain, 7).some((l) => l.key === 'not-rescanned'));
  assert.ok(!outstanding(plain, 7).some((o) => /this run's scan|rescan/.test(o.text)));
});
