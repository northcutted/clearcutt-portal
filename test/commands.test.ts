import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { readBundle } from '../src/lib/bundle.ts';
import {
  UnsafeValue,
  accepts,
  flag,
  identityFor,
  pinnedRef,
  policyFile,
  shellWord,
  verifyCommands,
  type Command,
} from '../src/lib/commands.ts';
import type { EstateReport, Image, Policy, Signer } from '../src/lib/contract.gen.ts';
import { FIXTURE, MINIMAL, scratch } from './helpers.ts';

const fixture = readBundle(FIXTURE).report;
const minimal = readBundle(MINIMAL).report;
const image = (report: EstateReport, id: string) => structuredClone(report.images.find((i) => i.id === id)!);

/** The shells a reader might paste into, of those installed here. */
const SHELLS = ['/bin/sh', 'bash', 'zsh', 'dash'].filter((sh) => spawnSync(sh, ['-c', 'true']).status === 0);

/** What a shell makes of `words`: the arguments it passes, one per element. */
function argv(shell: string, words: string, cwd?: string): string[] {
  const run = spawnSync(shell, ['-c', `for a in ${words}; do printf '%s\\0' "$a"; done`], { encoding: 'utf8', cwd });
  assert.equal(run.status, 0, `${shell}: ${run.stderr}`);
  return run.stdout.split('\0').slice(0, -1);
}

// Values a hostile report might carry: each must reach the program as itself.
const HOSTILE = [
  "it's",
  "'",
  "''",
  "'\\''",
  '$(touch pwned)',
  '`touch pwned`',
  '${HOME}',
  '$HOME',
  '"; touch pwned; "',
  "'; touch pwned; '",
  'a;b&&c||d|e&f',
  '*',
  '?',
  '[a-z]*',
  '~',
  '~root',
  '!!',
  '!$',
  '#comment',
  'a #b',
  '\\',
  '\\n',
  '{a,b}',
  '=ls',
  '--rekor-url=https://evil.example',
  '-',
  ' leading and trailing ',
  '^https://github\\.com/acme/(images|fleet)\\.yml@refs/tags/v\\d+$',
  '<in >out 2>&1',
  '%s%n',
  '(subshell)',
];

describe('shell words', () => {
  test('a plain value stays bare, anything else is single-quoted', () => {
    assert.equal(shellWord('https://token.actions.githubusercontent.com'), 'https://token.actions.githubusercontent.com');
    assert.equal(shellWord('northcutted/clearcutt-factory'), 'northcutted/clearcutt-factory');
    assert.equal(shellWord('linux/amd64,linux/arm64'), 'linux/amd64,linux/arm64');
    assert.equal(shellWord('^https://github\\.com/acme/'), "'^https://github\\.com/acme/'");
    assert.equal(shellWord("it's"), "'it'\\''s'");
    assert.equal(shellWord('=ls'), "'=ls'", 'zsh expands a leading =');
    assert.equal(shellWord('a=b'), 'a=b');
    assert.equal(shellWord('~'), "'~'");
    assert.equal(shellWord('a b'), "'a b'");
  });

  test('every shell reads each quoted value back exactly, and runs nothing', () => {
    assert.ok(SHELLS.length > 0);
    const cwd = scratch('portal-shell-');
    for (const shell of SHELLS) {
      for (const value of HOSTILE) {
        assert.deepEqual(argv(shell, shellWord(value), cwd), [value], `${shell}: ${JSON.stringify(value)}`);
        assert.deepEqual(argv(shell, flag('--certificate-identity', value), cwd), [`--certificate-identity=${value}`], `${shell}: ${value}`);
      }
      // All of them in one line stay apart.
      assert.deepEqual(argv(shell, HOSTILE.map((v) => shellWord(v)).join(' '), cwd), HOSTILE, shell);
    }
    assert.deepEqual(readdirSync(cwd), [], 'nothing was created');
  });

  test('random printable values survive too', () => {
    let seed = 7;
    const random = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    const values = Array.from({ length: 200 }, () =>
      Array.from({ length: 1 + Math.floor(random() * 12) }, () => String.fromCharCode(0x20 + Math.floor(random() * 95))).join(''),
    );
    for (const shell of SHELLS) assert.deepEqual(argv(shell, values.map((v) => shellWord(v)).join(' ')), values, shell);
  });

  test('a value that is not printable ASCII is refused, not quoted', () => {
    for (const value of [
      '',
      'line\nbreak',
      'carriage\rreturn',
      'tab\there',
      'nul\0byte',
      'escape\x1b[31m',
      'del\x7f',
      'bidi‮override',
      'zero​width',
      'line separator',
      'gіthub.com', // a Cyrillic і
      'non breaking',
    ]) {
      assert.throws(() => shellWord(value, 'the identity'), UnsafeValue, JSON.stringify(value));
    }
  });
});

