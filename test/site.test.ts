// Builds real sites from the vendored bundles and checks what they say.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { before, describe, test } from 'node:test';
import { readBundle } from '../src/lib/bundle.ts';
import { verifyCommands } from '../src/lib/commands.ts';
import { editedBundle, FIXTURE, MINIMAL, root, scratch, v015Bundle } from './helpers.ts';

function cli(...args: string[]) {
  return spawnSync(process.execPath, [path.join(root, 'bin/clearcutt-portal.ts'), ...args], {
    cwd: root,
    encoding: 'utf8',
  });
}

function build(bundle: string, ...extra: string[]): string {
  const out = scratch('portal-site-');
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

/**
 * The page's text as it first shows: without chips' closed explanations, and
 * without the spaces text() leaves where a tag meets punctuation.
 */
const shown = (html: string) =>
  text(html.replace(/<span id="[^"]+" class="chip-tip" popover>[\s\S]*?<\/span><\/span>/g, ''))
    .replace(/\s+([,.;)])/g, '$1')
    .replace(/\(\s+/g, '(');

/** The commands an image page shows, as text, in order. */
const shownCommands = (html: string) =>
  [...html.matchAll(/<pre[^>]*><code>([\s\S]*?)<\/code><\/pre>/g)].map((m) =>
    m[1].replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'),
  );

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
    const page = text(read(site, 'images/docker-io-library-redis-7/index.html'));
    assert.match(page, /No vulnerability data from the publisher, so what the build-time scan found is unknown/);
    assert.doesNotMatch(page, /0 findings|No findings/);
    // From a run that didn't rescan, it says so in one scan's words.
    const norescan = build(editedBundle(MINIMAL, (r) => {
      delete r.policy.rescan;
      delete r.policy.scanSource;
      delete r.summary.rescan;
      for (const image of r.images) delete image.rescan;
    }));
    const single = text(read(norescan, 'images/docker-io-library-redis-7/index.html'));
    assert.match(single, /This image has no vulnerability data, so how many vulnerabilities it has is unknown/);
    assert.doesNotMatch(single, /0 findings|No findings|At build time|this run's scan/);
    assert.match(text(read(norescan, 'images/ghcr-io-acme-images-billing-1-4-2/index.html')), /From the publisher's signed report \(grype 0\.118\.0\), made 2026-10-06 05:41 UTC\. The findings describe that day\./);
  });

  test('an image whose base is unknown says so, with the reasons', () => {
    const page = text(read(site, 'images/docker-io-library-redis-7/index.html'));
    assert.match(page, /No base could be determined/);
    assert.match(page, /no observed image.s layers are a prefix of this image/);
  });

  test('unknown evidence is shown as unknown', () => {
    const page = text(read(site, 'images/docker-io-library-redis-7/index.html'));
    assert.match(page, /SBOM \? Unknown/);
  });

  const vulnsOf = (page: string) => page.slice(page.indexOf('Vulnerabilities Two scans'), page.indexOf('Tests and rebuilds'));

  test("an image's page shows both scans side by side, each with its database's day", () => {
    const vulns = vulnsOf(shown(read(site, 'images/ghcr-io-acme-images-billing-1-4-2/index.html')));
    assert.match(vulns, /At build time · the publisher's scan Report ✓ Verified grype 0\.118\.0 Scanned 2026-10-06 05:41 UTC Database its build time isn't recorded/);
    assert.match(vulns, /Now · this run's scan ✓ Scanned ✓ linux\/amd64: Scanned Scanner grype 0\.121\.0 Scanned 2026-10-06 06:00 UTC Database built 2026-10-06 06:00 UTC \(schema v6\.1\.10\)/);
    assert.match(vulns, /The policy's limit \(critical, fixable only\) gated on both scans: an image fails when either finds enough/);
    assert.match(vulns, /At build time Findings 0 1 2 0 0 0 With a fix 0 0 1 0 0 0 Now Findings 1 1 1 0 0 0 With a fix 1 1 1 0 0 0/);
    assert.match(vulns, /This run's scan counts 1 advisory the publisher's doesn't: CVE-2026-2000\./);
    assert.match(vulns, /At build time 2 findings in the publisher's scan, fix first .* Now 3 findings in this run's scan, fix first/);
  });

  test("a rescan that couldn't run is couldn't check, never clean", () => {
    for (const id of ['docker-io-library-redis-7', 'cgr-dev-chainguard-static']) {
      const vulns = vulnsOf(shown(read(site, `images/${id}/index.html`)));
      assert.match(vulns, /Now · this run's scan \? Couldn't check/, id);
      assert.match(vulns, /Now Findings \? \? \? \? \? \? With a fix \? \? \? \? \? \?/, id);
      assert.match(vulns, /\? means unknown: there are no findings from that scan to count, which isn't zero\./, id);
      assert.doesNotMatch(vulns, /No findings|0 findings|in this run's scan, fix first/, id);
    }
    assert.match(
      shown(read(site, 'images/cgr-dev-chainguard-static/index.html')),
      /\? Couldn't check The image's current vulnerabilities are unknown: linux\/amd64: no verified SBOM .* \? linux\/amd64: Couldn't check \? linux\/arm64: Couldn't check/,
    );
    // A run that rescanned, but not this image: unknown too.
    const skipped = build(editedBundle(MINIMAL, (r) => delete r.images.find((i: any) => i.id === 'ghcr-io-acme-images-hello-app').rescan));
    const vulns = vulnsOf(shown(read(skipped, 'images/ghcr-io-acme-images-hello-app/index.html')));
    assert.match(vulns, /Now · this run's scan \? Couldn't check This run rescanned images, but not this one, so its current vulnerabilities are unknown\./);
    assert.match(vulns, /Now Findings \? \? \? \? \? \?/);
  });

  test('the policy says whether the run rescanned, which scan gated, and which VEX documents and patterns were in force', () => {
    for (const page of ['index.html', 'about/index.html']) {
      const html = read(site, page);
      const policy = shown(html.slice(html.indexOf('id="policy"'), html.indexOf('</section>', html.indexOf('id="policy"'))));
      assert.match(policy, /Vulnerabilities fail at critical or above, counting only findings with a fix, in both scans: an image fails when either finds enough, and is unverified when either is unknown/, page);
      assert.match(policy, /Rescan yes: this run scanned each image's verified SBOMs itself, against a vulnerability database of its day/, page);
      assert.match(policy, /VEX documents OpenVEX documents applied to this run's rescans: .* vex\/acme\.openvex\.json \(https:\/\/acme\.example\/vex\/2026-10\) by acme security, 2 statements/, page);
      assert.match(policy, /Observe-only Images matching these .* cgr\.dev\/chainguard\/\*/, page);
      assert.match(policy, /Trusted signers role image: an image's signature and attestations/, page);
      assert.doesNotMatch(policy, /Provenance builders/, page);
    }
    // Builders, when the policy names them; and a run without a rescan says so.
    const other = build(
      editedBundle(MINIMAL, (r) => {
        r.policy.provenanceBuilders = ['https://github.com/acme/builder/.github/workflows/build.yml@refs/tags/v1'];
        delete r.policy.rescan;
        delete r.policy.scanSource;
        delete r.policy.vex;
        delete r.summary.rescan;
        for (const image of r.images) delete image.rescan;
      }),
    );
    const policy = shown(read(other, 'about/index.html'));
    assert.match(policy, /Provenance builders Verified SLSA provenance must name one of these builders; provenance that names another, or none, fails\. https:\/\/github\.com\/acme\/builder\/\.github\/workflows\/build\.yml@refs\/tags\/v1/);
    assert.match(policy, /Rescan no: the findings are the publishers' scans, each as of the day it ran/);
    assert.match(policy, /Vulnerabilities fail at critical or above, counting only findings with a fix Rescan no/);
    assert.doesNotMatch(policy, /VEX documents/);
  });

  test('an observe-only image is counted apart, marked, and holds nothing back', () => {
    const html = read(site, 'index.html');
    const page = shown(html);
    assert.match(page, /✕ Policy does not pass: of 3 gating images, 2 fail it\. 1 more image is observe-only ?: it has a verdict, but the policy doesn't gate on it\./);
    assert.match(page, /1 – Observe-only Observed, not gating/);
    assert.match(html, /<a class="tile tone-muted tile-link" href="\/portal\/lists\/observe-only\/">/);
    // On no reason card, and last in the table, with its own verdict and a mark.
    const reasons = html.slice(html.indexOf('id="attention"'), html.indexOf('id="fix-first"'));
    assert.doesNotMatch(reasons, /\/images\/cgr-dev-chainguard-static\//);
    assert.match(shown(reasons), /Observe-only images hold nothing back/);
    const table = html.slice(html.indexOf('<table class="images"'), html.indexOf('</table>', html.indexOf('<table class="images"')));
    const order = [...table.matchAll(/<a href="\/portal\/images\/([^/]+)\/">/g)].map((m) => m[1]);
    assert.equal(order.at(-1), 'cgr-dev-chainguard-static');
    assert.match(table, /<td data-sort-value="3 0">.*?✕<\/span>Failed<\/button>.*?–<\/span>Observe-only<\/button>/s);
    // Its page says what it is; the lists count it apart.
    assert.match(shown(read(site, 'images/cgr-dev-chainguard-static/index.html')), /✕ Failed – Observe-only The policy observes this image without gating on it/);
    assert.match(shown(read(site, 'lists/observe-only/index.html')), /Observe-only images .* static:latest/);
    assert.doesNotMatch(read(site, 'lists/failed/index.html'), /\/images\/cgr-dev-chainguard-static\//);
    assert.match(shown(read(site, 'lists/failed/index.html')), /Images the policy only observes aren't counted here; they are listed apart\./);
  });

  test("the images table gives this run's scan beside the publisher's, or says it couldn't check", () => {
    const html = read(site, 'index.html');
    const table = html.slice(html.indexOf('<table class="images"'), html.indexOf('</table>', html.indexOf('<table class="images"')));
    const row = (id: string) => shown(table.slice(table.indexOf(`/images/${id}/`), table.indexOf('</tr>', table.indexOf(`/images/${id}/`))));
    assert.match(row('ghcr-io-acme-images-billing-1-4-2'), /0 C · 1 H now 1 C · 1 H/);
    assert.match(row('docker-io-library-redis-7'), /\? Unknown \? now: couldn't check/);
    assert.match(row('ghcr-io-acme-images-hello-app'), /0 findings now 0 C · 0 H/);
    // Sorted worst first by the worse of the two scans.
    assert.match(table, /data-sort-value="1 1 2 0"/);
  });

  test('a suppressed finding stays listed, open, with the statement that suppressed it', () => {
    const html = read(site, 'images/ghcr-io-acme-images-billing-1-4-2/index.html');
    const page = shown(html);
    assert.match(page, /2 suppressed in this run's scan by a VEX statement or the scanner \(not counted\)/);
    assert.match(
      page,
      /CVE-2026-9999 CVE record .*? github\.com\/acme\/lib v1\.2\.0 medium no fix known linux\/amd64 ○ Suppressed A VEX statement in vex\/acme\.openvex\.json \(https:\/\/acme\.example\/vex\/2026-10\): not_affected, vulnerable_code_not_in_execute_path, about pkg:oci\/billing\?repository_url=ghcr\.io\/acme\/images\/billing\./,
    );
    assert.match(page, /CVE-2026-0042 CVE record .*? linux-headers 6\.12 low no fix known linux\/amd64 ○ Suppressed A rule of the scanner's own: ignored by grype's own rules \(exact-indirect-match\)\./);
    assert.match(page, /1 suppressed in the publisher's scan .* ○ Suppressed The publisher's scan suppressed it, with a statement this run didn't see\./);
    assert.match(html, /<details open class="findings"[^>]*>\s*<summary>2 suppressed in this run&#39;s scan/);
  });

  test("an image's page lists what it failed apart from what couldn't be checked", () => {
    const page = shown(read(site, 'images/docker-io-library-redis-7/index.html'));
    const head = page.slice(0, page.indexOf('Identity Digest'));
    assert.match(head, /✕ Failed signature is missing vulnerabilityScan is missing provenance is missing \? Couldn't be checked · not a pass, and not a failure none of its evidence is verified/);
    const unknown = head.slice(head.indexOf("Couldn't be checked"));
    assert.match(unknown, /sbom is unknown \(couldn't be read or checked\)/);
    assert.match(unknown, /current vulnerabilities are unknown \(the rescan is unknown/);
    assert.doesNotMatch(unknown, /signature is missing/);
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
      // Scripts may fetch the site's own files (the package search's index), nothing else.
      assert.deepEqual(csp.get('connect-src'), ["'self'"], file);
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

  test('every script is a file of the site, never inline', () => {
    for (const file of htmlFiles(site)) {
      for (const m of readFileSync(file, 'utf8').matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
        assert.match(m[1], /\bsrc="\/portal\//, `${file}: inline script`);
        assert.equal(m[2], '', file);
      }
    }
  });

  test('the package search loads its index from the site, and says what to do without script', () => {
    const index = JSON.parse(read(site, 'packages/search-index.json'));
    const report = readBundle(MINIMAL).report;
    assert.deepEqual(index.images.map((i: any) => i.id).sort(), report.images.map((i) => i.id).sort());
    assert.ok(index.images.every((i: any) => i.href.startsWith('/portal/images/')));
    assert.ok(index.packages.every((p: any) => p.href.startsWith('/portal/packages/')));
    const html = read(site, 'packages/index.html');
    assert.match(html, /<div data-package-search data-index="\/portal\/packages\/search-index\.json" hidden>/);
    assert.match(text(html), /Searching by version needs JavaScript\. Without it, open a package below/);
    assert.match(shown(html), /A version without an epoch or a revision ignores the package's: <2\.14\.0 holds for 2\.13\.9-r5 and not for 2\.14\.0-r1\./);
  });

  test('an image page shows commands to check it, naming the image by digest', () => {
    const html = read(site, 'images/ghcr-io-acme-images-hello-app/index.html');
    const commands = shownCommands(html);
    const report = readBundle(MINIMAL).report;
    const image = report.images.find((i) => i.id === 'ghcr-io-acme-images-hello-app')!;
    assert.deepEqual(commands, verifyCommands(report, image).commands.map((c) => c.text));
    assert.ok(commands.some((c) => c.startsWith('cosign verify \\')));
    assert.ok(commands.some((c) => c.startsWith(`gh attestation verify \\\n  oci://ghcr.io/acme/images/hello-app@${image.digest}`)));
    assert.ok(commands.some((c) => c.startsWith('clearcutt-factory verify')));
    for (const c of commands) assert.doesNotMatch(c, /hello-app:latest/);
    // Copy buttons wait for the script, which unhides them where the clipboard works.
    assert.match(html, /<button type="button" class="copy" data-copy aria-label="Copy the Signature command" hidden>Copy<\/button>/);
    assert.match(shown(read(site, 'images/docker-io-library-redis-7/index.html')), /No command for SBOM: it isn't verified, so there is no trusted signer to check it against\./);
  });

  test('a reproduction says what checked it: this run, or an attestation and where it ran', () => {
    assert.match(shown(read(site, 'images/ghcr-io-acme-images-hello-app/index.html')), /Checked by this run, which rebuilt it\./);
    const html = read(site, 'images/ghcr-io-acme-images-billing-1-4-2/index.html');
    const page = shown(html);
    assert.match(page, /Checked by a clearcutt-factory reproduction attestation, verified against a trusted signer; this run didn't rebuild it\./);
    assert.match(page, /Attestation signed by https:\/\/github\.com\/acme\/images\/\.github\/workflows\/fleet\.yml@refs\/heads\/main \(issuer https:\/\/token\.actions\.githubusercontent\.com\) ghcr\.io\/acme\/images\/billing@sha256:a?(ba)+b?/);
    assert.match(
      page,
      /Where it was reproduced, as the attestation says: Run: https:\/\/github\.com\/acme\/images\/actions\/runs\/123\/attempts\/1 Workflow acme\/images\/\.github\/workflows\/fleet\.yml@refs\/heads\/main, job rebase Machine: github-hosted, linux\/amd64 clearcutt-factory v0\.2\.0/,
    );
    assert.match(html, /<a href="https:\/\/github\.com\/acme\/images\/actions\/runs\/123\/attempts\/1" rel="noreferrer">/);
  });

  test("GitHub's provenance is checked with gh, from the registry, against the workflow that signed it", () => {
    const commands = shownCommands(read(site, 'images/ghcr-io-acme-images-hello-app/index.html'));
    assert.ok(commands.some((c) => c.includes('--bundle-from-oci \\\n  --repo=acme/images \\\n  --signer-workflow=github.com/acme/images/.github/workflows/images.yml')));
  });

  test('the skip link is the first thing on the page, and shows when focused', () => {
    const html = read(site, 'index.html');
    assert.match(html, /<body>\s*<a class="skip-link" href="#main">Skip to content<\/a>/);
    assert.match(html, /<main id="main"/);
    const css = readdirSync(path.join(site, '_assets'))
      .filter((f) => f.endsWith('.css'))
      .map((f) => read(site, `_assets/${f}`))
      .join('');
    assert.match(css, /\.skip-link:focus\{transform:none\}/);
  });

  test('every chip opens its meaning, for keyboard, touch, and screen readers alike', () => {
    for (const file of htmlFiles(site)) {
      const html = readFileSync(file, 'utf8');
      const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
      assert.equal(new Set(ids).size, ids.length, `${file}: duplicate ids`);
      const chips = [...html.matchAll(/<(\w+) [^>]*class="chip [^"]*"[^>]*>/g)];
      for (const [tag, name] of chips.map((m) => [m[0], m[1]])) {
        assert.equal(name, 'button', `${file}: ${tag}`);
        const target = tag.match(/popovertarget="([^"]+)"/)?.[1];
        const described = tag.match(/aria-describedby="([^"]+)"/)?.[1];
        assert.ok(target && ids.includes(target), `${file}: ${tag} opens nothing`);
        assert.ok(described && ids.includes(described), `${file}: ${tag} describes nothing`);
        assert.match(html, new RegExp(`id="${target}" class="chip-tip" popover>`), file);
      }
    }
    const page = read(site, 'images/cgr-dev-chainguard-static/index.html');
    assert.match(text(page), /Present, unverified\. Found, but not checked/);
  });

  test('every status cell takes keyboard focus and is named for what it says', () => {
    const html = read(site, 'index.html');
    const cells = [...html.matchAll(/<span class="cell-status tone-[a-z]+"([^>]*)>/g)].map((m) => m[1]);
    assert.ok(cells.length >= 4 * 8, 'a status cell per evidence kind and rebuild, per image');
    for (const attrs of cells) {
      assert.match(attrs, /\stabindex="0"/);
      assert.match(attrs, /\srole="img"/);
      const label = attrs.match(/\saria-label="([^"]+)"/)?.[1];
      assert.ok(label, attrs);
      assert.match(label, /^(Signature|SBOM|Vulnerability report|SLSA provenance|Recipe|Rebase record|Tests|Rebuild): /);
      assert.ok(attrs.includes(`data-label="${label}"`), 'the label shown on focus is the accessible name');
    }
    assert.match(html, /aria-label="SBOM: Unknown/);
  });

  test('charts hold nothing focusable, and every charted value is in the table of runs', () => {
    const html = read(site, 'history/index.html');
    const charts = [...html.matchAll(/<svg\b[^>]*role="img"[^>]*>[\s\S]*?<\/svg>/g)].map((m) => m[0]);
    assert.ok(charts.length > 5);
    for (const svg of charts) {
      assert.doesNotMatch(svg, /tabindex|<a\b|<button/);
      assert.match(svg, /aria-label="[^"]+"/);
    }
    assert.match(html, /aria-label="Signatures verified\. 2 runs; latest [^"]+\. Every value is in the table of every run below\."/);
    assert.match(text(html), /Not scanned Signatures verified Reproduced/);
  });

  test('a rebased image names what it was rebased from', () => {
    const page = text(read(site, 'images/ghcr-io-acme-images-billing-1-4-2/index.html'));
    assert.match(page, /Rebased from ghcr\.io\/acme\/images\/billing@sha256:0{64} onto/);
  });
});

describe('a report written by someone hostile', () => {
  let site: string;
  before(() => {
    const bundle = editedBundle(MINIMAL, (r) => {
      const byId = (id: string) => r.images.find((i: any) => i.id === id);
      r.images = [
        byId('cgr-dev-chainguard-static'),
        byId('ghcr-io-acme-images-hello-app'),
        byId('ghcr-io-acme-images-billing-1-4-2'),
        byId('docker-io-library-redis-7'),
      ];
      r.images[0].source = { url: 'javascript:alert(document.domain)', basis: 'label' };
      r.images[2].source = { url: 'https://github.com@evil.example/acme', basis: 'annotation' };
      r.images[3].source = { url: 'https://example.test/acme/redis', basis: 'label' };
      r.images[3].description = '<script>alert(1)</script><img src=x onerror=alert(1)>';
      r.policy.trustedSigners[0].identityRegexp = "^https://github\\.com/acme/(images|'$(touch pwned)'</code><script>alert(1)</script>)/";
      r.images[2].reproducibility.builder.id = 'javascript:alert(document.domain)';
      // Not the policy's: the command would name it, and it can't be shown as it is.
      r.images[1].evidence.sbom.signer.identity = 'https://github.com/other/images/x\n$(touch pwned)';
      // Finding IDs that are markup, a path, and almost a CVE.
      r.images[2].vulnerabilities.findings.push(
        ...['"><script>alert(1)</script>', '../../../etc/passwd', 'CVE-2026-1234 javascript:alert(1)'].map((id) => ({
          id,
          severity: 'high',
          package: 'p',
          version: '1',
          platforms: ['linux/amd64'],
        })),
      );
    });
    site = build(bundle);
    report = readBundle(bundle).report;
  });
  let report: ReturnType<typeof readBundle>['report'];

  test('a hostile signer is quoted in the command, or the command is not shown', () => {
    const html = read(site, 'images/ghcr-io-acme-images-hello-app/index.html');
    assert.doesNotMatch(html, /<script>alert/);
    const image = report.images.find((i) => i.id === 'ghcr-io-acme-images-hello-app')!;
    const built = verifyCommands(report, image);
    assert.deepEqual(shownCommands(html), built.commands.map((c) => c.text));
    assert.ok(built.commands[0].text.includes("--certificate-identity-regexp='^https://github\\.com/acme/(images|'\\''$(touch pwned)'\\''</code><script>alert(1)</script>)/'"));
    assert.match(shown(html), /Not shown This page shows no command for these, for the reason given\. .* SBOM ?: The signer's certificate-identity has characters other than printable ASCII\./);
  });

  test('a source URL that is not http(s) is shown as text, never as a link', () => {
    const page = read(site, 'images/cgr-dev-chainguard-static/index.html');
    assert.doesNotMatch(page, /href="javascript:/i);
    assert.match(page, /<code>javascript:alert\(document\.domain\)<\/code> <span class="dim small">\(not linked/);
    assert.match(read(site, 'images/ghcr-io-acme-images-billing-1-4-2/index.html'), /<code>https:\/\/github\.com@evil\.example\/acme<\/code>/);
  });

  test("a reproduction's run that is not http(s) is shown as text", () => {
    const page = read(site, 'images/ghcr-io-acme-images-billing-1-4-2/index.html');
    assert.match(page, /Run: <code>javascript:alert\(document\.domain\)<\/code> <span class="dim small">\(not linked/);
  });

  test('an http(s) source URL is a link', () => {
    assert.match(
      read(site, 'images/docker-io-library-redis-7/index.html'),
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
    const page = read(site, 'images/docker-io-library-redis-7/index.html');
    assert.doesNotMatch(page, /<script>alert|<img src=x/);
    assert.match(page, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  });

  test('a hostile finding ID is escaped, gets a page inside findings/, and links nowhere else', () => {
    const pages = readdirSync(path.join(site, 'findings')).sort();
    assert.ok(pages.includes('etc-passwd') && pages.includes('script-alert-1-script'), pages.join(' '));
    assert.ok(!existsSync(path.join(site, 'etc')));
    for (const page of ['findings/index.html', 'images/ghcr-io-acme-images-billing-1-4-2/index.html']) {
      const html = read(site, page);
      // Inside a quoted attribute, where < is text, it may stay as it is.
      assert.doesNotMatch(html.replace(/="[^"]*"/g, '=""'), /<script>alert/);
      assert.match(html, /&quot;&gt;&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
      // Almost a CVE is not one: no advisory link built from it.
      assert.doesNotMatch(html, /cve\.org[^"]*javascript|nvd\.nist\.gov[^"]*javascript/);
    }
  });
});

describe('the fixture site', () => {
  let site: string;
  before(() => {
    site = build(FIXTURE);
  });

  test('why images fall short: one card per reason, with every image it holds back', () => {
    const html = read(site, 'index.html');
    const section = html.slice(html.indexOf('id="attention"'), html.indexOf('id="fix-first"'));
    const failed = section.slice(section.indexOf('id="reasons-failed"'), section.indexOf('id="reasons-unknown"'));
    const unknown = section.slice(section.indexOf('id="reasons-unknown"'));
    const cards = (part: string) => [...part.matchAll(/<h4>([^<]+)<\/h4>/g)].map((m) => m[1]);
    assert.deepEqual(cards(failed), ['Provenance is missing', 'Sbom is missing', 'Signature is missing']);
    // A failed image's reasons that weren't failures are in a group of their own.
    assert.deepEqual(cards(unknown), [
      'Vulnerabilities are unknown (no scan)',
      'None of its evidence is verified, so a trusted signer vouched for nothing about it',
    ]);
    assert.match(shown(failed), /✕ Failed · 3 reasons The check ran, and the image fell short/);
    assert.match(shown(unknown), /\? Couldn't be checked · 2 reasons The requirement couldn't be decided.*Not a pass, and not a failure\./);
    assert.match(shown(unknown), /Vulnerabilities are unknown \(no scan\) 4 images: 2 failed, 2 unverified amazonlinux:2023 ✕ Failed debian:trixie-slim ✕ Failed static:latest \? Unverified wolfi-base:latest \? Unverified/);
  });

  test('every headline number links to the list of what it counts', () => {
    const html = read(site, 'index.html');
    const tiles = [...html.matchAll(/<a class="tile tone-[a-z]+ tile-link" href="([^"]+)">/g)].map((m) => m[1]);
    for (const path of ['/lists/verified/', '/lists/failed/', '/lists/unverified/', '/findings/', '/lists/stale-base/', '/lists/not-scanned/', '/lists/old-scans/', '/lists/reproduced/', '/lists/not-reproduced/']) {
      assert.ok(tiles.includes(path), path);
    }
    assert.doesNotMatch(html, /<div class="tile /, 'no tile is a dead end');
    // A list is a page of its own, with the images it names and no others.
    const failed = shown(read(site, 'lists/failed/index.html'));
    assert.match(failed, /Failed images.*2 images/);
    const rows = [...read(site, 'lists/failed/index.html').matchAll(/<a href="\/images\/([^/]+)\/">/g)].map((m) => m[1]);
    assert.deepEqual(rows, ['docker-io-library-amazonlinux-2023', 'docker-io-library-debian-trixie-slim']);
    assert.match(shown(read(site, 'lists/not-reproduced/index.html')), /No rebuild gave a different digest/);
  });

  test('the overview counts what did not reproduce, and says how old the oldest scan is', () => {
    const page = shown(read(site, 'index.html'));
    assert.match(page, /✕ Policy does not pass: of 8 images, 2 fail it and 2 are unverified\. Also outstanding: ✕ 25 critical findings \(0 with a fix\) ! 192 high findings \(88 with a fix\) \? 4 images with no vulnerability data Verdicts/);
    assert.match(page, /0 Not reproduced rebuilt to a different digest/);
    assert.match(page, /45 minutes Oldest scan hello-app:latest; none over 7 days 4 Reproduced/);
  });

  test('the findings to fix first: fixable critical and high first, each linked out to its advisory', () => {
    const index = read(site, 'findings/index.html');
    const ids = [...index.matchAll(/<a class="mono" href="\/findings\/[^"]+\/">([^<]+)<\/a>/g)].map((m) => m[1]);
    assert.ok(ids.indexOf('GO-2026-6603') < ids.indexOf('CVE-2026-10536'), 'a fixable high before a critical with no fix');
    assert.match(index, /<a href="https:\/\/pkg\.go\.dev\/vuln\/GO-2026-6603" rel="noreferrer">Go vulnerability database<span class="sr-only"> for GO-2026-6603<\/span><\/a>/);
    assert.match(shown(index), /Covered by a VEX statement everywhere .*GO-2026-6604/);
    const page = shown(read(site, 'findings/go-2026-6603/index.html'));
    assert.match(page, /3 images have it\. Fixed in 0\.60\.0, 1\.26\.9, 1\.27\.2\./);
    assert.match(page, /amazonlinux-tools:latest ✓ Verified golang\.org\/x\/net v0\.57\.0 0\.60\.0 high/);
    const curl = read(site, 'findings/cve-2026-10536/index.html');
    assert.match(curl, /href="https:\/\/www\.cve\.org\/CVERecord\?id=CVE-2026-10536"/);
    assert.match(curl, /href="https:\/\/nvd\.nist\.gov\/vuln\/detail\/CVE-2026-10536"/);
    assert.match(shown(curl), /1 image has it\. No image reports a fixed version\./);
    // Images with no vulnerability data are unknown here, never unaffected.
    assert.match(shown(curl), /Where it is unknown .*4 images have no vulnerability data, so whether they have it is unknown/);
    // The overview's short list is the same order.
    assert.match(shown(read(site, 'index.html')), /Findings to fix first .* GO-2026-/);
  });

  test("an image's findings are fix first, each opening the advisory's page", () => {
    const html = read(site, 'images/ghcr-io-northcutted-images-debian-tools/index.html');
    const rows = [...html.matchAll(/<tr data-text="([^"]+)">/g)].map((m) => m[1]);
    const first = rows.findIndex((r) => r.endsWith(' critical'));
    const fixableHigh = rows.findIndex((r) => r.startsWith('go-2026-6603 '));
    assert.ok(fixableHigh >= 0 && fixableHigh < first, 'a fixable high comes before a critical with no fix');
    assert.match(html, /<a class="mono nowrap" href="\/findings\/cve-2026-10536\/">CVE-2026-10536<\/a>/);
  });

  test('the images table reads in verdict order without script, and says how to sort with it', () => {
    const html = read(site, 'index.html');
    const table = html.slice(html.indexOf('<table class="images" data-sortable>'));
    assert.match(table, /<th data-sort="text"[^>]*>Image<\/th>/);
    const order = [...table.slice(0, table.indexOf('</table>')).matchAll(/<a href="\/images\/([^/]+)\/">/g)].map((m) => m[1]);
    assert.deepEqual(order.slice(0, 4), ['docker-io-library-amazonlinux-2023', 'docker-io-library-debian-trixie-slim', 'cgr-dev-chainguard-static', 'cgr-dev-chainguard-wolfi-base']);
    assert.match(html, /<p class="small dim sort-hint" data-sort-hint hidden>/);
  });

  test('builds, and every verified image shows each required kind verified', () => {
    const report = readBundle(FIXTURE).report;
    for (const image of report.images.filter((i) => i.verdict.status === 'verified')) {
      const page = text(read(site, `images/${image.id}/index.html`));
      assert.match(page, /✓ Verified/);
    }
    assert.match(text(read(site, 'history/index.html')), /Verdicts per run/);
  });

  test("a smoke test the recipe declares reads as declared, not as a generic present", () => {
    const page = shown(read(site, 'images/ghcr-io-northcutted-images-debian-tools/index.html'));
    assert.match(page, /Tests ○ Declared in recipe .*declared in the recipe .*declares a smoke test \(\/usr\/local\/bin\/rg --version\)/);
    assert.match(text(read(site, 'images/ghcr-io-northcutted-images-debian-tools/index.html')), /Tests ○ Declared in recipe Declared in recipe\. The image's verified recipe declares a smoke test/);
    assert.match(shown(read(site, 'about/index.html')), /Declared in recipe .* Nothing attests that the test ran/);
  });

  test('a proven base says which platform images were compared', () => {
    const page = shown(read(site, 'images/ghcr-io-northcutted-images-platform-tools/index.html'));
    assert.match(page, /Proven by layer digests, comparing the linux\/amd64 images\./);
  });

  test('an image says where its package list was read from', () => {
    const page = shown(read(site, 'images/ghcr-io-northcutted-images-platform-tools/index.html'));
    assert.match(page, /Read from its SBOM, which is ✓ Verified; the union of the linux\/amd64, linux\/arm64 images' lists\./);
    const pkg = shown(read(site, 'packages/index.html'));
    assert.doesNotMatch(pkg, /of\d/);
  });

  test('package pages say where each image\'s list came from, not that the report is silent', () => {
    const dir = path.join(site, 'packages');
    const pages = readdirSync(dir).filter((f) => f !== 'index.html');
    const page = shown(read(dir, `${pages[0]}/index.html`));
    assert.match(page, /Package list read from/);
    assert.match(page, /SBOM ✓ Verified/);
    assert.doesNotMatch(page, /doesn't say which source/);
  });

  test('an app on a stack defined beside it says so', () => {
    const page = shown(read(site, 'images/ghcr-io-northcutted-images-hello-app/index.html'));
    assert.match(page, /Stack go defined beside the app, not in a registry; its definition's digest is sha256:cfdf348cb280\./);
    assert.match(shown(read(site, 'stacks/index.html')), /No registry stacks in this report[\s\S]*Apps on stacks not listed here[\s\S]*hello-app:latest on go at sha256:cfdf348cb280/);
    assert.match(read(site, 'index.html'), /<a href="\/stacks\/">Stacks<\/a>/);
  });

  test('history says per-image changes need two runs with rows, and no longer that they are never recorded', () => {
    const page = shown(read(site, 'history/index.html'));
    assert.match(page, /The previous run recorded no per-image rows \(clearcutt-verify writes them from v0\.15\)/);
    assert.doesNotMatch(page, /isn't recorded\./);
    assert.match(page, /UTC\. 3 runs recorded/);
    const image = shown(read(site, 'images/ghcr-io-northcutted-images-debian-tools/index.html'));
    assert.match(image, /This image over time .* 2026-10-10 16:51 UTC sha256:867c6cbf7f44 ✓ Verified ✓ Proven, ✓ current/);
    assert.match(image, /2 earlier runs recorded no per-image rows and aren't shown/);
  });

  test('without a scan-age limit or stacks, the policy says so briefly', () => {
    const page = shown(read(site, 'about/index.html'));
    assert.match(page, /Scan age any age/);
    assert.doesNotMatch(page, /Stack signers/);
  });
});

describe('a report using everything clearcutt-verify v0.15 writes', () => {
  let site: string;
  before(() => {
    site = build(v015Bundle());
  });

  test('the stacks page lists each version, its signature, and the apps pinned to it', () => {
    const page = shown(read(site, 'stacks/index.html'));
    assert.match(page, /ghcr\.io\/northcutted\/stacks\/go Tag apps name ghcr\.io\/northcutted\/stacks\/go:1 It points at sha256:c{64} Apps 1 app, 1 on an older version/);
    assert.match(page, /sha256:cfdf348cb280 ! Older version .*✓ Verified .*\^https:\/\/github\\\.com\/northcutted\/clearcutt-factory\/ cosign signature hello-app:latest/);
    assert.match(page, /checked against the 1 stack signer in the policy/);
    assert.doesNotMatch(page, /Apps on stacks not listed here/);
  });

  test("an app's page names its registry stack, the version's currency and signature, and links to it", () => {
    const html = read(site, 'images/ghcr-io-northcutted-images-hello-app/index.html');
    assert.match(shown(html), /Stack go from the registry stack ghcr\.io\/northcutted\/stacks\/go:1, pinned at sha256:cfdf348cb280\. Version: ! Older version .* Signature: ✓ Verified/);
    assert.match(html, /href="\/stacks\/#stack-ghcr-io-northcutted-stacks-go"/);
    assert.match(read(site, 'stacks/index.html'), /id="stack-ghcr-io-northcutted-stacks-go"/);
  });

  test('the overview counts apps on an older stack version', () => {
    assert.match(shown(read(site, 'index.html')), /1 On an older stack of 1 app on 1 registry stack/);
  });

  test('the policy shows the scan-age limit and the stack signers', () => {
    const page = shown(read(site, 'about/index.html'));
    assert.match(page, /Scan age unverified when the vulnerability scan is more than 7 days old/);
    assert.match(page, /Stack signers role stack: clearcutt-factory stacks Identity matching \^https:\/\/github\\\.com\/northcutted\/clearcutt-factory\//);
    assert.match(shown(read(site, 'images/ghcr-io-northcutted-images-hello-app/index.html')), /The findings describe that day, within the policy's limit of 7 days\./);
  });

  test('a base digest of one platform image says which', () => {
    assert.match(shown(read(site, 'images/ghcr-io-northcutted-images-platform-tools/index.html')), /sha256:1c451d46a0d5\w+ \(its linux\/amd64 image\)/);
    assert.match(shown(read(site, 'bases/index.html')), /Newest observed: cgr\.dev\/chainguard\/wolfi-base:latest sha256:1c451d46a0d5 \(its linux\/amd64 image\)/);
  });

  test('a package list whose source is not recorded says so', () => {
    assert.match(shown(read(site, 'images/ghcr-io-northcutted-images-debian-tools/index.html')), /Where this package set was read from isn't recorded\./);
  });

  test("an image's page shows it run by run, with trends", () => {
    const page = shown(read(site, 'images/ghcr-io-northcutted-images-debian-tools/index.html'));
    assert.match(page, /2026-10-10 16:51 UTC sha256:867c6cbf7f44 rebuilt, same base ✓ Verified/);
    assert.match(page, /2026-10-06 23:30 UTC sha256:dddddddddddd ✕ Failed .* 30 /);
    assert.match(page, /1 earlier run recorded no per-image rows and isn't shown/);
    assert.match(read(site, 'images/ghcr-io-northcutted-images-debian-tools/index.html'), /aria-label="Critical findings\. 2 runs; latest [^"]*: 25\. lowest 25, highest 30\. Every value is in the table above\."/);
    assert.match(shown(read(site, 'images/cgr-dev-chainguard-static/index.html')), /2026-10-06 23:30 UTC Not in this run\./);
  });

  test('the latest two runs side by side: each image before and after, and how it changed', () => {
    const page = shown(read(site, 'history/changes/index.html'));
    assert.match(page, /From 2026-10-06 23:30 UTC to 2026-10-10 16:51 UTC/);
    assert.match(page, /0 Rebased 1 Rebuilt 1 Base moved 1 New 1 Gone 5 Same image/);
    assert.match(page, /retired-image Gone In the older run only\. sha256:eeeeeeeeeeee none recorded ✓ Verified unknown: no vulnerability data/);
    assert.match(page, /static:latest New In the newer run only\./);
    assert.match(
      page,
      /debian-tools:latest Rebuilt, same base A new digest on the same base: its own layers changed\. sha256:dddddddddddd → sha256:867c6cbf7f44 sha256:a29215f6a35e ✓ Current ✕ Failed → ✓ Verified critical 30 → 25 \(5 fewer\) high 116/,
    );
    assert.match(page, /platform-tools:latest Base moved The same image; its base went from stale to current\. sha256:bf7990acf59e sha256:1c451d46a0d5 ! Stale → ✓ Current/);
    assert.match(page, /5 images unchanged/);
    assert.match(page, /The older run recorded only each image's digest, verdict, base, rebase, and findings counted by severity, not which findings or which packages/);
    assert.doesNotMatch(page, /Fixable findings, by ID .* Fixed in/);
    // The drill: who had criticals before and after, and how each changed.
    assert.match(page, /critical debian-tools:latest \(rebuilt, same base\) debian-tools:latest \(rebuilt, same base\) none none none/);
    // The same comparison has a page of its own, and the others are a link away.
    const pair = '20261006T233046Z--20261010T165146Z';
    assert.equal(shown(read(site, `history/changes/${pair}/index.html`)).replace(/Changes from \S+ \S+ \S+ to \S+ \S+ \S+ · /, ''), page.replace(/Changes between runs · /, ''));
    const html = read(site, 'history/changes/index.html');
    assert.match(html, /<a href="\/history\/changes\/20261006T231441Z--20261006T233046Z\/">/);
    assert.match(html, /<a href="\/history\/changes\/20261006T231441Z--latest\/">Since 2026-10-06 23:14 UTC<\/a>/);
    assert.match(shown(read(site, 'history/changes/20261006T231441Z--latest/index.html')), /From 2026-10-06 23:14 UTC to 2026-10-10 16:51 UTC/);
    assert.match(shown(read(site, 'history/changes/20261006T231441Z--20261006T233046Z/index.html')), /The older run recorded no per-image rows/);
    assert.match(read(site, 'history/index.html'), /<a href="\/history\/changes\/20261006T233046Z--20261010T165146Z\/"[^>]*>What changed<\/a>/);
    assert.match(shown(read(site, 'history/index.html')), /Compare the two runs image by image ?: each image before and after/);
  });

  test('the history page lists what changed for each image', () => {
    const page = shown(read(site, 'history/index.html'));
    assert.match(page, /retired-image Not in this run/);
    assert.match(page, /static:latest New in this run/);
    assert.match(page, /debian-tools:latest Verdict ✕ Failed → ✓ Verified Rebuilt, same base: sha256:dddddddddddd → sha256:867c6cbf7f44 Critical findings 30 → 25/);
    assert.match(page, /platform-tools:latest Base ! Stale → ✓ Current/);
  });
});

describe('a report from a newer clearcutt-verify', () => {
  // Fields this contract doesn't have yet, and images that trust left bare:
  // newer clearcutt-verify reads nothing from evidence no trusted signer
  // verified.
  let site: string;
  before(() => {
    const bundle = editedBundle(FIXTURE, (r) => {
      const image = (id: string) => r.images.find((i: any) => i.id === id);
      Object.assign(image('ghcr-io-northcutted-images-platform-tools').base, { drift: 'stale', versionsBehind: 1, daysBehind: 0, daysBehindUnknown: true });
      image('ghcr-io-northcutted-images-platform-tools').evidence.signature.someLaterField = 'ignored';
      r.someLaterSection = [{ anything: true }];
      r.metadata.generator = { name: 'clearcutt-verify', version: 'v99.0.0' };
      const bare = image('ghcr-io-northcutted-images-debian-tools');
      bare.verdict = { status: 'unverified', reasons: ['sbom is present but not from a trusted signer'] };
      for (const key of ['vulnerabilities', 'packages', 'packagesSource', 'factory']) delete bare[key];
      for (const pkg of r.packages) pkg.images = pkg.images.filter((id: string) => id !== 'ghcr-io-northcutted-images-debian-tools');
      r.packages = r.packages.filter((pkg: any) => pkg.images.length > 0);
      image('cgr-dev-chainguard-wolfi-base').packagesSource.status = 'present';
      image('cgr-dev-chainguard-static').evidence.signature = {
        status: 'failed',
        source: 'cosign-signature',
        signer: { identity: 'https://github.com/someone/else/.github/workflows/sign.yml@refs/heads/main', issuer: 'https://token.actions.githubusercontent.com' },
        detail: 'Signed by an identity the policy does not trust.',
      };
    });
    site = build(bundle);
  });

  test("what this portal's contract doesn't cover is in every page's footer and on the about page", () => {
    for (const page of ['index.html', 'images/ghcr-io-northcutted-images-platform-tools/index.html', 'about/index.html']) {
      const text = shown(read(site, page));
      assert.match(text, /This report goes beyond what this portal knows\./, page);
      assert.match(text, /estate-report\.json has 2 fields this portal's contract doesn't define, so no page shows them: images\[\]\.evidence\.signature\.someLaterField, someLaterSection\./, page);
      assert.match(text, /written by clearcutt-verify v99\.0\.0, newer than v\d+\.\d+\.\d+, whose contract this portal was built against/, page);
    }
    assert.match(shown(read(site, 'about/index.html')), /This portal was built against the contract of clearcutt-verify v\d+\.\d+\.\d+\./);
  });

  test('a stale base whose age is unknown says so, never 0 days', () => {
    const page = shown(read(site, 'images/ghcr-io-northcutted-images-platform-tools/index.html'));
    assert.match(page, /! Stale 1 version behind; how many days couldn't be measured/);
    assert.doesNotMatch(page, /0 days behind/);
    assert.match(shown(read(site, 'bases/index.html')), /platform-tools:latest ✓ Proven ! behind, age unknown/);
    assert.match(shown(read(site, 'bases/index.html')), /cgr\.dev\/chainguard\/wolfi-base:latest cgr\.dev\/chainguard\/wolfi-base:latest ✓ Proven 1 unknown/);
    assert.match(shown(read(site, 'index.html')), /platform-tools:latest cgr\.dev\/chainguard\/wolfi-base:latest ✓ Proven 1 unknown/);
  });

  test('an image with nothing trusted to read from says what is unknown', () => {
    const page = shown(read(site, 'images/ghcr-io-northcutted-images-debian-tools/index.html'));
    assert.match(page, /\? Unverified \? Couldn't be checked · not a pass, and not a failure sbom is present but not from a trusted signer/);
    assert.match(page, /This image has no vulnerability data, so how many vulnerabilities it has is unknown\./);
    assert.match(page, /The report has no package set for this image, so what it ships is unknown\./);
    assert.doesNotMatch(page, /clearcutt-factory App|Stack go|undefined|NaN/);
    const pkg = shown(read(site, 'packages/index.html'));
    assert.match(pkg, /3 images have no package set in the report\. Whether they ship this is unknown: [^.]*debian-tools:latest/);
  });

  test("a signer is shown as checked only on verified evidence", () => {
    const page = shown(read(site, 'images/cgr-dev-chainguard-static/index.html'));
    assert.match(page, /Signature ✕ Failed https:\/\/github\.com\/someone\/else\/\S+ issuer \S+ as its certificate claims; not checked/);
    assert.equal(page.match(/as its certificate claims/g)?.length, 1);
  });

  test('a package list read from unverified SBOMs is flagged as possibly incomplete', () => {
    assert.match(shown(read(site, 'images/cgr-dev-chainguard-wolfi-base/index.html')), /which is ○ Present, unverified; .*No trusted signer verified all of it, so the list may not be complete\./);
    assert.match(shown(read(site, 'packages/index.html')), /1 image's package list rests on SBOMs no trusted signer verified, so it may not be complete: wolfi-base:latest\./);
  });
});

describe('runs that list fixable findings and package digests', () => {
  // The fixture's latest run lists them; give the run before it rows too,
  // where debian-tools was another build with one finding fixed since, one
  // not yet there, and other packages, and static's packages weren't read.
  let site: string;
  before(() => {
    site = build(
      editedBundle(FIXTURE, () => {}, (h) => {
        const [latest, previous] = h.entries;
        previous.images = structuredClone(latest.images).map((i: any) => {
          if (i.id === 'ghcr-io-northcutted-images-debian-tools') {
            const ids = [...i.fixableFindings.filter((f: string) => f !== 'GO-2026-6629'), 'CVE-2026-0001'].sort();
            return { ...i, digest: `sha256:${'d'.repeat(64)}`, fixableFindings: ids, packagesDigest: `sha256:${'0'.repeat(64)}` };
          }
          if (i.id === 'cgr-dev-chainguard-static') delete i.packagesDigest;
          return i;
        });
      }),
    );
  });

  test('the comparison names the findings fixed and introduced, and whether packages changed', () => {
    const page = shown(read(site, 'history/changes/index.html'));
    assert.match(page, /1 fixable high or critical finding was fixed and 1 was introduced, counted per image; and 1 image changed its package set\./);
    assert.match(page, /debian-tools:latest Rebuilt, same base .* Fixed: CVE-2026-0001 New: GO-2026-6629 changed 7 images unchanged/);
    assert.match(page, /Fixable findings, by ID .* Finding Had it before Has it after Fixed in New in GO-2026-6629 amazonlinux-tools:latest \(unchanged\) platform-tools:latest \(unchanged\) debian-tools:latest \(rebuilt, same base\) amazonlinux-tools:latest \(unchanged\) platform-tools:latest \(unchanged\) none debian-tools:latest \(rebuilt, same base\)/);
    assert.match(page, /CVE-2026-0001 debian-tools:latest \(rebuilt, same base\) none debian-tools:latest \(rebuilt, same base\) none/);
    assert.match(page, /"changed" says the set differs, not which packages/);
    assert.doesNotMatch(page, /which advisories were fixed and whether packages changed between them isn't known/);
  });

  test('the history page lists them too', () => {
    assert.match(
      shown(read(site, 'history/index.html')),
      /debian-tools:latest Rebuilt, same base: sha256:dddddddddddd → sha256:867c6cbf7f44 Fixed: CVE-2026-0001 New: GO-2026-6629 Package set changed/,
    );
  });
});

describe('an image whose own packages are unknown', () => {
  // platform-tools without its SBOM: it still has wolfi-base's packages,
  // because the report proves it is built on wolfi-base's exact layers.
  let site: string;
  before(() => {
    site = build(
      editedBundle(FIXTURE, (r) => {
        const tools = r.images.find((i: any) => i.id === 'ghcr-io-northcutted-images-platform-tools');
        delete tools.packages;
        delete tools.packagesSource;
        for (const pkg of r.packages) pkg.images = pkg.images.filter((id: string) => id !== 'ghcr-io-northcutted-images-platform-tools');
        r.packages = r.packages.filter((pkg: any) => pkg.images.length > 0);
      }),
    );
  });

  test("is listed on its base's package pages as inheriting them, without script", () => {
    const page = shown(read(site, 'packages/apk-busybox/index.html'));
    assert.match(page, /1 image ships it, in 1 version, and 1 more image inherits it from a base\./);
    assert.match(
      page,
      /Built on one that ships it How platform-tools:latest Inherits it Built on wolfi-base:latest, which ships it\. The base link is proven by layer digests\. Its own package list is not in the report\./,
    );
  });

  test('is in the search index with its base link', () => {
    const index = JSON.parse(read(site, 'packages/search-index.json'));
    assert.deepEqual(index.images.find((i: any) => i.id === 'ghcr-io-northcutted-images-platform-tools'), {
      id: 'ghcr-io-northcutted-images-platform-tools',
      label: 'platform-tools:latest',
      href: '/images/ghcr-io-northcutted-images-platform-tools/',
      packages: 'unknown',
      base: { id: 'cgr-dev-chainguard-wolfi-base', strength: 'proof', exact: true },
    });
  });
});

describe('a rebased image with per-image history', () => {
  test('lists each rebase from the run that first recorded it', () => {
    const billing = 'ghcr-io-acme-images-billing-1-4-2';
    const bundle = editedBundle(
      MINIMAL,
      () => {},
      (h) => {
        const [latest, previous] = h.entries;
        latest.images = [
          {
            id: billing,
            digest: `sha256:${'5'.repeat(64)}`,
            verdict: 'failed',
            rebasedFrom: `ghcr.io/acme/images/billing@sha256:${'0'.repeat(64)}`,
            rebaseStatus: 'verified',
          },
        ];
        previous.images = [{ id: billing, digest: `sha256:${'0'.repeat(64)}`, verdict: 'failed' }];
      },
    );
    const page = shown(read(build(bundle), `images/${billing}/index.html`));
    assert.match(page, /First recorded Rebased from Gave Rebase record 2026-10-06 06:00 UTC ghcr\.io\/acme\/images\/billing@sha256:0{64} sha256:555555555555 ✓ Verified/);
    assert.match(page, /sha256:555555555555 rebased ✕ Failed/);
  });
});

describe('a history longer than the site shows', () => {
  let site: string;
  before(() => {
    site = build(v015Bundle(), '--history-runs', '2');
  });

  test('the history pages show the latest runs, say so, and point to the rest', () => {
    const page = shown(read(site, 'history/index.html'));
    assert.match(page, /3 runs recorded; this site shows the latest 2\./);
    assert.match(page, /The latest 2 runs 1 older run is not shown here, in the trends, or in the comparisons/);
    assert.match(read(site, 'history/index.html'), /<a href="\/estate-history\.json"[^>]*>estate-history\.json<\/a> has every run/);
    // Comparisons among the shown runs only: each with the one before, and since each.
    const pairs = readdirSync(path.join(site, 'history/changes'), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
    assert.deepEqual(pairs, ['20261006T233046Z--20261010T165146Z', '20261006T233046Z--latest']);
    assert.match(shown(read(site, 'history/changes/index.html')), /This site compares the latest 2 runs; 1 older one is in estate-history\.json\./);
    assert.match(shown(read(site, 'images/ghcr-io-northcutted-images-debian-tools/index.html')), /This shows the latest 2 runs; 1 older one is in estate-history\.json\./);
  });
});

describe('an estate whose policy passes, with work outstanding', () => {
  let site: string;
  before(() => {
    site = build(
      editedBundle(FIXTURE, (r) => {
        for (const image of r.images) image.verdict = { status: 'verified', reasons: [] };
        r.summary.verdicts = { verified: r.images.length, failed: 0, unverified: 0 };
        for (const id of ['ghcr-io-northcutted-images-platform-tools', 'ghcr-io-northcutted-images-hello-app']) {
          Object.assign(r.images.find((i: any) => i.id === id).base, { drift: 'stale', daysBehind: 3, versionsBehind: 1 });
        }
        r.summary.bases.stale = 2;
        r.summary.bases.current -= 2;
        r.images.find((i: any) => i.id === 'ghcr-io-northcutted-images-amazonlinux-tools').vulnerabilities.scannedAt = '2026-09-30T16:00:00Z';
      }),
    );
  });

  test('says the policy passes and what is still outstanding, never that nothing is', () => {
    const page = shown(read(site, 'index.html'));
    assert.match(page, /✓ Policy passes: all 8 images are verified\. Still outstanding, though the policy doesn't fail them:/);
    assert.match(page, /! 116 high findings \(12 with a fix\)|high findings \(\d+ with a fix\)/);
    assert.match(page, /✕ 25 critical findings \(0 with a fix\)/);
    assert.match(page, /! 2 images on a stale base/);
    assert.match(page, /\? 4 images with no vulnerability data/);
    assert.match(page, /! 1 scan older than 7 days/);
    assert.doesNotMatch(page, /Every image meets every requirement/);
    assert.match(page, /No image falls short of the policy\. What is still outstanding is listed above\./);
    const html = read(site, 'index.html');
    assert.match(html, /<a href="\/lists\/stale-base\/">2 images on a stale base<\/a>/);
    assert.match(html, /<a href="\/lists\/old-scans\/">1 scan older than 7 days<\/a>/);
    assert.match(page, /10 days Oldest scan amazonlinux-tools:latest; 1 scan is over 7 days/);
  });
});

describe('a report at the edges of what the schema allows', () => {
  let site: string;
  before(() => {
    site = build(
      editedBundle(
        FIXTURE,
        (r) => {
          // A SOURCE_DATE_EPOCH past what a date can hold.
          r.images.find((i: any) => i.id === 'ghcr-io-northcutted-images-hello-app').factory.sourceDateEpoch = 1e20;
          // Nothing was rebuilt: no image reproduced.
          for (const image of r.images) {
            if (image.reproducibility.status === 'reproduced') {
              image.reproducibility = { status: 'not-checked', method: 'recipe-rebuild', detail: 'this run did not rebuild it' };
            }
          }
          r.summary.reproducibility = { reproduced: 0, notReproduced: 0, notChecked: 4, noRecipe: 4 };
          r.policy.reproduce = false;
        },
        // A history file that lists no runs.
        (h) => {
          h.entries = [];
        },
      ),
    );
  });

  test('a history with no runs says so on every page that shows history', () => {
    assert.match(shown(read(site, 'history/index.html')), /No runs in the history/);
    assert.match(shown(read(site, 'history/changes/index.html')), /The history lists no runs, so there is nothing to compare/);
    assert.match(shown(read(site, 'images/ghcr-io-northcutted-images-hello-app/index.html')), /The history lists no runs, so there is only this run/);
  });

  test('a SOURCE_DATE_EPOCH no date can hold is shown as the number it is', () => {
    assert.match(shown(read(site, 'images/ghcr-io-northcutted-images-hello-app/index.html')), /files clamped to SOURCE_DATE_EPOCH 100000000000000000000, which is not a date this site can show/);
  });

  test('the Reproduced tile is not green when nothing reproduced', () => {
    const html = read(site, 'index.html');
    const tile = html.match(/class="tile tone-([a-z]+)[^"]*"(?:(?!class="tile ).)*?>Reproduced</s);
    assert.ok(tile, 'a Reproduced tile');
    assert.equal(tile[1], 'unknown');
  });
});

describe('a claimed base with no version identified', () => {
  // clearcutt-verify v0.17: an edge from org.opencontainers.image.base.name or
  // build history names the repository only: no digest, no imageId (or, from
  // a hand-written report, empty ones), drift unknown, 0 days behind.
  let site: string;
  before(() => {
    const claimed = { repository: 'cgr.dev/chainguard/static', ref: 'cgr.dev/chainguard/static', drift: 'unknown', versionsBehind: 0, daysBehind: 0 };
    site = build(
      editedBundle(MINIMAL, (r) => {
        const byId = (id: string) => r.images.find((i: any) => i.id === id);
        byId('ghcr-io-acme-images-billing-1-4-2').base = { ...claimed, method: 'oci-base-name', strength: 'assisted' };
        byId('ghcr-io-acme-images-hello-app').base = { ...claimed, method: 'history', strength: 'weak', digest: '', imageId: '' };
      }),
    );
  });

  test('builds, and says the version is unknown instead of linking a base', () => {
    for (const id of ['ghcr-io-acme-images-billing-1-4-2', 'ghcr-io-acme-images-hello-app']) {
      const html = read(site, `images/${id}/index.html`);
      const base = html.slice(html.indexOf('id="base"'), html.indexOf('id="evidence"'));
      assert.match(shown(base), /Built on cgr\.dev\/chainguard\/static A claimed base, no version identified: the image names this repository, but not which version of it/, id);
      assert.doesNotMatch(base, /href="\/images\/cgr-dev-chainguard-static\/"/, id);
      assert.doesNotMatch(shown(base), /unknown\s*\(its|sha256:/, id);
      assert.match(shown(base), /\? Unknown With no version identified, how far behind it is is unknown\./, id);
    }
    const bases = shown(read(site, 'bases/index.html'));
    assert.match(bases, /billing:1\.4\.2 ○ Assisted \? Unknown on cgr\.dev\/chainguard\/static \(claimed base, no version identified\)/);
    assert.match(bases, /hello-app:latest ○ Weak \? Unknown on cgr\.dev\/chainguard\/static \(claimed base, no version identified\)/);
    // The static image's page lists no image built on it: nothing linked to it.
    assert.doesNotMatch(shown(read(site, 'images/cgr-dev-chainguard-static/index.html')), /Built on this image/);
  });

  test('drift past the limit from a claimed base is unverified, not failed; from a proven one, failed', () => {
    const drifted = build(
      editedBundle(MINIMAL, (r) => {
        r.policy.maxDaysBehind = 30;
        const byId = (id: string) => r.images.find((i: any) => i.id === id);
        Object.assign(byId('ghcr-io-acme-images-billing-1-4-2').base, { strength: 'declared', method: 'oci-base-digest', drift: 'stale', daysBehind: 40, versionsBehind: 2 });
        Object.assign(byId('ghcr-io-acme-images-hello-app').base, { drift: 'stale', daysBehind: 41, versionsBehind: 2 });
      }),
    );
    const overview = shown(read(drifted, 'index.html'));
    assert.match(overview, /The policy fails images more than 30 days behind a base proven by layer digests; behind a base they only claim, they are unverified\./);
    assert.match(overview, /billing:1\.4\.2 \S+ ○ Declared 2 40 \(over the limit by a claim: unverified, not failed\)/);
    assert.match(overview, /hello-app:latest \S+ ✓ Proven 2 41 \(over the limit\)/);
    assert.match(overview, /Base age fail when more than 30 days behind a base proven by layer digests; unverified when that far behind a base the image only claims/);
    assert.match(shown(read(drifted, 'bases/index.html')), /○ Declared 2 40 \(over 30 by a claim: unverified, not failed\)/);
  });
});

describe('the CLI', () => {
  test('refuses a bundle that does not match the contract', () => {
    const bad = editedBundle(MINIMAL, (r) => (r.images[0].verdict.status = 'fine'));
    const run = cli('build', '--bundle', bad, '--out', scratch('portal-site-'));
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
    const cwd = realpathSync(scratch('portal-cwd-'));
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
    const other = scratch('portal-other-');
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
    const bundle = path.join(scratch('portal-around-'), 'bundle');
    cpSync(MINIMAL, bundle, { recursive: true });
    writeFileSync(path.join(bundle, 'policy.yaml'), 'mine');
    writeFileSync(path.join(bundle, 'refs.txt'), 'ghcr.io/acme/images/billing:latest\n');
    const before = snapshot(bundle);
    const link = path.join(scratch('portal-link-'), 'site');
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
    const file = path.join(scratch('portal-file-'), 'site');
    writeFileSync(file, 'mine');
    const run = cli('build', '--bundle', MINIMAL, '--out', file);
    assert.equal(run.status, 2);
    assert.match(run.stderr, /not a directory/);
    assert.equal(readFileSync(file, 'utf8'), 'mine');
  });

  test('an image id that is not a plain page name is a bundle error, not a crash', () => {
    const bad = editedBundle(MINIMAL, (r) => (r.images[3].id = '../../escape'));
    const out = scratch('portal-site-');
    const run = cli('build', '--bundle', bad, '--out', out);
    assert.equal(run.status, 1);
    assert.match(run.stderr, /image id "\.\.\/\.\.\/escape" can't name a page/);
    assert.doesNotMatch(run.stderr, /\n\s+at /, 'no stack trace');
    assert.deepEqual(readdirSync(out), []);
  });

  test('warns about fields beyond the contract, on stderr and as workflow annotations', () => {
    const dir = editedBundle(MINIMAL, (r) => (r.images[0].evidence.signature.newDetail = 'later'));
    const { GITHUB_ACTIONS: _, ...outside } = process.env;
    const plain = spawnSync(process.execPath, [path.join(root, 'bin/clearcutt-portal.ts'), 'check', '--bundle', dir], { cwd: root, encoding: 'utf8', env: outside });
    assert.equal(plain.status, 0);
    assert.match(plain.stderr, /^warning: estate-report\.json has a field this portal's contract doesn't define, so no page shows it: images\[\]\.evidence\.signature\.newDetail\.$/m);
    assert.doesNotMatch(plain.stdout, /::warning/);
    const inActions = spawnSync(process.execPath, [path.join(root, 'bin/clearcutt-portal.ts'), 'check', '--bundle', dir], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, GITHUB_ACTIONS: 'true' },
    });
    assert.match(inActions.stdout, /^::warning title=Report beyond this portal's contract::estate-report\.json has a field/m);
    assert.equal(cli('check', '--bundle', MINIMAL).stderr, '', 'nothing to say about a covered bundle');
  });

  test('the window and scan-age settings must be whole numbers', () => {
    for (const arg of ['--history-runs=many', '--history-runs=-1', '--scan-age-days=0', '--scan-age-days=1.5']) {
      const run = cli('build', '--bundle', MINIMAL, '--out', scratch('portal-site-'), arg);
      assert.equal(run.status, 2, arg);
      const [flag, value] = arg.split('=');
      assert.match(run.stderr, new RegExp(`${flag} ${value.replace('.', '\\.')}: must be a whole number`));
    }
  });

  test('usage errors exit 2', () => {
    assert.equal(cli('build').status, 2);
    assert.equal(cli('frobnicate', '--bundle', MINIMAL).status, 2);
  });
});
