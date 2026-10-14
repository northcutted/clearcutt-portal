import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readBundle } from '../src/lib/bundle.ts';
import {
  baseGraph,
  byVerdict,
  chronological,
  imageChanges,
  imageRuns,
  packageGroups,
  packagesUnknown,
  rebasesOf,
  stackAnchor,
  stackOf,
  staleImages,
} from '../src/lib/estate.ts';
import { FIXTURE, MINIMAL, STACK_REF, editedBundle, v015Bundle } from './helpers.ts';

const fixture = readBundle(FIXTURE).report;
const minimal = readBundle(MINIMAL).report;

test('every image with a base appears once in the base graph', () => {
  for (const report of [fixture, minimal]) {
    const graph = baseGraph(report);
    const placed: string[] = [];
    const walk = (node: (typeof graph.roots)[number]) => {
      for (const c of node.consumers) {
        placed.push(c.image.id);
        if (c.asBase) walk(c.asBase);
      }
    };
    graph.roots.forEach(walk);
    const withBase = report.images.filter((i) => i.base).map((i) => i.id);
    assert.deepEqual([...placed].sort(), [...withBase].sort());
  }
});

test('images whose base is unknown are listed as unresolved, not dropped', () => {
  const graph = baseGraph(minimal);
  assert.deepEqual(graph.unresolved.map((i) => i.id), ['docker-io-library-redis']);
});

test('a base built on another base nests under it', () => {
  // Make the static image a consumer of wolfi-base: apps on static then sit
  // two levels down.
  const dir = editedBundle(FIXTURE, (r) => {
    const s = r.images.find((i: any) => i.id === 'static');
    delete s.root;
    s.base = {
      imageId: 'wolfi-base',
      repository: 'cgr.dev/chainguard/wolfi-base',
      ref: 'cgr.dev/chainguard/wolfi-base:latest',
      method: 'layer-prefix',
      strength: 'proof',
      drift: 'current',
      versionsBehind: 0,
      daysBehind: 0,
    };
  });
  const graph = baseGraph(readBundle(dir).report);
  const wolfi = graph.roots.find((n) => n.repository === 'cgr.dev/chainguard/wolfi-base')!;
  const staticNode = wolfi.consumers.find((c) => c.image.id === 'static')!;
  assert.ok(staticNode.asBase);
  assert.deepEqual(staticNode.asBase!.consumers.map((c) => c.image.id), ['hello-app']);
  assert.ok(!graph.roots.some((n) => n.repository === 'cgr.dev/chainguard/static'));
});

test('stale images come most days behind first, then most versions behind', () => {
  // Every fixture image is current, so make three of them stale.
  const behind: Record<string, [number, number]> = { 'platform-tools': [3, 1], 'debian-tools': [17, 1], 'hello-app': [3, 2] };
  const report = readBundle(
    editedBundle(FIXTURE, (r) => {
      for (const image of r.images) {
        const b = behind[image.id];
        if (b) Object.assign(image.base, { drift: 'stale', daysBehind: b[0], versionsBehind: b[1] });
      }
    }),
  ).report;
  assert.deepEqual(staleImages(fixture), []);
  assert.deepEqual(staleImages(report).map((i) => i.id), ['debian-tools', 'hello-app', 'platform-tools']);
});

test('verdict order is failed, unverified, verified', () => {
  const order = byVerdict(fixture.images).map((i) => i.verdict.status);
  assert.deepEqual(order, [...order].sort((a, b) => ['failed', 'unverified', 'verified'].indexOf(a) - ['failed', 'unverified', 'verified'].indexOf(b)));
});

test('package groups have unique slugs and cover every package version', () => {
  const groups = packageGroups(fixture);
  assert.equal(new Set(groups.map((g) => g.slug)).size, groups.length);
  assert.equal(groups.reduce((n, g) => n + g.versions.length, 0), fixture.packages.length);
  for (const g of groups) assert.match(g.slug, /^[a-z0-9._-]+$/);
});

test('images without a package set are reported as not covered', () => {
  assert.equal(packagesUnknown(fixture).length, fixture.summary.packages.unknown);
  assert.equal(packagesUnknown(minimal).length, minimal.summary.packages.unknown);
});

test('history reads oldest first for charts', () => {
  const series = chronological(readBundle(MINIMAL).history);
  assert.ok(series[0].generatedAt < series[1].generatedAt);
  assert.deepEqual(chronological(null), []);
});

test("an image's runs say which recorded rows, and whether it was in them", () => {
  const { history } = readBundle(v015Bundle());
  const runs = imageRuns(history, 'static');
  assert.deepEqual(
    runs.map((r) => r.at),
    history!.entries.map((e) => e.generatedAt),
  );
  assert.equal(runs[0].row?.id, 'static'); // the latest run recorded it
  assert.equal(runs[1].row, null); // the previous one recorded rows, without it
  assert.equal(runs[2].row, undefined); // the oldest recorded no rows
  assert.deepEqual(imageRuns(null, 'static'), []);
});

test('rebases are listed once each, newest first, from the run that first recorded them', () => {
  const row = (rebasedFrom: string | undefined, digest: string) => ({ id: 'x', digest, verdict: 'verified', rebasedFrom });
  const runs = [
    { at: '2026-10-04T00:00:00Z', row: row('repo@sha256:b', 'sha256:c') },
    { at: '2026-10-03T00:00:00Z', row: row('repo@sha256:b', 'sha256:c') },
    { at: '2026-10-02T00:00:00Z', row: row('repo@sha256:a', 'sha256:b') },
    { at: '2026-10-01T00:00:00Z', row: row(undefined, 'sha256:a') },
    { at: '2026-09-30T00:00:00Z', row: undefined },
  ];
  assert.deepEqual(
    rebasesOf(runs).map((r) => [r.at, r.from, r.digest]),
    [
      ['2026-10-03T00:00:00Z', 'repo@sha256:b', 'sha256:c'],
      ['2026-10-02T00:00:00Z', 'repo@sha256:a', 'sha256:b'],
    ],
  );
});

test('per-image changes between two runs need rows in both', () => {
  const { history } = readBundle(v015Bundle());
  const [latest, previous, oldest] = history!.entries;
  assert.equal(imageChanges(previous, oldest), null);
  const changes = imageChanges(latest, previous)!;
  assert.deepEqual(
    changes.map((c) => [c.id, c.kind]),
    [
      ['retired-image', 'removed'],
      ['static', 'added'],
      ['debian-tools', 'changed'],
      ['platform-tools', 'changed'],
    ],
  );
  const debian = changes.find((c) => c.id === 'debian-tools')!;
  assert.deepEqual(debian.verdict, ['failed', 'verified']);
  assert.ok(debian.digest);
  assert.equal(debian.critical![0], 30);
  assert.deepEqual(changes.find((c) => c.id === 'platform-tools')!.drift, ['stale', 'current']);
  // An unchanged run has nothing to say.
  assert.deepEqual(imageChanges(latest, latest), []);
});

test("an app's registry stack is found by the version it is pinned to", () => {
  const report = readBundle(v015Bundle()).report;
  const hello = report.images.find((i) => i.id === 'hello-app')!;
  const found = stackOf(report, hello)!;
  assert.equal(found.stack.ref, STACK_REF);
  assert.equal(found.version.digest, hello.factory!.stackDigest);
  assert.equal(stackAnchor(found.stack), 'stack-ghcr-io-northcutted-stacks-go');
  assert.equal(stackOf(fixture, fixture.images.find((i) => i.id === 'hello-app')!), undefined);
});
