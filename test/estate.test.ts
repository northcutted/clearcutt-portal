import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readBundle } from '../src/lib/bundle.ts';
import {
  baseGraph,
  byVerdict,
  chronological,
  consumersOf,
  imagesById,
  packagesOf,
  windowed,
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
  assert.deepEqual(graph.unresolved.map((i) => i.id), ['docker-io-library-redis-7']);
});

test('a base built on another base nests under it', () => {
  // Make the static image a consumer of wolfi-base: apps on static then sit
  // two levels down.
  const dir = editedBundle(FIXTURE, (r) => {
    const s = r.images.find((i: any) => i.id === 'cgr-dev-chainguard-static');
    delete s.root;
    s.base = {
      imageId: 'cgr-dev-chainguard-wolfi-base',
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
  const staticNode = wolfi.consumers.find((c) => c.image.id === 'cgr-dev-chainguard-static')!;
  assert.ok(staticNode.asBase);
  assert.deepEqual(staticNode.asBase!.consumers.map((c) => c.image.id), ['ghcr-io-northcutted-images-hello-app']);
  assert.ok(!graph.roots.some((n) => n.repository === 'cgr.dev/chainguard/static'));
});

test('stale images come most days behind first, then most versions behind', () => {
  // Every fixture image is current, so make three of them stale.
  const behind: Record<string, [number, number]> = { 'ghcr-io-northcutted-images-platform-tools': [3, 1], 'ghcr-io-northcutted-images-debian-tools': [17, 1], 'ghcr-io-northcutted-images-hello-app': [3, 2] };
  const report = readBundle(
    editedBundle(FIXTURE, (r) => {
      for (const image of r.images) {
        const b = behind[image.id];
        if (b) Object.assign(image.base, { drift: 'stale', daysBehind: b[0], versionsBehind: b[1] });
      }
    }),
  ).report;
  assert.deepEqual(staleImages(fixture), []);
  assert.deepEqual(staleImages(report).map((i) => i.id), ['ghcr-io-northcutted-images-debian-tools', 'ghcr-io-northcutted-images-hello-app', 'ghcr-io-northcutted-images-platform-tools']);
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
  const runs = imageRuns(history, 'cgr-dev-chainguard-static');
  assert.deepEqual(
    runs.map((r) => r.at),
    history!.entries.map((e) => e.generatedAt),
  );
  assert.equal(runs[0].row?.id, 'cgr-dev-chainguard-static'); // the latest run recorded it
  assert.equal(runs[1].row, null); // the previous one recorded rows, without it
  assert.equal(runs[2].row, undefined); // the oldest recorded no rows
  assert.deepEqual(imageRuns(null, 'cgr-dev-chainguard-static'), []);
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

test("an app's registry stack is found by the version it is pinned to", () => {
  const report = readBundle(v015Bundle()).report;
  const hello = report.images.find((i) => i.id === 'ghcr-io-northcutted-images-hello-app')!;
  const found = stackOf(report, hello)!;
  assert.equal(found.stack.ref, STACK_REF);
  assert.equal(found.version.digest, hello.factory!.stackDigest);
  assert.equal(stackAnchor(found.stack), 'stack-ghcr-io-northcutted-stacks-go');
  assert.equal(stackOf(fixture, fixture.images.find((i) => i.id === 'ghcr-io-northcutted-images-hello-app')!), undefined);
});

test('runs are in the order of the times they name, and the latest is the latest', () => {
  const summary = minimal.summary;
  const history = {
    apiVersion: 'clearcutt.dev/v1' as const,
    kind: 'EstateHistory' as const,
    name: 'x',
    // Newest first, as the file lists them; by text, 18:00+02:00 would be the
    // newest and 46Z newer than 46.5Z.
    entries: ['2026-10-10T17:00:00Z', '2026-10-10T18:00:00+02:00', '2026-10-10T15:51:46.5Z', '2026-10-10T15:51:46Z'].map(
      (generatedAt) => ({ generatedAt, summary }),
    ),
  };
  assert.deepEqual(
    chronological(history).map((e) => e.generatedAt),
    ['2026-10-10T15:51:46Z', '2026-10-10T15:51:46.5Z', '2026-10-10T18:00:00+02:00', '2026-10-10T17:00:00Z'],
  );
  // Two runs at the same instant: the one the file lists first is the later.
  const tie = { ...history, entries: [{ generatedAt: '2026-10-10T16:00:00Z', ref: 'second', summary }, { generatedAt: '2026-10-10T18:00:00+02:00', ref: 'first', summary }] };
  assert.deepEqual(chronological(tie).map((e) => e.ref), ['first', 'second']);
  assert.deepEqual(chronological({ ...history, entries: [] }), []);
});

test('the per-report indexes answer as a scan of the report would', () => {
  for (const report of [fixture, minimal]) {
    for (const image of report.images) {
      assert.deepEqual(
        packagesOf(report, image),
        report.packages.filter((p) => p.images.includes(image.id)).sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version)),
      );
      assert.deepEqual(consumersOf(report, image), report.images.filter((o) => o.base?.imageId === image.id));
      assert.equal(imagesById(report).get(image.id), image);
    }
  }
  // A caller can't change what the next one gets.
  const image = fixture.images.find((i) => i.id === 'ghcr-io-northcutted-images-debian-tools')!;
  packagesOf(fixture, image).length = 0;
  assert.ok(packagesOf(fixture, image).length > 0);
});

test('a windowed history: the latest runs only, the same rows', () => {
  assert.deepEqual(windowed([1, 2, 3, 4], 2), [3, 4]);
  assert.deepEqual(windowed([1, 2, 3, 4], 0), [1, 2, 3, 4]);
  assert.deepEqual(windowed([1, 2], 5), [1, 2]);
  const history = readBundle(v015Bundle()).history;
  const all = imageRuns(history, 'ghcr-io-northcutted-images-debian-tools');
  assert.equal(all.length, 3);
  assert.deepEqual(imageRuns(history, 'ghcr-io-northcutted-images-debian-tools', 2), all.slice(0, 2), 'the newest two, newest first');
  assert.deepEqual(imageRuns(history, 'ghcr-io-northcutted-images-debian-tools', 0), all);
  // A row lookup says absent (null) apart from not recorded (undefined).
  assert.deepEqual(all.map((r) => (r.row === undefined ? 'unrecorded' : r.row === null ? 'absent' : r.row.id)), ['ghcr-io-northcutted-images-debian-tools', 'ghcr-io-northcutted-images-debian-tools', 'unrecorded']);
  assert.equal(imageRuns(history, 'retired-image')[0].row, null);
});
