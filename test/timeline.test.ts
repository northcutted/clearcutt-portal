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
  historyRuns,
  howWords,
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
  assert.equal(runSlug('2026-10-10T16:51:46.123Z'), '20261010T165146Z');
  assert.equal(runSlug('yesterday'), 'run');
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
  assert.deepEqual(twice.map((r) => r.slug).sort(), ['20261010T165146Z', '20261010T165146Z-2', 'run']);
  for (const r of twice) assert.match(r.slug, /^[A-Za-z0-9-]+$/);
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
      ['static', 'added'],
      ['debian-tools', 'rebuilt'],
      ['platform-tools', 'base-moved'],
    ],
  );
  const hows = countHows(diffs);
  assert.deepEqual([hows.removed, hows.added, hows.rebuilt, hows['base-moved'], hows.rebased], [1, 1, 1, 1, 0]);
  assert.equal(hows.unchanged, diffs.length - 4);
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

test('the comparisons to pre-render: each run with the one before, and with the latest', () => {
  const runs = historyRuns(readBundle(FIXTURE).history);
  const pairs = comparisons(runs).map((c) => [c.older.slug, c.newer.slug]);
  assert.deepEqual(pairs, [
    ['20261006T233046Z', '20261010T165146Z'],
    ['20261006T231441Z', '20261006T233046Z'],
    ['20261006T231441Z', '20261010T165146Z'],
  ]);
  assert.equal(comparisons(runs)[0].slug, '20261006T233046Z--20261010T165146Z');
  assert.deepEqual(comparisons(runs.slice(0, 1)), []);
  assert.deepEqual(comparisons([]), []);
});