describe('image references', () => {
  test('are repository@digest', () => {
    const debian = image(fixture, 'ghcr-io-northcutted-images-debian-tools');
    assert.equal(pinnedRef(debian.repository, debian.digest), `ghcr.io/northcutted/images/debian-tools@${debian.digest}`);
    assert.equal(pinnedRef('localhost:5000/a/b', `sha256:${'a'.repeat(64)}`), `localhost:5000/a/b@sha256:${'a'.repeat(64)}`);
    for (const ref of fixture.images.map((i) => pinnedRef(i.repository, i.digest))) assert.equal(shellWord(ref), ref, 'needs no quotes');
  });

  test('refuse anything else', () => {
    const digest = `sha256:${'a'.repeat(64)}`;
    for (const repository of [
      'ghcr.io/acme/app:latest',
      'ghcr.io/acme/app;touch pwned',
      'ghcr.io/acme/$(id)',
      '-ghcr.io/acme/app',
      'ghcr.io/Acme/app',
      'ghcr.io/acme/app ',
      'ghcr.io',
      'ghcr.io//app',
      `ghcr.io/${'a'.repeat(260)}`,
    ]) {
      assert.throws(() => pinnedRef(repository, digest), UnsafeValue, repository);
    }
    for (const bad of ['latest', 'sha256:abc', `sha256:${'A'.repeat(64)}`, `sha1:${'a'.repeat(40)}`, `sha256:${'a'.repeat(64)} `, `sha256:${'a'.repeat(64)};id`]) {
      assert.throws(() => pinnedRef('ghcr.io/acme/app', bad), UnsafeValue, bad);
    }
  });
});

