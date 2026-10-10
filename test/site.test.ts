// Builds real sites from the vendored bundles and checks what they say.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { before, describe, test } from 'node:test';
import { readBundle } from '../src/lib/bundle.ts';
import { FIXTURE, MINIMAL, editedBundle, root } from './helpers.ts';

function cli(...args: string[]) {
  return spawnSync(process.execPath, [path.join(root, 'bin/clearcutt-portal.ts'), ...args], {
    cwd: root,
    encoding: 'utf8',
  });
}

function build(bundle: string, ...extra: string[]): string {
  const out = mkdtempSync(path.join(tmpdir(), 'portal-site-'));
  const run = cli('build', '--bundle', bundle, '--out', out, ...extra);
  assert.equal(run.status, 0, `build failed:\n${run.stdout}\n${run.stderr}`);
  return out;
}

function htmlFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((f) => f.endsWith('.html'))
    .map((f) => path.join(dir, f))
    .filter((f) => statSync(f).isFile());
}

const read = (dir: string, page: string) => readFileSync(path.join(dir, page), 'utf8');
const text = (html: string) =>
  html
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');

describe('the example site', () => {
  let site: string;
  before(() => {
    site = build(MINIMAL, '--base', '/portal/', '--site', 'https://example.test');
  });

  test('has a page per image and per package', () => {
    const report = readBundle(MINIMAL).report;
    for (const image of report.images) read(site, `images/${image.id}/index.html`);
    assert.ok(htmlFiles(path.join(site, 'packages')).length > 1);
  });

  test('serves the bundle it was built from, byte for byte', () => {
    assert.equal(read(site, 'estate-report.json'), readFileSync(path.join(MINIMAL, 'estate-report.json'), 'utf8'));
    assert.equal(read(site, 'estate-history.json'), readFileSync(path.join(MINIMAL, 'estate-history.json'), 'utf8'));
  });

  test('links stay under the base path', () => {
    const html = read(site, 'index.html');
    const hrefs = [...html.matchAll(/(?:href|src)="(\/[^"]*)"/g)].map((m) => m[1]);
    assert.ok(hrefs.length > 5);
    for (const h of hrefs) assert.ok(h.startsWith('/portal/'), `${h} is outside /portal/`);
  });

  test('loads nothing from another origin', () => {
    for (const file of htmlFiles(site)) {
      const html = readFileSync(file, 'utf8');
      const external = [...html.matchAll(/<(?:script|link|img|iframe)\b[^>]*\b(?:src|href)="(https?:)?\/\/[^"]*"/g)];
      assert.deepEqual(external.map((m) => m[0]), [], file);
      assert.doesNotMatch(html, /\bfetch\(|XMLHttpRequest/, file);
    }
  });

  test('an image with no vulnerability data says unknown, never zero', () => {
    const page = text(read(site, 'images/docker-io-library-redis/index.html'));
    assert.match(page, /how many vulnerabilities it has is unknown/);
    assert.doesNotMatch(page, /0 findings|No findings/);
  });

  test('an image whose base is unknown says so, with the reasons', () => {
    const page = text(read(site, 'images/docker-io-library-redis/index.html'));
    assert.match(page, /No base could be determined/);
    assert.match(page, /no observed image.s layers are a prefix of this image/);
  });

  test('unknown evidence is shown as unknown', () => {
    const page = text(read(site, 'images/docker-io-library-redis/index.html'));
    assert.match(page, /SBOM \? Unknown/);
  });

  test('present evidence is shown as unverified, not verified', () => {
    const page = text(read(site, 'images/cgr-dev-chainguard-static/index.html'));
    assert.match(page, /Signature ○ Present, unverified/);
  });

  test('estate vulnerability totals are called a floor when some images are not scanned', () => {
    assert.match(text(read(site, 'index.html')), /these totals are a floor for the estate, not its total/);
  });

  test('package pages name the images they cannot speak for', () => {
    const report = readBundle(MINIMAL).report;
    assert.ok(report.summary.packages.unknown > 0);
    assert.match(text(read(site, 'packages/index.html')), /Whether they ship this is unknown/);
  });

  test('a rebased image names what it was rebased from', () => {
    const page = text(read(site, 'images/ghcr-io-acme-images-billing/index.html'));
    assert.match(page, /Rebased from ghcr\.io\/acme\/images\/billing@sha256:0{64} onto/);
  });
});

describe('the fixture site', () => {
  test('builds, and every verified image shows each required kind verified', () => {
    const site = build(FIXTURE);
    const report = readBundle(FIXTURE).report;
    for (const image of report.images.filter((i) => i.verdict.status === 'verified')) {
      const page = text(read(site, `images/${image.id}/index.html`));
      assert.match(page, /✓ Verified/);
    }
    assert.match(text(read(site, 'history/index.html')), /Verdicts per run/);
  });
});

describe('the CLI', () => {
  test('refuses a bundle that does not match the contract', () => {
    const bad = editedBundle(MINIMAL, (r) => (r.images[0].verdict.status = 'fine'));
    const run = cli('build', '--bundle', bad, '--out', mkdtempSync(path.join(tmpdir(), 'portal-site-')));
    assert.equal(run.status, 1);
    assert.match(run.stderr, /does not match the EstateReport schema/);
  });

  test('check validates without building', () => {
    const run = cli('check', '--bundle', MINIMAL);
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /clearcutt.dev\/v1 report of 4 images with 2 history entries/);
  });

  test('usage errors exit 2', () => {
    assert.equal(cli('build').status, 2);
    assert.equal(cli('frobnicate', '--bundle', MINIMAL).status, 2);
  });
});
