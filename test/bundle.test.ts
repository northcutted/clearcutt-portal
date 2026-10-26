import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { BundleError, describeNotes, newerThan, readBundle } from '../src/lib/bundle.ts';
import { CONTRACT_UPSTREAM } from '../src/lib/contract.gen.ts';
import { editedBundle, FIXTURE, MINIMAL, scratch, v015Bundle } from './helpers.ts';

test('the vendored fixture and example are valid bundles', () => {
  for (const dir of [FIXTURE, MINIMAL]) {
    const bundle = readBundle(dir);
    assert.equal(bundle.report.apiVersion, 'clearcutt.dev/v1');
    assert.ok(bundle.report.images.length > 0);
    assert.ok(bundle.history);
  }
});

test('a directory without a report is not a bundle', () => {
  const dir = scratch('portal-empty-');
  assert.throws(() => readBundle(dir), (err: Error) => err instanceof BundleError && /not found/.test(err.message));
});

test('history is optional', () => {
  const dir = editedBundle(MINIMAL, () => {});
  rmSync(path.join(dir, 'estate-history.json'));
  assert.equal(readBundle(dir).history, null);
});

test('another apiVersion is refused by name', () => {
  const dir = editedBundle(MINIMAL, (r) => (r.apiVersion = 'clearcutt.dev/v2'));
  assert.throws(() => readBundle(dir), /apiVersion is "clearcutt.dev\/v2"; this portal reads clearcutt.dev\/v1/);
});

test('a status outside the contract fails validation', () => {
  const dir = editedBundle(MINIMAL, (r) => (r.images[0].evidence.signature.status = 'probably-fine'));
  assert.throws(() => readBundle(dir), /does not match the EstateReport schema[\s\S]*\/images\/0\/evidence\/signature\/status/);
});

test('a missing required field fails validation', () => {
  const dir = editedBundle(MINIMAL, (r) => delete r.images[0].verdict);
  assert.throws(() => readBundle(dir), /must have required property 'verdict'/);
});

test('fields from a newer v1 are accepted, as the contract requires, and named, never dropped silently', () => {
  const dir = editedBundle(
    MINIMAL,
    (r) => {
      r.newTopLevelField = { anything: true };
      r.images[0].evidence.signature.newDetail = 'later';
      r.images[2].evidence.signature.newDetail = 'later';
      r.images[1]['odd\n::stop-commands::x'] = 1;
    },
    (h) => {
      h.entries[0].newEntryField = 1;
    },
  );
  const bundle = readBundle(dir);
  assert.equal(bundle.report.images.length, 4);
  assert.deepEqual(bundle.notes.unknownFields, [
    { file: 'estate-report.json', paths: ['images[]."odd\\n::stop-commands::x"', 'images[].evidence.signature.newDetail', 'newTopLevelField'] },
    { file: 'estate-history.json', paths: ['entries[].newEntryField'] },
  ]);
  const lines = describeNotes(bundle.notes);
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^estate-report\.json has 3 fields this portal's contract doesn't define, so no page shows them: /);
  for (const line of lines) assert.doesNotMatch(line, /[\n\r]/, 'one line each, whatever the field names');
});

test('the vendored bundles are covered by the contract, with nothing to say', () => {
  for (const dir of [FIXTURE, MINIMAL]) assert.deepEqual(readBundle(dir).notes, { unknownFields: [] });
});

test('a report from a newer clearcutt-verify release is called so', () => {
  const release = CONTRACT_UPSTREAM.release;
  assert.match(release, /^v\d+\.\d+\.\d+$/);
  const cases: [string, boolean][] = [
    ['v0.17.0', true],
    ['0.16.1', true],
    ['v1.0.0', true],
    ['v0.17.0-rc.1', true],
    ['v0.16.0-3-gabc1234', true],
    ['v0.16.0', false],
    ['v0.15.9', false],
    ['v0.16.0-rc.1', false],
    ['v0.15.0-28-gdde0145', false],
    ['dev', false],
    ['', false],
    ['v0.17', false],
  ];
  for (const [version, newer] of cases) assert.equal(newerThan(version, 'v0.16.0'), newer, version);
  assert.equal(newerThan('v9.0.0', 'none'), false, 'nothing to compare with');
  const dir = editedBundle(MINIMAL, (r) => (r.metadata.generator = { name: 'clearcutt-verify', version: 'v99.0.0' }));
  assert.deepEqual(readBundle(dir).notes.newerGenerator, { version: 'v99.0.0', builtAgainst: release });
  assert.match(describeNotes(readBundle(dir).notes)[0], new RegExp(`written by clearcutt-verify v99\\.0\\.0, newer than ${release.replace(/\./g, '\\.')}`));
  // Another tool's version says nothing about verify's contract.
  const other = editedBundle(MINIMAL, (r) => (r.metadata.generator = { name: 'something-else', version: 'v99.0.0' }));
  assert.equal(readBundle(other).notes.newerGenerator, undefined);
});

