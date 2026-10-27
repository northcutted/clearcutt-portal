import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readBundle } from '../src/lib/bundle.ts';
import type { HistoryEntry, HistoryImage } from '../src/lib/contract.gen.ts';
import {
  changed,
  comparisons,
  countHows,
  diffImage,
  diffRuns,
  findingsDrill,
  fixableDrill,
  historyRuns,
  howWords,
  recordsIds,
  runSlug,
} from '../src/lib/timeline.ts';
import { FIXTURE, MINIMAL, v015Bundle } from './helpers.ts';

const D = (c: string) => `sha256:${c.repeat(64)}`;
const counts = (critical: number, high = 0) => ({ critical, high, medium: 0, low: 0, negligible: 0, unknown: 0 });
const row = (over: Partial<HistoryImage> & { id: string }): HistoryImage => ({ digest: D('a'), verdict: 'verified', ...over });
const base = (digest: string, drift = 'current') => ({ digest, drift, strength: 'proof' });

test('a run is named by its time, uniquely', () => {
  assert.equal(runSlug('2026-10-10T16:51:46Z'), '20261010T165146Z');
  assert.equal(runSlug('2026-10-10T18:51:46+02:00'), '20261010T165146Z');
  assert.equal(runSlug('2026-10-10T16:51:46.123Z'), '20261010T165146.123Z');
  assert.equal(runSlug('2026-10-10T16:51:46.5Z'), '20261010T165146.500Z');
  // A time that doesn't parse is named by its text, not by where it is.
  assert.match(runSlug('yesterday'), /^run-[0-9a-f]{8}$/);
  assert.equal(runSlug('yesterday'), runSlug('yesterday'));
  assert.notEqual(runSlug('yesterday'), runSlug('tomorrow'));
  const runs = historyRuns(readBundle(MINIMAL).history);
  assert.deepEqual(runs.map((r) => r.slug), ['20261005T060000Z', '20261006T060000Z']);
  const twice = historyRuns({
    apiVersion: 'clearcutt.dev/v1',
    kind: 'EstateHistory',
    name: 'x',
    entries: [{ generatedAt: '2026-10-10T16:51:46.5Z' }, { generatedAt: '2026-10-10T16:51:46.1Z' }, { generatedAt: 'nope' }].map(
      (e) => ({ ...e, summary: readBundle(MINIMAL).report.summary }) as HistoryEntry,
    ),
  });
  assert.deepEqual(twice.map((r) => r.slug).sort(), ['20261010T165146.100Z', '20261010T165146.500Z', runSlug('nope')]);
  for (const r of twice) assert.match(r.slug, /^[A-Za-z0-9.-]+$/);
  // Only the very same instant shares a stem; the later-listed is the older.
  const same = historyRuns({
    apiVersion: 'clearcutt.dev/v1',
    kind: 'EstateHistory',
    name: 'x',
    entries: [{ generatedAt: '2026-10-10T16:51:46Z', ref: 'newer' }, { generatedAt: '2026-10-10T18:51:46+02:00', ref: 'older' }].map(
      (e) => ({ ...e, summary: readBundle(MINIMAL).report.summary }) as HistoryEntry,
    ),
  });
  assert.deepEqual(same.map((r) => [r.ref, r.slug]), [['older', '20261010T165146Z'], ['newer', '20261010T165146Z-2']]);
});

