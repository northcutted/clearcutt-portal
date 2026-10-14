// The release workflow, the reusable workflow, and the action must agree on
// what a release tag is: only a vX.Y.Z tag has a signed archive to verify,
// and anything else builds from source.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { root } from './helpers.ts';

const files = ['scripts/release.sh', '.github/workflows/portal.yml', 'action.yml'];
const patterns = files.map((file) => {
  const found = [...readFileSync(path.join(root, file), 'utf8').matchAll(/\^v\[0-9\]\S*?\$/g)].map((m) => m[0]);
  assert.ok(found.length > 0, `${file} has no release tag pattern`);
  return { file, found };
});

test('every release tag check uses the same pattern', () => {
  const all = new Set(patterns.flatMap((p) => p.found));
  assert.equal(all.size, 1, JSON.stringify(patterns));
});

test('the pattern accepts release tags and nothing else', () => {
  const pattern = patterns[0].found[0];
  const matches = (ref: string) => spawnSync('bash', ['-c', '[[ "$1" =~ $2 ]]', 'bash', ref, pattern]).status === 0;
  for (const ref of ['v0.1.0', 'v10.20.30', 'v1.2.3-rc.1']) assert.ok(matches(ref), ref);
  for (const ref of [
    'v1',
    'v1.2',
    'vfoo',
    'v1-fix',
    'v1.2.3.4',
    'v1.2.3 ',
    'v1.2.3-',
    'xv1.2.3',
    'main',
    '6059220a3f1b2c4d5e6f708192a3b4c5d6e7f801',
  ]) {
    assert.ok(!matches(ref), ref);
  }
});