test('duplicate image IDs are refused, since they are URLs', () => {
  const dir = editedBundle(MINIMAL, (r) => (r.images[1].id = r.images[0].id));
  assert.throws(() => readBundle(dir), /appears more than once/);
});

test('a base.imageId must name an image in the report', () => {
  const dir = editedBundle(MINIMAL, (r) => {
    const consumer = r.images.find((i: any) => i.base?.imageId);
    consumer.base.imageId = 'nowhere';
  });
  assert.throws(() => readBundle(dir), /base.imageId "nowhere" is not an image in the report/);
});

test('packages must name images in the report', () => {
  const dir = editedBundle(MINIMAL, (r) => r.packages[0].images.push('nowhere'));
  assert.throws(() => readBundle(dir), /image "nowhere" is not an image in the report/);
});

test('image ids must be plain page names, since each is a directory and a URL', () => {
  for (const id of ['../../escape', 'a/b', 'a\\b', '..', '.hidden', '-dash', 'has space', 'é', '', 'x'.repeat(129)]) {
    const dir = editedBundle(MINIMAL, (r) => {
      // Keep the report's own references consistent, so the id is the only problem.
      const old = r.images[0].id;
      r.images[0].id = id;
      for (const pkg of r.packages) pkg.images = pkg.images.map((i: string) => (i === old ? id : i));
      for (const image of r.images) if (image.base?.imageId === old) image.base.imageId = id;
    });
    assert.throws(
      () => readBundle(dir),
      (err: Error) => err instanceof BundleError && err.message.includes(`image id ${JSON.stringify(id)} can't name a page`),
      JSON.stringify(id),
    );
  }
});

test('image ids may use letters, digits, dots, underscores, and dashes', () => {
  const redis = (r: any) => r.images.findIndex((i: any) => i.id === 'docker-io-library-redis-7');
  const dir = editedBundle(MINIMAL, (r) => (r.images[redis(r)].id = 'Redis_7.2-alpine'));
  assert.ok(readBundle(dir).report.images.some((i) => i.id === 'Redis_7.2-alpine'));
});

test('an empty base.imageId links to nothing, and is no error: a claimed base, no version identified', () => {
  const dir = editedBundle(MINIMAL, (r) => {
    const hello = r.images.find((i: any) => i.id === 'ghcr-io-acme-images-hello-app');
    hello.base = { ...hello.base, method: 'oci-base-name', strength: 'assisted', drift: 'unknown', imageId: '', digest: '' };
  });
  assert.equal(readBundle(dir).report.images.find((i) => i.id === 'ghcr-io-acme-images-hello-app')?.base?.imageId, '');
  // Any other ID still has to name an image in the report.
  const bad = editedBundle(MINIMAL, (r) => (r.images.find((i: any) => i.id === 'ghcr-io-acme-images-hello-app').base.imageId = 'nowhere'));
  assert.throws(() => readBundle(bad), /base\.imageId "nowhere" is not an image in the report/);
});

test("an older report's null platform list reads as the empty one v0.17.0 writes: unreadable", () => {
  const dir = editedBundle(MINIMAL, (r) => (r.images.find((i: any) => i.id === 'docker-io-library-redis-7').platforms = null));
  assert.deepEqual(readBundle(dir).report.images.find((i) => i.id === 'docker-io-library-redis-7')?.platforms, []);
  // Anything else that isn't a list still stops the build.
  const bad = editedBundle(MINIMAL, (r) => (r.images[0].platforms = 'linux/amd64'));
  assert.throws(() => readBundle(bad), /platforms: must be array/);
});

test('image ids that differ only in case are refused, since they would share a directory', () => {
  const dir = editedBundle(MINIMAL, (r) => (r.images[3].id = r.images[0].id.toUpperCase()));
  assert.throws(() => readBundle(dir), /differ only in case/);
});

test('stacks must name images in the report', () => {
  assert.equal(readBundle(v015Bundle()).report.stacks?.length, 1);
  const dir = editedBundle(MINIMAL, (r) => {
    r.stacks = [
      {
        repository: 'ghcr.io/acme/stacks/go',
        ref: 'ghcr.io/acme/stacks/go:1',
        versions: [{ digest: 'sha256:1', current: true, signature: { status: 'missing' }, images: ['nowhere'] }],
        consumers: 1,
        staleConsumers: 0,
      },
    ];
  });
  assert.throws(() => readBundle(dir), /stack ghcr.io\/acme\/stacks\/go: image "nowhere" is not an image in the report/);
});