test('how an image changed: rebased, rebuilt with or without a new base, base moved, unchanged', () => {
  const before = row({ id: 'x', base: base(D('b')), vulnerabilities: counts(3, 1) });
  assert.equal(diffImage('x', before, before).how, 'unchanged');
  assert.equal(diffImage('x', undefined, before).how, 'added');
  assert.equal(diffImage('x', before, undefined).how, 'removed');

  const rebuiltSame = diffImage('x', before, { ...before, digest: D('c') });
  assert.deepEqual([rebuiltSame.how, rebuiltSame.newBase, howWords(rebuiltSame).label], ['rebuilt', false, 'Rebuilt, same base']);
  const rebuiltNew = diffImage('x', before, { ...before, digest: D('c'), base: base(D('d')) });
  assert.deepEqual([rebuiltNew.how, rebuiltNew.newBase, howWords(rebuiltNew).label], ['rebuilt', true, 'Rebuilt on a new base']);
  const rebuiltUnknown = diffImage('x', { ...before, base: undefined }, { ...before, digest: D('c') });
  assert.deepEqual([rebuiltUnknown.newBase, howWords(rebuiltUnknown).label], [null, 'Rebuilt']);
  // A claimed base with no version identified has an empty digest, or none: not recorded, not a change.
  const claimedBase = { ...before.base!, digest: '' };
  const claimed = diffImage('x', { ...before, base: claimedBase }, { ...before, digest: D('c'), base: claimedBase });
  assert.deepEqual([claimed.newBase, howWords(claimed).label], [null, 'Rebuilt']);

  const rebased = diffImage('x', before, { ...before, digest: D('c'), base: base(D('d')), rebasedFrom: `ghcr.io/acme/x@${D('a')}`, rebaseStatus: 'verified' });
  assert.deepEqual([rebased.how, rebased.newBase], ['rebased', true]);
  // The same rebase record in both runs isn't a new rebase.
  const again = { ...before, digest: D('c'), rebasedFrom: `ghcr.io/acme/x@${D('a')}` };
  assert.equal(diffImage('x', again, { ...again, digest: D('e') }).how, 'rebuilt');

  const moved = diffImage('x', before, { ...before, base: base(D('b'), 'stale') });
  assert.deepEqual([moved.how, moved.drift, howWords(moved).meaning], ['base-moved', ['current', 'stale'], 'The same image, but its base has a newer version now.']);
});

test('verdicts and findings change apart from the image', () => {
  const before = row({ id: 'x', vulnerabilities: counts(3, 1) });
  const rescanned = diffImage('x', before, { ...before, verdict: 'failed', vulnerabilities: counts(5, 1) });
  assert.equal(rescanned.how, 'unchanged');
  assert.deepEqual(rescanned.verdict, ['verified', 'failed']);
  assert.deepEqual(rescanned.findingsChanged, ['critical']);
  assert.deepEqual(rescanned.findings.critical, [3, 5]);
  assert.ok(changed(rescanned));
  assert.ok(!changed(diffImage('x', before, before)));
  // No vulnerability data is unknown, never zero.
  const unscanned = diffImage('x', before, { ...before, vulnerabilities: undefined });
  assert.deepEqual(unscanned.findings.critical, [3, null]);
  assert.deepEqual(unscanned.findingsChanged, ['critical', 'high', 'medium', 'low', 'negligible', 'unknown']);
});

test('two runs compare only when both recorded rows', () => {
  const fixture = readBundle(FIXTURE).history!;
  const [latest, previous] = fixture.entries;
  assert.equal(diffRuns(previous, latest), null);
  const history = readBundle(v015Bundle()).history!;
  const diffs = diffRuns(history.entries[1], history.entries[0])!;
  assert.deepEqual(
    diffs.filter(changed).map((d) => [d.id, d.how]),
    [
      ['retired-image', 'removed'],
      ['cgr-dev-chainguard-static', 'added'],
      ['ghcr-io-northcutted-images-debian-tools', 'rebuilt'],
      ['ghcr-io-northcutted-images-platform-tools', 'base-moved'],
    ],
  );
  const hows = countHows(diffs);
  assert.deepEqual([hows.removed, hows.added, hows.rebuilt, hows['base-moved'], hows.rebased], [1, 1, 1, 1, 0]);
  assert.equal(hows.unchanged, diffs.length - 4);
});

test('an unchanged run has nothing to say', () => {
  const history = readBundle(v015Bundle()).history!;
  assert.deepEqual(diffRuns(history.entries[0], history.entries[0])!.filter(changed), []);
});

