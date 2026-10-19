// scripts/pull-bundle.sh, with cosign and oras stubbed: a bundle is read
// only after its signature verifies against the signer given, from the
// digest that was verified, and only when it is an estate bundle. Every
// other way it stops and writes nothing.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { MINIMAL, root, scratch } from './helpers.ts';

const DIGEST = `sha256:${'a'.repeat(64)}`;
const IDENTITY = '^https://github\\.com/acme/estate/\\.github/workflows/estate\\.yml@refs/heads/main$';
const ISSUER = 'https://token.actions.githubusercontent.com';
const ESTATE = JSON.stringify({ config: { mediaType: 'application/vnd.clearcutt.estate.v1+json' } });

interface Run {
  status: number | null;
  stderr: string;
  stdout: string;
  /** Each stub call, as "tool args…". */
  calls: string[];
  out: string;
  output: string;
}

function pull(ref: string, env: Record<string, string | undefined> = {}, files?: Record<string, string>): Run {
  const dir = scratch('portal-pull-');
  const bin = path.join(dir, 'bin');
  const served = path.join(dir, 'served');
  mkdirSync(bin);
  mkdirSync(served);
  for (const [name, text] of Object.entries(
    files ?? {
      'estate-report.json': readFileSync(path.join(MINIMAL, 'estate-report.json'), 'utf8'),
      'estate-history.json': readFileSync(path.join(MINIMAL, 'estate-history.json'), 'utf8'),
      'something-else.json': '{}',
    },
  )) {
    writeFileSync(path.join(served, name), text);
  }
  const log = path.join(dir, 'calls');
  writeFileSync(log, '');
  const stub = (name: string, body: string) => {
    writeFileSync(path.join(bin, name), `#!/usr/bin/env bash\necho "${name} $*" >> "$STUB_LOG"\n${body}\n`);
    chmodSync(path.join(bin, name), 0o755);
  };
  stub('cosign', 'exit "${COSIGN_EXIT:-0}"');
  stub(
    'oras',
    `case "$1" in
  login) echo "password on stdin: $(cat)" >> "$STUB_LOG" ;;
  resolve) echo "$ORAS_DIGEST" ;;
  manifest) echo "$ORAS_MANIFEST" ;;
  pull) cp "$ORAS_FILES"/* "$3"/ ;;
esac`,
  );
  const out = path.join(dir, 'out');
  const output = path.join(dir, 'github-output');
  writeFileSync(output, '');
  const run = spawnSync('bash', [path.join(root, 'scripts/pull-bundle.sh'), ref, out], {
    encoding: 'utf8',
    env: {
      PATH: `${bin}:${path.dirname(process.execPath)}:/usr/bin:/bin`,
      STUB_LOG: log,
      ORAS_DIGEST: DIGEST,
      ORAS_MANIFEST: ESTATE,
      ORAS_FILES: served,
      GITHUB_OUTPUT: output,
      CERTIFICATE_IDENTITY_REGEXP: IDENTITY,
      CERTIFICATE_OIDC_ISSUER: ISSUER,
      ...env,
    } as NodeJS.ProcessEnv,
  });
  const calls = readFileSync(log, 'utf8').split('\n').filter(Boolean);
  return { status: run.status, stderr: run.stderr, stdout: run.stdout, calls, out, output: readFileSync(output, 'utf8') };
}

const nothingWritten = (r: Run) => assert.ok(!existsSync(r.out) || readdirSync(r.out).length === 0, 'nothing written');

test('a tag is resolved, the digest verified against the signer, and only that digest read', () => {
  const r = pull('ghcr.io/acme/estate:latest');
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.calls, [
    'oras resolve ghcr.io/acme/estate:latest',
    `cosign verify --certificate-identity-regexp ${IDENTITY} --certificate-oidc-issuer ${ISSUER} ghcr.io/acme/estate@${DIGEST}`,
    `oras manifest fetch ghcr.io/acme/estate@${DIGEST}`,
    `oras pull --output ${r.calls.at(-1)!.split(' ')[3]} ghcr.io/acme/estate@${DIGEST}`,
  ]);
  // The bundle's two files, and nothing else the artifact holds.
  assert.deepEqual(readdirSync(r.out).sort(), ['estate-history.json', 'estate-report.json']);
  assert.equal(r.output, `digest=${DIGEST}\n`);
});

