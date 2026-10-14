// Builds real sites from the vendored bundles and checks what they say.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
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

/** Every file under dir, with its contents, to show nothing was touched. */
function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of readdirSync(dir, { recursive: true, encoding: 'utf8' }).sort()) {
    const file = path.join(dir, f);
    if (statSync(file).isFile()) out[f] = readFileSync(file, 'utf8');
  }
  return out;
}

/** The site's Content-Security-Policy, as directive name → sources. */
function policy(html: string): Map<string, string[]> {
  const metas = [...html.matchAll(/<meta http-equiv="content-security-policy" content="([^"]*)"/g)];
  assert.equal(metas.length, 1, 'one CSP <meta> per page');
  return new Map(
    metas[0][1]
      .split(';')
      .map((d) => d.trim().split(/\s+/))
      .filter((d) => d[0])
      .map(([name, ...sources]) => [name, sources]),
  );
}

const sha256 = (text: string) => `'sha256-${createHash('sha256').update(text).digest('base64')}'`;
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

  test('every page carries a CSP that allows only its own scripts and styles', () => {
    for (const file of htmlFiles(site)) {
      const html = readFileSync(file, 'utf8');
      const csp = policy(html);
      assert.deepEqual(csp.get('default-src'), ["'none'"], file);
      assert.deepEqual(csp.get('base-uri'), ["'none'"], file);
      assert.deepEqual(csp.get('form-action'), ["'none'"], file);
      const scripts = csp.get('script-src') ?? [];
      const styles = csp.get('style-src') ?? [];
      for (const sources of [scripts, styles]) {
        assert.ok(sources.includes("'self'"), file);
        for (const unsafe of ["'unsafe-inline'", "'unsafe-eval'", "'unsafe-hashes'", '*', 'data:', 'https:']) {
          assert.ok(!sources.includes(unsafe), `${file}: ${unsafe}`);
        }
      }
      // Every inline script and style is allowed by its hash; every file is
      // the site's own.
      for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
        const src = m[1].match(/\bsrc="([^"]*)"/)?.[1];
        if (src) assert.ok(src.startsWith('/portal/'), `${file}: script ${src}`);
        else assert.ok(scripts.includes(sha256(m[2])), `${file}: an inline script has no hash in the CSP`);
      }
      for (const m of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)) {
        assert.ok(styles.includes(sha256(m[1])), `${file}: an inline style has no hash in the CSP`);
      }
      for (const m of html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*>/g)) {
        assert.match(m[0], /href="\/portal\//, file);
      }
      // Attributes a hash can't cover.
      assert.doesNotMatch(html, /<[^>]+\sstyle="/, `${file}: style attribute`);
      assert.doesNotMatch(html, /<[^>]+\son[a-z]+="/, `${file}: event handler attribute`);
      assert.match(html, /<head>[\s\S]*content-security-policy[\s\S]*<\/head>/, file);
    }
  });

  test('a rebased image names what it was rebased from', () => {
    const page = text(read(site, 'images/ghcr-io-acme-images-billing/index.html'));
    assert.match(page, /Rebased from ghcr\.io\/acme\/images\/billing@sha256:0{64} onto/);
  });
});