test('fixable findings by ID: fixed and introduced only when both runs list them', () => {
  const before = row({ id: 'x', vulnerabilities: counts(1, 2), fixableFindings: ['CVE-1', 'GO-2'], packagesDigest: D('1') });
  const after = row({ id: 'x', digest: D('c'), vulnerabilities: counts(1, 2), fixableFindings: ['GO-2', 'GO-3'], packagesDigest: D('2') });
  const d = diffImage('x', before, after, [true, true]);
  assert.deepEqual([d.fixed, d.introduced, d.packagesChanged], [['CVE-1'], ['GO-3'], true]);
  // The same counts, different findings: still a change.
  assert.deepEqual(d.findingsChanged, []);
  assert.ok(changed(diffImage('x', before, { ...after, digest: before.digest }, [true, true])));
  // With vulnerability data and no list, a run that lists IDs has none.
  const none = diffImage('x', before, { ...before, fixableFindings: undefined }, [true, true]);
  assert.deepEqual([none.fixed, none.introduced], [['CVE-1', 'GO-2'], []]);
  // A run that never lists IDs (v0.15) says nothing about them.
  const old = diffImage('x', { ...before, fixableFindings: undefined, packagesDigest: undefined }, after, [false, true]);
  assert.deepEqual([old.fixable, old.fixed, old.introduced, old.packagesChanged], [[null, ['GO-2', 'GO-3']], null, null, null]);
  // No vulnerability data is unknown, whatever the run lists.
  assert.equal(diffImage('x', before, { ...after, vulnerabilities: undefined }, [true, true]).fixed, null);
  // The same package digest is the same package set; a missing one is unknown.
  assert.equal(diffImage('x', before, { ...after, packagesDigest: D('1') }, [true, true]).packagesChanged, false);
  assert.equal(diffImage('x', before, { ...after, packagesDigest: undefined }, [true, true]).packagesChanged, null);
  assert.deepEqual(diffImage('x', undefined, after, [true, true]).fixed, null);
});

test('a run lists IDs when any of its rows has fixable findings or a package digest', () => {
  const history = readBundle(FIXTURE).history!;
  assert.ok(recordsIds(history.entries[0]));
  assert.ok(!recordsIds(history.entries[1]));
  assert.ok(!recordsIds(readBundle(MINIMAL).history!.entries[0]));
});

test('the fixable findings drill: who had each finding, who has it, where it was fixed or introduced', () => {
  const r = (id: string, ids: string[]) => row({ id, vulnerabilities: counts(0, ids.length), fixableFindings: ids });
  const diffs = [
    diffImage('a', r('a', ['CVE-1', 'CVE-2']), r('a', ['CVE-2']), [true, true]),
    diffImage('b', r('b', []), r('b', ['CVE-2', 'CVE-3']), [true, true]),
    diffImage('c', undefined, r('c', ['CVE-3']), [true, true]),
  ];
  assert.deepEqual(fixableDrill(diffs), [
    { id: 'CVE-2', before: ['a'], after: ['a', 'b'], fixed: [], introduced: ['b'] },
    { id: 'CVE-3', before: [], after: ['b', 'c'], fixed: [], introduced: ['b'] },
    { id: 'CVE-1', before: ['a'], after: [], fixed: ['a'], introduced: [] },
  ]);
  assert.equal(fixableDrill([diffImage('a', r('a', ['CVE-1']), r('a', []))]), null);
});

test('the findings drill says who had findings before, who after, and who cleared them', () => {
  const diffs = [
    diffImage('fixed', row({ id: 'fixed', vulnerabilities: counts(2) }), row({ id: 'fixed', digest: D('c'), vulnerabilities: counts(0) })),
    diffImage('worse', row({ id: 'worse', vulnerabilities: counts(0) }), row({ id: 'worse', vulnerabilities: counts(1) })),
    diffImage('still', row({ id: 'still', vulnerabilities: counts(4) }), row({ id: 'still', vulnerabilities: counts(1) })),
    diffImage('lost', row({ id: 'lost', vulnerabilities: counts(1) }), row({ id: 'lost' })),
    diffImage('new', undefined, row({ id: 'new', vulnerabilities: counts(7) })),
    diffImage('clean', row({ id: 'clean', vulnerabilities: counts(0) }), row({ id: 'clean', vulnerabilities: counts(0) })),
  ];
  const [critical, ...rest] = findingsDrill(diffs);
  assert.deepEqual(critical, {
    severity: 'critical',
    before: ['fixed', 'still', 'lost'],
    after: ['worse', 'still', 'new'],
    cleared: ['fixed'],
    appeared: ['worse'],
    unknown: ['lost'],
  });
  // Severities nobody had are left out; one only unknown stays.
  assert.deepEqual(rest.map((d) => d.severity), ['high', 'medium', 'low', 'negligible', 'unknown']);
  assert.deepEqual(rest[0], { severity: 'high', before: [], after: [], cleared: [], appeared: [], unknown: ['lost'] });
});

