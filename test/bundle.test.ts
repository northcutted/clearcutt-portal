import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { BundleError, readBundle } from '../src/lib/bundle.ts';
import { FIXTURE, MINIMAL, editedBundle } from './helpers.ts';

test('the vendored fixture and example are valid bundles', () => {
  for (const dir of [FIXTURE, MINIMAL]) {
    const bundle = readBundle(dir);
    assert.equal(bundle.report.apiVersion, 'clearcutt.dev/v1');
    assert.ok(bundle.report.images.length > 0);
    assert.ok(bundle.history);
  }
});

test('a directory without a report is not a bundle', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'portal-empty-'));
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

test('fields from a newer v1 are ignored, as the contract requires', () => {
  const dir = editedBundle(MINIMAL, (r) => {
    r.newTopLevelField = { anything: true };
    r.images[0].evidence.signature.newDetail = 'later';
  });
  assert.equal(readBundle(dir).report.images.length, 4);
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