describe('signers', () => {
  const ISSUER = 'https://token.actions.githubusercontent.com';
  const reusable: Signer = {
    identity: 'https://github.com/northcutted/clearcutt-factory/.github/workflows/images.yml@refs/tags/v0.1.1',
    issuer: ISSUER,
    sourceRepository: 'https://github.com/acme/checkout',
    sourceRef: 'refs/heads/main',
  };
  const policy = (...trustedSigners: Signer[]): Policy => ({ required: [], reproduce: false, trustedSigners });

  test("the policy's signer that accepts the certificate, with the repository it requires", () => {
    const cert = image(fixture, 'ghcr-io-northcutted-images-debian-tools').evidence.signature.signer!;
    assert.deepEqual(identityFor(fixture.policy, cert), {
      flags: [
        ['--certificate-identity-regexp', '^https://github\\.com/northcutted/clearcutt-factory/'],
        ['--certificate-oidc-issuer', ISSUER],
        ['--certificate-github-workflow-repository', 'northcutted/clearcutt-factory'],
      ],
      repository: 'northcutted/clearcutt-factory',
      fromPolicy: true,
    });
    // Chainguard's signer: no source constraint, and the workflow is in the repository that ran it.
    const chainguard = image(fixture, 'cgr-dev-chainguard-static').evidence.signature.signer!;
    assert.deepEqual(identityFor(fixture.policy, chainguard).flags, [
      ['--certificate-identity-regexp', '^https://github\\.com/chainguard-images/images/'],
      ['--certificate-oidc-issuer', ISSUER],
    ]);
  });

  test('a reusable workflow names the calling repository, from the policy or the certificate', () => {
    const regexp = '^https://github\\.com/northcutted/clearcutt-factory/\\.github/workflows/(images|fleet)\\.yml@refs/tags/v\\d+\\.\\d+\\.\\d+$';
    const owner = identityFor(policy({ identityRegexp: regexp, issuer: ISSUER, sourceRepositoryOwner: 'https://github.com/acme', sourceRef: 'refs/heads/main' }), reusable);
    assert.deepEqual(owner.flags, [
      ['--certificate-identity-regexp', regexp],
      ['--certificate-oidc-issuer', ISSUER],
      ['--certificate-github-workflow-repository', 'acme/checkout'],
      ['--certificate-github-workflow-ref', 'refs/heads/main'],
    ]);
    assert.equal(owner.repository, 'acme/checkout');
    // Another owner isn't accepted, so the certificate's own identity is used,
    // and still pinned to the repository whose run signed.
    const other = identityFor(policy({ identityRegexp: regexp, issuer: ISSUER, sourceRepositoryOwner: 'https://github.com/someone' }), reusable);
    assert.equal(other.fromPolicy, false);
    assert.deepEqual(other.flags, [
      ['--certificate-identity', reusable.identity],
      ['--certificate-oidc-issuer', ISSUER],
      ['--certificate-github-workflow-repository', 'acme/checkout'],
    ]);
    assert.deepEqual(identityFor(policy({ identityRegexp: regexp, issuer: ISSUER, sourceMatchesImage: true }), reusable).flags[2], [
      '--certificate-github-workflow-repository',
      'acme/checkout',
    ]);
  });

  test('exact identities, keys, and patterns JavaScript cannot read', () => {
    const cert = image(minimal, 'ghcr-io-acme-images-hello-app').evidence.signature.signer!;
    assert.deepEqual(identityFor(policy({ identity: cert.identity, issuer: ISSUER }), cert).flags[0], ['--certificate-identity', cert.identity]);
    assert.deepEqual(identityFor(policy({ key: 'cosign.pub' }), { key: 'cosign.pub' }).flags, [['--key', 'cosign.pub']]);
    // RE2's (?i) is not JavaScript: fall back to the certificate's identity.
    const fallback = identityFor(policy({ identityRegexp: '(?i)^https://github\\.com/acme/', issuer: ISSUER }), cert);
    assert.equal(fallback.fromPolicy, false);
    assert.deepEqual(fallback.flags[0], ['--certificate-identity', cert.identity]);
    assert.ok(!accepts({ identityRegexp: '^https://github\\.com/acme/', issuer: 'https://accounts.google.com' }, cert));
    assert.ok(!accepts({ identityRegexp: '^https://github\\.com/acme/', sourceRef: 'refs/heads/release' }, { ...cert, sourceRef: 'refs/heads/main' }));
    assert.throws(() => identityFor(policy(), undefined), UnsafeValue);
    assert.throws(() => identityFor(policy(), { identity: 'x' }), /no OIDC issuer/);
  });
});

/** Stub programs that record their arguments, so a command can run for real. */
function stubs(): { bin: string; log: string } {
  const bin = scratch('portal-stubs-');
  const log = path.join(bin, 'calls.log');
  for (const name of ['cosign', 'gh', 'clearcutt-factory', 'clearcutt-verify']) {
    const file = path.join(bin, name);
    writeFileSync(file, `#!/bin/sh\nprintf '%s\\0' ${name} "$@" >> '${log}'\nprintf '\\n' >> '${log}'\n`);
    chmodSync(file, 0o755);
  }
  return { bin, log };
}