test('the comparisons to pre-render: each run with the one before, and since each run', () => {
  const runs = historyRuns(readBundle(FIXTURE).history);
  const pairs = comparisons(runs).map((c) => [c.older.slug, c.newer.slug, c.slug]);
  assert.deepEqual(pairs, [
    ['20261006T233046Z', '20261010T165146Z', '20261006T233046Z--20261010T165146Z'],
    ['20261006T231441Z', '20261006T233046Z', '20261006T231441Z--20261006T233046Z'],
    ['20261006T233046Z', '20261010T165146Z', '20261006T233046Z--latest'],
    ['20261006T231441Z', '20261010T165146Z', '20261006T231441Z--latest'],
  ]);
  assert.deepEqual(comparisons(runs.slice(0, 1)), []);
  assert.deepEqual(comparisons([]), []);
});

test('comparison links stay put when a newer run arrives, and never change which runs they name', () => {
  const history = readBundle(FIXTURE).history!;
  const before = comparisons(historyRuns(history));
  // The next run, at the front of the file as clearcutt-verify writes it.
  const next = { ...history, entries: [{ ...history.entries[0], generatedAt: '2026-10-11T06:00:00Z' }, ...history.entries] };
  const after = new Map(comparisons(historyRuns(next)).map((c) => [c.slug, c]));
  for (const c of before) {
    const now = after.get(c.slug);
    assert.ok(now, `${c.slug} is still a page`);
    assert.equal(now.older.at, c.older.at, c.slug);
    // A pair names the same two runs; "since" a run now runs to the newer latest.
    assert.equal(now.newer.at, c.sinceLatest ? '2026-10-11T06:00:00Z' : c.newer.at, c.slug);
  }
  // And no run is renamed, whatever order the file lists them in.
  const slugs = (h: typeof history) => new Map(historyRuns(h).map((r) => [r.at, r.slug]));
  const old = slugs(history);
  for (const [at, slug] of slugs(next)) if (old.has(at)) assert.equal(slug, old.get(at));
  assert.deepEqual(slugs({ ...history, entries: [...history.entries].reverse() }), old);
});

test('fresh scan history changes independently of publisher scans and unknown stays unknown', () => {
 const before = row({id:'x',vulnerabilities:counts(0),rescanVulnerabilities:counts(3,1)});
 const after = {...before,rescanVulnerabilities:counts(0,2)};
 const diff = diffImage('x',before,after);
 assert.deepEqual(diff.findingsChanged,[]);
 assert.deepEqual(diff.rescanFindings.critical,[3,0]);
 assert.deepEqual(diff.rescanChanged,['critical','high']);
 assert.equal(changed(diff),true);
 const unknown = diffImage('x',after,{...after,rescanVulnerabilities:undefined});
 assert.deepEqual(unknown.rescanFindings.critical,[0,null]);
 assert.equal(changed(unknown),true);
 const added = diffImage('x',undefined,after);
 assert.deepEqual(added.rescanFindings.high,[null,2]);
 const removed = diffImage('x',before,undefined);
 assert.deepEqual(removed.rescanFindings.critical,[3,null]);
 assert.equal(changed(diffImage('x',before,before)),false);
});

test('becoming observe-only is a history change even when the verdict stays the same', () => {
 const before=row({id:'x'});
 const diff=diffImage('x',before,{...before,observeOnly:true});
 assert.deepEqual(diff.observeOnly,[false,true]);
 assert.equal(changed(diff),true);
 assert.deepEqual(diffImage('x',{...before,observeOnly:true},before).observeOnly,[true,false]);
 assert.equal(diffImage('x',before,{...before,observeOnly:false}).observeOnly,undefined);
});
