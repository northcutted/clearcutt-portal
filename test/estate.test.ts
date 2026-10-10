import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readBundle } from '../src/lib/bundle.ts';
import { baseGraph, byVerdict, chronological, packageGroups, packagesUnknown, staleImages } from '../src/lib/estate.ts';
import { FIXTURE, MINIMAL, editedBundle } from './helpers.ts';

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

test('stale images come most days behind first', () => {
  assert.deepEqual(staleImages(fixture).map((i) => i.id), ['debian-tools', 'platform-tools']);
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
