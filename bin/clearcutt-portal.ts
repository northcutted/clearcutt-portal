#!/usr/bin/env node
// clearcutt-portal turns a clearcutt-verify bundle into a static website.
//
//   clearcutt-portal build --bundle DIR [--out DIR] [--site URL] [--base PATH] [--title TEXT]
//                          [--scan-age-days N]
//   clearcutt-portal check --bundle DIR
//
// build validates the bundle against the vendored contract, then renders the
// site into --out (default _site), replacing what is there. --out must be
// empty, missing, or a site an earlier build wrote (it has a SITE_MARKER
// file), and must not overlap the bundle. check only validates. Both exit 1
// when the bundle doesn't match the contract, and 2 on a usage error.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { BUNDLE_ENV, BundleError, readBundle } from '../src/lib/bundle.ts';
import { SCAN_AGE_ENV, TITLE_ENV } from '../src/lib/site-env.ts';

const usage = `usage:
  clearcutt-portal build --bundle DIR [--out DIR] [--site URL] [--base PATH] [--title TEXT]
                         [--scan-age-days N]
  clearcutt-portal check --bundle DIR

  --scan-age-days N   flag vulnerability scans older than N days on the overview
                      (default: the policy's maxScanAgeDays, or 7)`;

function fail(message: string, code: number): never {
  console.error(message);
  process.exit(code);
}

/** Written into every site, so a later build knows it may replace it. */
const SITE_MARKER = '.clearcutt-portal-site';

/** The file a path names (device and inode), following symlinks. */
function fileId(p: string): string | undefined {
  try {
    const s = statSync(p);
    return `${s.dev}:${s.ino}`;
  } catch {
    return undefined;
  }
}

/** p with symlinks resolved, as far as it exists. */
function realPath(p: string): string {
  const rest: string[] = [];
  let head = p;
  while (!existsSync(head) && path.dirname(head) !== head) {
    rest.unshift(path.basename(head));
    head = path.dirname(head);
  }
  try {
    return path.join(realpathSync.native(head), ...rest);
  } catch {
    return p;
  }
}

/**
 * Whether `inner` is `outer` or somewhere inside it. Walks up from where
 * `inner` really is and compares directories rather than names, so neither
 * a symlink nor a differently-cased name on a case-insensitive file system
 * hides an overlap.
 */
function within(inner: string, outer: string): boolean {
  const target = fileId(outer);
  if (target === undefined) return false;
  for (let p = realPath(inner); ; p = path.dirname(p)) {
    if (fileId(p) === target) return true;
    if (path.dirname(p) === p) return false;
  }
}

const [command, ...rest] = process.argv.slice(2);
let values: {
  bundle?: string;
  out?: string;
  site?: string;
  base?: string;
  title?: string;
  'scan-age-days'?: string;
  help?: boolean;
};
try {
  ({ values } = parseArgs({
    args: rest,
    options: {
      bundle: { type: 'string' },
      out: { type: 'string', default: '_site' },
      site: { type: 'string' },
      base: { type: 'string', default: '/' },
      title: { type: 'string' },
      'scan-age-days': { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  }));
} catch (err) {
  fail(`${(err as Error).message}\n${usage}`, 2);
}
if (values.help || command === 'help' || command === '--help' || command === '-h') {
  console.log(usage);
  process.exit(0);
}
if (command !== 'build' && command !== 'check') fail(usage, 2);
if (!values.bundle) fail(`--bundle is required\n${usage}`, 2);

/** A whole number of at least `min` from a flag, or a usage error. */
function count(flag: string, raw: string | undefined, min: number): number | undefined {
  if (raw === undefined) return undefined;
  if (!/^\d+$/.test(raw) || Number(raw) < min) fail(`--${flag} ${raw}: must be a whole number, at least ${min}\n${usage}`, 2);
  return Number(raw);
}
const scanAgeDays = count('scan-age-days', values['scan-age-days'], 1);

const bundleDir = path.resolve(values.bundle);
let images: number;
try {
  const bundle = readBundle(bundleDir);
  images = bundle.report.images.length;
  console.log(
    `${bundleDir}: ${bundle.report.apiVersion} report of ${images} images` +
      (bundle.history ? ` with ${bundle.history.entries.length} history entries` : ', no history'),
  );
} catch (err) {
  if (err instanceof BundleError) fail(err.message, 1);
  throw err;
}
if (command === 'check') process.exit(0);

let site: string | undefined;
if (values.site) {
  try {
    site = new URL(values.site).href;
  } catch {
    fail(`--site ${values.site}: not a URL`, 2);
  }
}
const base = `/${values.base!.replace(/^\/+|\/+$/g, '')}`;
const outDir = path.resolve(values.out!);
const root = fileURLToPath(new URL('..', import.meta.url));
// The site replaces --out, deleting everything in it. It must not overlap
// the bundle (the build reads it, and it holds files that aren't the site's)
// or this portal, and anything already there must be a site a build wrote.
if (within(outDir, bundleDir) || within(bundleDir, outDir)) {
  fail(`--out ${outDir}: overlaps the bundle ${bundleDir}; write the site somewhere else`, 2);
}
if (within(root, outDir)) {
  fail(`--out ${outDir}: contains clearcutt-portal itself; write the site somewhere else`, 2);
}
if (existsSync(outDir)) {
  if (!statSync(outDir).isDirectory()) fail(`--out ${outDir}: not a directory`, 2);
  if (readdirSync(outDir).length > 0 && !existsSync(path.join(outDir, SITE_MARKER))) {
    fail(
      `--out ${outDir}: not empty, and not a site clearcutt-portal built (no ${SITE_MARKER}); ` +
        'the build would delete what is there, so choose an empty or new directory',
      2,
    );
  }
}

process.env[BUNDLE_ENV] = bundleDir;
if (values.title) process.env[TITLE_ENV] = values.title;
if (scanAgeDays !== undefined) process.env[SCAN_AGE_ENV] = String(scanAgeDays);
// Astro's anonymous usage telemetry is on by default; a build in someone
// else's CI shouldn't phone home.
process.env.ASTRO_TELEMETRY_DISABLED = '1';

// Astro stages prerendered chunks next to its output and imports them from
// there, so the output must be inside the portal's directory, where its
// node_modules are; and it decides "inside" by comparing path strings (an
// --out of /x/portal-site counts as inside /x/portal). Build into a staging
// directory that really is inside, from the portal's directory, then move
// the site to --out. Every path the user gave is already absolute.
process.chdir(root);
const staging = mkdtempSync(path.join(root, '.build-'));
try {
  const { build } = await import('astro');
  await build({ root, outDir: staging, site, base, logLevel: 'warn' });
  writeFileSync(
    path.join(staging, SITE_MARKER),
    'Written by clearcutt-portal build. The next build into this directory replaces everything in it.\n',
  );
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(path.dirname(outDir), { recursive: true });
  try {
    renameSync(staging, outDir);
  } catch {
    cpSync(staging, outDir, { recursive: true });
  }
} finally {
  rmSync(staging, { recursive: true, force: true });
}
console.log(`${outDir}: site for ${images} images, served from ${site ? new URL(base, site).href : base}`);