describe('a report written by someone hostile', () => {
  let site: string;
  before(() => {
    const bundle = editedBundle(MINIMAL, (r) => {
      r.images[0].source = { url: 'javascript:alert(document.domain)', basis: 'label' };
      r.images[2].source = { url: 'https://github.com@evil.example/acme', basis: 'annotation' };
      r.images[3].source = { url: 'https://example.test/acme/redis', basis: 'label' };
      r.images[3].description = '<script>alert(1)</script><img src=x onerror=alert(1)>';
    });
    site = build(bundle);
  });

  test('a source URL that is not http(s) is shown as text, never as a link', () => {
    const page = read(site, 'images/cgr-dev-chainguard-static/index.html');
    assert.doesNotMatch(page, /href="javascript:/i);
    assert.match(page, /<code>javascript:alert\(document\.domain\)<\/code> <span class="dim small">\(not linked/);
    assert.match(read(site, 'images/ghcr-io-acme-images-billing/index.html'), /<code>https:\/\/github\.com@evil\.example\/acme<\/code>/);
  });

  test('an http(s) source URL is a link', () => {
    assert.match(
      read(site, 'images/docker-io-library-redis/index.html'),
      /<a href="https:\/\/example\.test\/acme\/redis" rel="noreferrer">https:\/\/example\.test\/acme\/redis<\/a>/,
    );
  });

  test('no page links anywhere but this site and http(s)', () => {
    for (const file of htmlFiles(site)) {
      for (const [, h] of readFileSync(file, 'utf8').matchAll(/\shref="([^"]*)"/g)) {
        assert.match(h, /^(\/|#|https?:\/\/)/, `${file}: href="${h}"`);
      }
    }
  });

  test('markup in report text is escaped', () => {
    const page = read(site, 'images/docker-io-library-redis/index.html');
    assert.doesNotMatch(page, /<script>alert|<img src=x/);
    assert.match(page, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
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

  test('builds from any working directory, with relative paths', () => {
    // A fleet's workflow runs the portal from its own checkout, not the
    // portal's.
    const cwd = realpathSync(mkdtempSync(path.join(tmpdir(), 'portal-cwd-')));
    const run = spawnSync(
      process.execPath,
      [path.join(root, 'bin/clearcutt-portal.ts'), 'build', '--bundle', path.relative(cwd, MINIMAL), '--out', 'site'],
      { cwd, encoding: 'utf8' },
    );
    assert.equal(run.status, 0, `build failed:\n${run.stdout}\n${run.stderr}`);
    assert.ok(readFileSync(path.join(cwd, 'site/index.html'), 'utf8').includes('example-estate'));
  });

  test('builds into a directory whose path starts with the portal\'s', () => {
    // Astro compares paths as strings: /x/clearcutt-portal-site looks like
    // it is inside /x/clearcutt-portal.
    const out = `${root}-site-test`;
    try {
      const run = cli('build', '--bundle', MINIMAL, '--out', out);
      assert.equal(run.status, 0, `build failed:\n${run.stdout}\n${run.stderr}`);
      assert.ok(readFileSync(path.join(out, 'index.html'), 'utf8').includes('example-estate'));
      assert.ok(!existsSync(path.join(out, '.prerender')));
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });

  test('rebuilds over an earlier site, but not over other files', () => {
    const out = build(MINIMAL);
    assert.equal(cli('build', '--bundle', MINIMAL, '--out', out).status, 0);
    const other = mkdtempSync(path.join(tmpdir(), 'portal-other-'));
    writeFileSync(path.join(other, 'keep.txt'), 'mine');
    const run = cli('build', '--bundle', MINIMAL, '--out', other);
    assert.equal(run.status, 2);
    assert.match(run.stderr, /not empty, and not a site clearcutt-portal built/);
    assert.equal(readFileSync(path.join(other, 'keep.txt'), 'utf8'), 'mine');
  });

  test('marks each site it writes, and replaces only a marked one', () => {
    const out = build(MINIMAL);
    assert.ok(existsSync(path.join(out, '.clearcutt-portal-site')));
    // A directory that merely holds a report, like a bundle, isn't a site.
    const lookalike = editedBundle(MINIMAL, () => {});
    writeFileSync(path.join(lookalike, 'policy.yaml'), 'mine');
    const before = snapshot(lookalike);
    const run = cli('build', '--bundle', MINIMAL, '--out', lookalike);
    assert.equal(run.status, 2);
    assert.match(run.stderr, /not a site clearcutt-portal built/);
    assert.deepEqual(snapshot(lookalike), before);
  });

  test('never writes the site into, around, or over the bundle', () => {
    // In a directory of its own, so "around it" is a directory this test owns.
    const bundle = path.join(mkdtempSync(path.join(tmpdir(), 'portal-around-')), 'bundle');
    cpSync(MINIMAL, bundle, { recursive: true });
    writeFileSync(path.join(bundle, 'policy.yaml'), 'mine');
    writeFileSync(path.join(bundle, 'refs.txt'), 'ghcr.io/acme/images/billing:latest\n');
    const before = snapshot(bundle);
    const link = path.join(mkdtempSync(path.join(tmpdir(), 'portal-link-')), 'site');
    symlinkSync(bundle, link);
    for (const out of [
      bundle, // the bundle itself
      `${bundle}${path.sep}`,
      path.join(bundle, 'site'), // inside it
      path.join(bundle, 'site', '..'),
      path.dirname(bundle), // around it
      link, // a symlink to it
      path.join(link, 'nested'),
    ]) {
      const run = cli('build', '--bundle', bundle, '--out', out);
      assert.equal(run.status, 2, `--out ${out}: ${run.stdout}\n${run.stderr}`);
      assert.match(run.stderr, /overlaps the bundle/, out);
      assert.deepEqual(snapshot(bundle), before, `--out ${out} touched the bundle`);
    }
    // Through a symlink, from the other side: --out is the real directory.
    const viaLink = cli('build', '--bundle', link, '--out', bundle);
    assert.equal(viaLink.status, 2);
    assert.deepEqual(snapshot(bundle), before);
  });

  test('refuses a file as --out', () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'portal-file-')), 'site');
    writeFileSync(file, 'mine');
    const run = cli('build', '--bundle', MINIMAL, '--out', file);
    assert.equal(run.status, 2);
    assert.match(run.stderr, /not a directory/);
    assert.equal(readFileSync(file, 'utf8'), 'mine');
  });

  test('an image id that is not a plain page name is a bundle error, not a crash', () => {
    const bad = editedBundle(MINIMAL, (r) => (r.images[3].id = '../../escape'));
    const out = mkdtempSync(path.join(tmpdir(), 'portal-site-'));
    const run = cli('build', '--bundle', bad, '--out', out);
    assert.equal(run.status, 1);
    assert.match(run.stderr, /image id "\.\.\/\.\.\/escape" can't name a page/);
    assert.doesNotMatch(run.stderr, /\n\s+at /, 'no stack trace');
    assert.deepEqual(readdirSync(out), []);
  });

  test('usage errors exit 2', () => {
    assert.equal(cli('build').status, 2);
    assert.equal(cli('frobnicate', '--bundle', MINIMAL).status, 2);
  });
});
