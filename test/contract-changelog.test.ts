// scripts/check-contract-changelog.sh, run in a scratch repository: a schema
// change since the last release tag needs a CHANGELOG entry that says so.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { root, scratch } from './helpers.ts';

function repo(): { dir: string; git: (...args: string[]) => void; check: () => ReturnType<typeof spawnSync> } {
  const dir = scratch('portal-changelog-');
  mkdirSync(path.join(dir, 'scripts'));
  mkdirSync(path.join(dir, 'contract'));
  cpSync(path.join(root, 'scripts/check-contract-changelog.sh'), path.join(dir, 'scripts/check-contract-changelog.sh'));
  const git = (...args: string[]) => {
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.test', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', ...args], { cwd: dir, stdio: 'ignore' });
  };
  git('init', '-q');
  writeFileSync(path.join(dir, 'contract/estate-report.v1.schema.json'), '{"a": 1}\n');
  writeFileSync(path.join(dir, 'CHANGELOG.md'), '# Changelog\n\n## v0.1.0\n\nThe contract of v0.15.\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'first');
  return {
    dir,
    git,
    check: () => spawnSync('bash', [path.join(dir, 'scripts/check-contract-changelog.sh')], { cwd: dir, encoding: 'utf8' }),
  };
}

test('no release tag yet: nothing to compare with', () => {
  const r = repo();
  const run = r.check();
  assert.equal(run.status, 0, String(run.stderr));
  assert.match(String(run.stdout), /no release tag/);
});

test('a schema change since the last release needs an Unreleased entry about the contract', () => {
  const r = repo();
  r.git('tag', 'v0.1.0');
  assert.equal(r.check().status, 0, 'unchanged');
  // A change elsewhere in contract/ (a fixture, UPSTREAM) isn't a schema change.
  writeFileSync(path.join(r.dir, 'contract/UPSTREAM'), 'commit: abc\n');
  assert.equal(r.check().status, 0);
  writeFileSync(path.join(r.dir, 'contract/estate-report.v1.schema.json'), '{"a": 2}\n');
  // Mentioning it only under the released version doesn't count.
  let run = r.check();
  assert.equal(run.status, 1);
  assert.match(String(run.stderr), /contract\/estate-report\.v1\.schema\.json/);
  writeFileSync(path.join(r.dir, 'CHANGELOG.md'), '# Changelog\n\n## Unreleased\n\n- Pages tweaked.\n\n## v0.1.0\n\nThe contract of v0.15.\n');
  assert.equal(r.check().status, 1, 'an Unreleased section that says nothing of it');
  writeFileSync(path.join(r.dir, 'CHANGELOG.md'), '# Changelog\n\n## Unreleased\n\n- clearcutt-verify v0.16 contract: shows `newField`.\n\n## v0.1.0\n');
  run = r.check();
  assert.equal(run.status, 0, String(run.stderr));
  // Committed or not, the same.
  r.git('add', '-A');
  r.git('commit', '-q', '-m', 'schema');
  assert.equal(r.check().status, 0);
});