test('a digest is used as it is, a tag beside it ignored, and a registry port kept', () => {
  const r = pull(`registry.example:5000/acme/estate:latest@${DIGEST}`);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!r.calls.some((c) => c.startsWith('oras resolve')));
  assert.ok(r.calls.includes(`cosign verify --certificate-identity-regexp ${IDENTITY} --certificate-oidc-issuer ${ISSUER} registry.example:5000/acme/estate@${DIGEST}`));
});

test('fails closed: no signer, or one that would match anyone', () => {
  const cases: [string, Record<string, string | undefined>, RegExp][] = [
    ['no identity', { CERTIFICATE_IDENTITY_REGEXP: undefined }, /no certificate-identity-regexp/],
    ['no issuer', { CERTIFICATE_OIDC_ISSUER: undefined }, /no certificate-oidc-issuer/],
    ['an empty identity', { CERTIFICATE_IDENTITY_REGEXP: '' }, /no certificate-identity-regexp/],
    ['unanchored', { CERTIFICATE_IDENTITY_REGEXP: 'github\\.com/acme/' }, /must be anchored/],
    ['anchored at the start only', { CERTIFICATE_IDENTITY_REGEXP: '^https://github\\.com/acme/' }, /must be anchored/],
    ['an issuer that is not https', { CERTIFICATE_OIDC_ISSUER: 'http://issuer.example' }, /must be an https URL/],
  ];
  for (const [name, env, message] of cases) {
    const r = pull('ghcr.io/acme/estate:latest', env);
    assert.equal(r.status, 1, name);
    assert.match(r.stderr, message, name);
    assert.deepEqual(r.calls, [], `${name}: nothing contacted`);
    nothingWritten(r);
  }
});

test('fails closed: a signature that does not verify, or an artifact that is not a bundle', () => {
  let r = pull('ghcr.io/acme/estate:latest', { COSIGN_EXIT: '1' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /has no signature from an identity matching/);
  assert.ok(!r.calls.some((c) => c.startsWith('oras manifest') || c.startsWith('oras pull')), 'nothing of it read');
  nothingWritten(r);

  r = pull('ghcr.io/acme/estate:latest', { ORAS_MANIFEST: JSON.stringify({ config: { mediaType: 'application/vnd.oci.image.config.v1+json' } }) });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /is not a ClearCutt estate bundle/);
  assert.ok(!r.calls.some((c) => c.startsWith('oras pull')));
  nothingWritten(r);

  r = pull('ghcr.io/acme/estate:latest', {}, { 'other.json': '{}' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /has no estate-report\.json/);
  nothingWritten(r);

  r = pull('ghcr.io/acme/estate:latest', { ORAS_DIGEST: 'sha256:../../x' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /not a sha256 digest/);
  assert.ok(!r.calls.some((c) => c.startsWith('cosign')));

  for (const ref of ['estate', 'ghcr.io/acme/estate;rm -rf /', '--help']) {
    r = pull(ref);
    assert.equal(r.status, 1, ref);
    assert.ok(!r.calls.some((c) => c.startsWith('cosign')), ref);
  }
});

test('logs in to the bundle\'s registry when given credentials, with the password on stdin', () => {
  const r = pull('ghcr.io/acme/estate:latest', { REGISTRY_USERNAME: 'bot', REGISTRY_PASSWORD: 's3cret' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.calls[0], 'oras login --username bot --password-stdin ghcr.io');
  assert.equal(r.calls[1], 'password on stdin: s3cret');
  assert.ok(!r.calls.some((c) => c.includes('s3cret') && !c.startsWith('password on stdin')), 'never on a command line');
  const half = pull('ghcr.io/acme/estate:latest', { REGISTRY_USERNAME: 'bot' });
  assert.equal(half.status, 1);
  assert.match(half.stderr, /go together/);
});
