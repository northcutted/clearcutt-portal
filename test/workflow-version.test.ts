// The version the reusable workflow and the action build with: one input,
// the ref they are called at. These run the steps' own shell, taken from the
// YAML, with git's ls-remote stubbed.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { root, scratch } from './helpers.ts';

const SHA = 'c'.repeat(40);
const TAGGED = 'a'.repeat(40);

/** The `run: |` block of the step with this id (or name) in a workflow or action file. */
function stepScript(file: string, step: string): string {
  const lines = readFileSync(path.join(root, file), 'utf8').split('\n');
  const start = lines.findIndex((l) => l.trim() === `- id: ${step}` || l.trim() === `id: ${step}`);
  assert.ok(start >= 0, `${file}: no step ${step}`);
  const run = lines.findIndex((l, i) => i > start && /^\s+run: \|$/.test(l));
  const indent = lines[run + 1].match(/^\s*/)![0].length;
  const body: string[] = [];
  for (const line of lines.slice(run + 1)) {
    if (line.trim() !== '' && line.match(/^\s*/)![0].length < indent) break;
    body.push(line.slice(indent));
  }
  return body.join('\n');
}

function run(file: string, step: string, env: Record<string, string>) {
  const dir = scratch('portal-version-');
  const bin = path.join(dir, 'bin');
  mkdirSync(bin);
  // ls-remote: v0.2.0 names TAGGED (annotated, so peeled), v0.1.0 another commit.
  writeFileSync(
    path.join(bin, 'git'),
    `#!/usr/bin/env bash\nprintf '%s\\trefs/tags/v0.1.0\\n%s\\trefs/tags/v0.2.0\\n%s\\trefs/tags/v0.2.0^{}\\n%s\\trefs/tags/vfoo\\n' ${'1'.repeat(40)} ${'b'.repeat(40)} ${TAGGED} ${TAGGED}\n`,
  );
  chmodSync(path.join(bin, 'git'), 0o755);
  const output = path.join(dir, 'output');
  writeFileSync(output, '');
  const r = spawnSync('bash', ['-c', stepScript(file, step)], {
    encoding: 'utf8',
    env: { PATH: `${bin}:/usr/bin:/bin:/opt/homebrew/bin:/usr/local/bin`, GITHUB_OUTPUT: output, ...env },
  });
  const outputs = Object.fromEntries(
    readFileSync(output, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => l.split(/=(.*)/s).slice(0, 2)),
  );
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, outputs };
}

const job = (ref: string, sha: string) =>
  JSON.stringify({ status: 'success', workflow_ref: `northcutted/clearcutt-portal/.github/workflows/portal.yml@${ref}`, workflow_sha: sha, workflow_repository: 'northcutted/clearcutt-portal' });

test('the reusable workflow builds the version it is called at', () => {
  const cases: [string, string, Record<string, string>][] = [
    ['a release tag: its signed archive, from its commit', job('refs/tags/v0.2.0', TAGGED), { ref: TAGGED, version: 'v0.2.0' }],
    ['a commit a release tag names: that release', job(TAGGED, TAGGED), { ref: TAGGED, version: 'v0.2.0' }],
    ['another commit: its source', job(SHA, SHA), { ref: SHA, version: 'source' }],
    ['a branch: the commit it was at, from source', job('refs/heads/main', SHA), { ref: SHA, version: 'source' }],
    ['a tag that is not a release: source', job('refs/tags/vfoo', TAGGED), { ref: TAGGED, version: 'source' }],
  ];
  for (const [name, context, want] of cases) {
    const r = run('.github/workflows/portal.yml', 'version', { JOB: context, REQUESTED: '' });
    assert.equal(r.status, 0, `${name}: ${r.stderr}`);
    assert.deepEqual(r.outputs, { repository: 'northcutted/clearcutt-portal', ...want }, name);
    assert.doesNotMatch(r.stdout, /::warning/, name);
  }
});

test('portal-version still works, deprecated, with a warning that says when it differs', () => {
  let r = run('.github/workflows/portal.yml', 'version', { JOB: job('refs/tags/v0.2.0', TAGGED), REQUESTED: 'v0.2.0' });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.outputs, { repository: 'northcutted/clearcutt-portal', ref: 'v0.2.0', version: 'v0.2.0' });
  assert.match(r.stdout, /^::warning title=portal-version is deprecated::portal-version is deprecated and will be removed: the workflow builds the version it is called at \(refs\/tags\/v0\.2\.0\)\. Remove portal-version from the caller\.$/m);
  r = run('.github/workflows/portal.yml', 'version', { JOB: job('refs/tags/v0.2.0', TAGGED), REQUESTED: SHA });
  assert.deepEqual(r.outputs, { repository: 'northcutted/clearcutt-portal', ref: SHA, version: 'source' });
  assert.match(r.stdout, /It differs from that ref, and the site is built with portal-version \(c{40}\)\./);
  // Where GitHub doesn't say (GitHub Enterprise Server), portal-version is the way.
  r = run('.github/workflows/portal.yml', 'version', { JOB: JSON.stringify({ status: 'success' }), REQUESTED: 'v0.2.0' });
  assert.equal(r.outputs.version, 'v0.2.0');
  r = run('.github/workflows/portal.yml', 'version', { JOB: JSON.stringify({ status: 'success' }), REQUESTED: '' });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /doesn't tell a reusable workflow its own ref/);
});

test('the action builds the release it is used at, by tag or by the commit a tag names', () => {
  const cases: [Record<string, string>, string][] = [
    [{ ACTION_REF: 'v0.2.0', INPUT: '' }, 'v0.2.0'],
    [{ ACTION_REF: TAGGED, INPUT: '' }, 'v0.2.0'],
    [{ ACTION_REF: SHA, INPUT: '' }, 'source'],
    [{ ACTION_REF: 'main', INPUT: '' }, 'source'],
    [{ ACTION_REF: '', INPUT: '' }, 'source'],
    [{ ACTION_REF: SHA, INPUT: 'v0.1.0' }, 'v0.1.0'],
    [{ ACTION_REF: 'v0.2.0', INPUT: 'source' }, 'source'],
  ];
  for (const [env, version] of cases) {
    const r = run('action.yml', 'version', { REPO: 'northcutted/clearcutt-portal', ...env });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.outputs.version, version, JSON.stringify(env));
  }
});