/** Runs a command's text in a shell with stub programs: the argument lists each program got. */
function runCommand(shell: string, command: Command): { calls: string[][]; cwd: string } {
  const { bin, log } = stubs();
  const cwd = scratch('portal-run-');
  const run = spawnSync(shell, ['-c', `${command.text}\npwd > '${bin}/pwd'`], {
    cwd,
    encoding: 'utf8',
    env: { PATH: `${bin}:/usr/bin:/bin`, HOME: cwd, TMPDIR: tmpdir() },
  });
  assert.equal(run.status, 0, `${shell}: ${run.stderr}`);
  const calls = existsSync(log)
    ? readFileSync(log, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => line.split('\0').slice(0, -1))
    : [];
  return { calls, cwd: readFileSync(path.join(bin, 'pwd'), 'utf8').trim() };
}

describe("an image's commands", () => {
  test('a clearcutt-factory image gets a command per verified signature and attestation, a rebuild, and the verdict', () => {
    const debian = image(fixture, 'ghcr-io-northcutted-images-debian-tools');
    const { ref, commands, skipped, unverified } = verifyCommands(fixture, debian);
    assert.equal(ref, `ghcr.io/northcutted/images/debian-tools@${debian.digest}`);
    assert.deepEqual(skipped, []);
    assert.deepEqual(unverified, ['tests']);
    assert.deepEqual(commands.map((c) => c.title), [
      'Signature',
      'SBOM (linux/amd64)',
      'SBOM (linux/arm64)',
      'Vulnerability report (linux/amd64)',
      'Vulnerability report (linux/arm64)',
      'SLSA provenance',
      'Recipe',
      'Rebuild',
      'Verdict',
    ]);
    assert.equal(
      commands[0].text,
      [
        'cosign verify \\',
        "  --certificate-identity-regexp='^https://github\\.com/northcutted/clearcutt-factory/' \\",
        '  --certificate-oidc-issuer=https://token.actions.githubusercontent.com \\',
        '  --certificate-github-workflow-repository=northcutted/clearcutt-factory \\',
        `  ghcr.io/northcutted/images/debian-tools@${debian.digest}`,
      ].join('\n'),
    );
    // Attestations attached per platform are checked on each platform image.
    const arm = debian.platforms.find((p) => p.platform === 'linux/arm64')!;
    assert.match(commands[2].text, /^cosign verify-attestation \\\n {2}--type=https:\/\/cyclonedx\.org\/bom \\\n/);
    assert.ok(commands[2].text.endsWith(`ghcr.io/northcutted/images/debian-tools@${arm.digest}`));
    assert.match(commands[6].text, /--type=https:\/\/github\.com\/northcutted\/clearcutt-factory\/recipe\/v1/);
    assert.match(commands[7].text, /^clearcutt-factory verify \\\n {2}--image=ghcr\.io\/northcutted\/images\/debian-tools@sha256:/);
    // Never a tag.
    for (const c of commands) assert.doesNotMatch(c.text, /debian-tools:latest/);
  });

  test('every command runs as written, in every shell, with the arguments it shows', () => {
    const debian = image(fixture, 'ghcr-io-northcutted-images-debian-tools');
    const { commands } = verifyCommands(fixture, debian);
    for (const shell of SHELLS) {
      const signature = runCommand(shell, commands[0]).calls;
      assert.deepEqual(signature, [
        [
          'cosign',
          'verify',
          '--certificate-identity-regexp=^https://github\\.com/northcutted/clearcutt-factory/',
          '--certificate-oidc-issuer=https://token.actions.githubusercontent.com',
          '--certificate-github-workflow-repository=northcutted/clearcutt-factory',
          `ghcr.io/northcutted/images/debian-tools@${debian.digest}`,
        ],
      ]);
      const verdict = runCommand(shell, commands.at(-1)!);
      assert.deepEqual(verdict.calls, [
        ['clearcutt-verify', 'estate', 'verify', '--refs=refs.txt', '--policy=policy.json', '--platforms=linux/amd64,linux/arm64', '--out=estate'],
      ]);
      // It works in a directory of its own, and writes the image and the policy.
      assert.equal(readFileSync(path.join(verdict.cwd, 'refs.txt'), 'utf8'), `ghcr.io/northcutted/images/debian-tools@${debian.digest}\n`);
      const written = JSON.parse(readFileSync(path.join(verdict.cwd, 'policy.json'), 'utf8'));
      assert.deepEqual(written, JSON.parse(policyFile(fixture.policy)));
    }
  });

  test('the policy file holds only what a VerificationPolicy may', () => {
    const file = JSON.parse(policyFile({ ...fixture.policy, trustedSigners: [{ ...fixture.policy.trustedSigners[0], later: 'field' } as Signer] }));
    assert.deepEqual(Object.keys(file), ['apiVersion', 'kind', 'required', 'trustedSigners', 'failOn', 'onlyFixed', 'maxDaysBehind']);
    assert.deepEqual(file.trustedSigners, [fixture.policy.trustedSigners[0]]);
    assert.equal(file.kind, 'VerificationPolicy');
  });

  test("the verdict is reached under v0.17's policy too: its scan source, observe patterns, and builders, and a rescan", () => {
    const policy = { ...minimal.policy, provenanceBuilders: ['https://github.com/acme/builder@v1'] };
    const file = JSON.parse(policyFile(policy));
    assert.deepEqual(Object.keys(file), ['apiVersion', 'kind', 'required', 'trustedSigners', 'failOn', 'onlyFixed', 'maxDaysBehind', 'scanSource', 'observe', 'provenanceBuilders']);
    assert.deepEqual([file.scanSource, file.observe, file.provenanceBuilders], ['worst', ['cgr.dev/chainguard/*'], ['https://github.com/acme/builder@v1']]);
    // The VEX documents aren't in the report: not written into the file, but named in what the command says.
    assert.equal(file.vex, undefined);
    const verdict = verifyCommands(minimal, image(minimal, 'ghcr-io-acme-images-billing-1-4-2')).commands.find((c) => c.title === 'Verdict')!;
    assert.match(verdict.text, / \\\n {2}--rescan \\\n {2}--out=estate$/);
    assert.match(verdict.purpose, /It rescans the image with grype, as this run did/);
    assert.match(verdict.purpose, /This run applied a VEX document the report names but doesn't carry .*add "vex": \[its file\] to it, or the findings it suppresses will count\./);
    // A run without a rescan or VEX says neither.
    const plain = verifyCommands(fixture, image(fixture, 'ghcr-io-northcutted-images-debian-tools')).commands.find((c) => c.title === 'Verdict')!;
    assert.doesNotMatch(plain.text, /--rescan/);
    assert.doesNotMatch(plain.purpose, /grype|VEX/);
  });

  test("GitHub's provenance also gets gh's verifier, reading the bundle from the registry", () => {
    const hello = image(minimal, 'ghcr-io-acme-images-hello-app');
    const gh = verifyCommands(minimal, hello).commands.find((c) => c.title === 'SLSA provenance (GitHub)');
    assert.equal(
      gh?.text,
      [
        'gh attestation verify \\',
        `  oci://ghcr.io/acme/images/hello-app@${hello.digest} \\`,
        '  --bundle-from-oci \\',
        '  --repo=acme/images \\',
        '  --signer-workflow=github.com/acme/images/.github/workflows/images.yml',
      ].join('\n'),
    );
  });

  test('from a clearcutt-verify that records no signer workflow, the repository comes from the identity', () => {
    const hello = image(minimal, 'ghcr-io-acme-images-hello-app');
    delete hello.evidence.provenance.signerWorkflow;
    delete hello.evidence.provenance.signer!.sourceRepository;
    const gh = verifyCommands(minimal, hello).commands.find((c) => c.title === 'SLSA provenance (GitHub)');
    assert.equal(gh?.text, `gh attestation verify \\\n  oci://ghcr.io/acme/images/hello-app@${hello.digest} \\\n  --bundle-from-oci \\\n  --repo=acme/images`);
  });

  test('a hostile signer workflow reaches gh as one argument', () => {
    const hello = image(minimal, 'ghcr-io-acme-images-hello-app');
    const evil = "github.com/acme/images/.github/workflows/x.yml' --repo=evil/evil '$(touch pwned)";
    hello.evidence.provenance.signerWorkflow = evil;
    const gh = verifyCommands(minimal, hello).commands.find((c) => c.title === 'SLSA provenance (GitHub)')!;
    for (const shell of SHELLS) {
      const { calls, cwd } = runCommand(shell, gh);
      assert.deepEqual(calls, [
        ['gh', 'attestation', 'verify', `oci://ghcr.io/acme/images/hello-app@${hello.digest}`, '--bundle-from-oci', '--repo=acme/images', `--signer-workflow=${evil}`],
      ]);
      assert.ok(!existsSync(path.join(cwd, 'pwned')));
    }
    hello.evidence.provenance.signerWorkflow = 'github.com/acme/images/.github/workflows/\u202ex.yml';
    const result = verifyCommands(minimal, hello);
    assert.ok(!result.commands.some((c) => c.title === 'SLSA provenance (GitHub)'));
    assert.deepEqual(result.skipped, [{ title: 'SLSA provenance (GitHub)', reason: 'The signing workflow has characters other than printable ASCII.' }]);
  });

  test('a key signer without a transparency log is checked without one, by cosign and clearcutt-factory', () => {
    const report = structuredClone(minimal);
    report.policy.trustedSigners = [{ key: 'keys/cosign.pub', tlog: false }];
    const hello = image(report, 'ghcr-io-acme-images-hello-app');
    for (const kind of ['signature', 'sbom', 'vulnerabilityScan', 'recipe'] as const) {
      hello.evidence[kind].signer = { key: 'keys/cosign.pub', tlog: false };
    }
    hello.evidence.provenance.status = 'missing';
    const { commands, skipped } = verifyCommands(report, hello);
    assert.deepEqual(skipped, []);
    const signature = commands.find((c) => c.title === 'Signature')!;
    assert.equal(signature.text, `cosign verify \\\n  --key=keys/cosign.pub \\\n  --insecure-ignore-tlog=true \\\n  ghcr.io/acme/images/hello-app@${hello.digest}`);
    assert.ok(commands.find((c) => c.title === 'Recipe')!.text.includes('--insecure-ignore-tlog=true'));
    const rebuild = commands.find((c) => c.title === 'Rebuild')!;
    assert.equal(
      rebuild.text,
      `clearcutt-factory verify \\\n  --image=ghcr.io/acme/images/hello-app@${hello.digest} \\\n  --key=keys/cosign.pub \\\n  --insecure-ignore-tlog`,
    );
    assert.match(rebuild.purpose, /needs a clearcutt-factory release after v0\.1\.1\./);
    // A key path from the report is one argument, however it is written.
    const evil = "keys/it's $(touch pwned).pub";
    report.policy.trustedSigners = [{ key: evil, tlog: false }];
    hello.evidence.recipe.signer = { key: evil, tlog: false };
    for (const shell of SHELLS) {
      const { calls, cwd } = runCommand(shell, verifyCommands(report, hello).commands.find((c) => c.title === 'Rebuild')!);
      assert.deepEqual(calls, [['clearcutt-factory', 'verify', `--image=ghcr.io/acme/images/hello-app@${hello.digest}`, `--key=${evil}`, '--insecure-ignore-tlog']]);
      assert.ok(!existsSync(path.join(cwd, 'pwned')));
    }
    report.policy.trustedSigners = [{ key: 'keys/cosign.pub', tlog: false }];
    hello.evidence.recipe.signer = { key: 'keys/cosign.pub', tlog: false };
    // The verdict command's policy keeps tlog, so clearcutt-verify accepts the same evidence.
    assert.deepEqual(JSON.parse(policyFile(report.policy)).trustedSigners, [{ key: 'keys/cosign.pub', tlog: false }]);
    // A key signer that logs gets no such flag.
    report.policy.trustedSigners = [{ key: 'keys/cosign.pub' }];
    hello.evidence.signature.signer = { key: 'keys/cosign.pub' };
    assert.doesNotMatch(verifyCommands(report, hello).commands.find((c) => c.title === 'Signature')!.text, /tlog/);
  });

  test("gh's command names the repository and, for a reusable workflow, the workflow", () => {
    const hello = image(minimal, 'ghcr-io-acme-images-hello-app');
    hello.evidence.provenance.signer = {
      identity: 'https://github.com/northcutted/clearcutt-factory/.github/workflows/images.yml@refs/tags/v0.1.1',
      issuer: 'https://token.actions.githubusercontent.com',
      sourceRepository: 'https://github.com/acme/images',
      sourceRef: 'refs/heads/main',
    };
    const report = structuredClone(minimal);
    report.policy.trustedSigners = [
      { identityRegexp: '^https://github\\.com/northcutted/clearcutt-factory/', issuer: 'https://token.actions.githubusercontent.com', sourceRepository: 'https://github.com/acme/images', sourceRef: 'refs/heads/main' },
    ];
    // As clearcutt-verify records it, and as an older one didn't.
    hello.evidence.provenance.signerWorkflow = 'github.com/northcutted/clearcutt-factory/.github/workflows/images.yml';
    const expected = (workflow: string) =>
      [
        'gh attestation verify \\',
        `  oci://ghcr.io/acme/images/hello-app@${hello.digest} \\`,
        '  --bundle-from-oci \\',
        '  --repo=acme/images \\',
        `  --signer-workflow=${workflow} \\`,
        '  --source-ref=refs/heads/main',
      ].join('\n');
    const gh = (report: EstateReport, i: Image) => verifyCommands(report, i).commands.find((c) => c.title === 'SLSA provenance (GitHub)')!.text;
    assert.equal(gh(report, hello), expected('github.com/northcutted/clearcutt-factory/.github/workflows/images.yml'));
    delete hello.evidence.provenance.signerWorkflow;
    assert.equal(gh(report, hello), expected('northcutted/clearcutt-factory/.github/workflows/images.yml'));
  });

  test('a hostile signer runs nothing, and a value that cannot be shown drops only its command', () => {
    const debian = image(fixture, 'ghcr-io-northcutted-images-debian-tools');
    const report = structuredClone(fixture);
    const evil = "https://evil/$(touch pwned)'; touch pwned; '`touch pwned`";
    report.policy.trustedSigners = [{ identity: evil, issuer: 'https://token.actions.githubusercontent.com' }];
    debian.evidence.signature.signer = { identity: evil, issuer: 'https://token.actions.githubusercontent.com' };
    debian.evidence.sbom.signer = { identity: 'https://github.com/acme/x\ntouch pwned', issuer: 'https://token.actions.githubusercontent.com' };
    const { commands, skipped } = verifyCommands(report, debian);
    for (const shell of SHELLS) {
      const { calls, cwd } = runCommand(shell, commands.find((c) => c.title === 'Signature')!);
      assert.equal(calls[0][2], `--certificate-identity=${evil}`);
      assert.equal(calls[0].length, 5);
      assert.ok(!existsSync(path.join(cwd, 'pwned')));
    }
    assert.deepEqual(skipped.filter((s) => s.title === 'SBOM'), [
      { title: 'SBOM', reason: "The signer's certificate-identity has characters other than printable ASCII." },
    ]);
    assert.ok(!commands.some((c) => c.title.startsWith('SBOM')));
    assert.ok(commands.some((c) => c.title.startsWith('Vulnerability report')));
  });

  test('an image the report names oddly gets no command at all', () => {
    const bad = image(fixture, 'ghcr-io-northcutted-images-debian-tools');
    bad.repository = 'ghcr.io/acme/app;touch pwned';
    const result = verifyCommands(fixture, bad);
    assert.deepEqual(result.commands, []);
    assert.equal(result.ref, undefined);
    assert.match(result.skipped[0].reason, /isn't a well-formed registry\/path/);
  });

  test('evidence that is not verified gets no command, and is named', () => {
    const redis = image(minimal, 'docker-io-library-redis-7');
    const { commands, unverified } = verifyCommands(minimal, redis);
    assert.deepEqual(commands.map((c) => c.title), ['Verdict']);
    assert.deepEqual(unverified, ['sbom']);
    const chainguard = verifyCommands(minimal, image(minimal, 'cgr-dev-chainguard-static'));
    assert.deepEqual(chainguard.unverified, ['signature', 'sbom', 'provenance']);
    assert.ok(!chainguard.commands.some((c) => c.text.startsWith('cosign')));
  });

  test('a rebased factory image repeats its rebase', () => {
    const billing = image(minimal, 'ghcr-io-acme-images-billing-1-4-2');
    const titles = verifyCommands(minimal, billing).commands.map((c) => c.title);
    assert.ok(titles.includes('Repeat the rebase'));
    assert.ok(titles.includes('Rebase record'));
  });

  test("a smoke test read from the rebase record is checked by the record's command, not one of its own", () => {
    for (const status of ['verified', 'failed', 'present'] as const) {
      const billing = structuredClone(image(minimal, 'ghcr-io-acme-images-billing-1-4-2'));
      const rebase = billing.evidence.rebase;
      // As clearcutt-verify v0.17.0 writes it: pointing at the verified record.
      billing.evidence.tests = {
        status,
        source: rebase.source,
        predicateType: rebase.predicateType,
        ref: rebase.ref,
        signer: rebase.signer,
        timestamp: rebase.timestamp,
        detail: 'The verified rebase record says the smoke test (GET :8080/) passed on linux/amd64 before clearcutt-factory published the rebased image.',
      };
      const { commands, unverified } = verifyCommands(minimal, billing);
      assert.ok(!commands.some((c) => c.title.startsWith('Tests')), status);
      assert.ok(!unverified.includes('tests'), `${status}: the record's signer vouched for it`);
      const record = commands.find((c) => c.title === 'Rebase record')!;
      assert.match(record.purpose, /Its test field is the smoke test the Tests row reads/, status);
      assert.match(record.text, /--type=https:\/\/github\.com\/northcutted\/clearcutt-factory\/rebase\/v1/);
    }
    // A test attestation of its own still gets its own command.
    const own = structuredClone(image(minimal, 'ghcr-io-acme-images-billing-1-4-2'));
    own.evidence.tests = { ...own.evidence.rebase, status: 'verified', predicateType: 'https://in-toto.io/attestation/test-result/v0.1' };
    const titles = verifyCommands(minimal, own).commands;
    assert.ok(titles.some((c) => c.title === 'Tests' && /--type=https:\/\/in-toto\.io\/attestation\/test-result\/v0\.1/.test(c.text)));
    assert.doesNotMatch(titles.find((c) => c.title === 'Rebase record')!.purpose, /test field/);
  });

  test("a policy that can't be written as printable ASCII drops only the verdict command", () => {
    const report = structuredClone(fixture);
    report.policy.trustedSigners.push({ identity: 'https://github.com/acmé/x', issuer: 'https://token.actions.githubusercontent.com' });
    const { commands, skipped } = verifyCommands(report, image(report, 'ghcr-io-northcutted-images-debian-tools') as Image);
    assert.ok(!commands.some((c) => c.title === 'Verdict'));
    assert.deepEqual(skipped, [{ title: 'Verdict', reason: "The report's policy has characters other than printable ASCII." }]);
  });
});
