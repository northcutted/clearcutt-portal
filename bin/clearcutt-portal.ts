#!/usr/bin/env node
// clearcutt-portal turns a clearcutt-verify bundle into a static website.
//
//   clearcutt-portal build --bundle DIR [--out DIR] [--site URL] [--base PATH] [--title TEXT]
//   clearcutt-portal check --bundle DIR
//
// build validates the bundle against the vendored contract, then renders the
// site into --out (default _site). check only validates. Both exit 1 when the
// bundle doesn't match the contract, and 2 on a usage error.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { BUNDLE_ENV, BundleError, readBundle } from '../src/lib/bundle.ts';
import { TITLE_ENV } from '../src/lib/site-env.ts';

const usage = `usage:
  clearcutt-portal build --bundle DIR [--out DIR] [--site URL] [--base PATH] [--title TEXT]
  clearcutt-portal check --bundle DIR`;

function fail(message: string, code: number): never {
  console.error(message);
  process.exit(code);
}

const [command, ...rest] = process.argv.slice(2);
let values: { bundle?: string; out?: string; site?: string; base?: string; title?: string; help?: boolean };
try {
  ({ values } = parseArgs({
    args: rest,
    options: {
      bundle: { type: 'string' },
      out: { type: 'string', default: '_site' },
      site: { type: 'string' },
      base: { type: 'string', default: '/' },
      title: { type: 'string' },
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
// The site replaces --out, so only an empty directory or an earlier site may
// be there.
if (existsSync(outDir) && readdirSync(outDir).length > 0 && !existsSync(path.join(outDir, 'estate-report.json'))) {
  fail(`--out ${outDir}: not empty, and not a site this command built; choose another directory`, 2);
}

process.env[BUNDLE_ENV] = bundleDir;
if (values.title) process.env[TITLE_ENV] = values.title;
// Astro's anonymous usage telemetry is on by default; a build in someone
// else's CI shouldn't phone home.
process.env.ASTRO_TELEMETRY_DISABLED = '1';

// Astro stages prerendered chunks next to its output and imports them from
// there, so the output must be inside the portal's directory, where its
// node_modules are; and it decides "inside" by comparing path strings (an
// --out of /x/portal-site counts as inside /x/portal). Build into a staging
// directory that really is inside, from the portal's directory, then move
// the site to --out. Every path the user gave is already absolute.
const root = fileURLToPath(new URL('..', import.meta.url));
process.chdir(root);
const staging = mkdtempSync(path.join(root, '.build-'));
try {
  const { build } = await import('astro');
  await build({ root, outDir: staging, site, base, logLevel: 'warn' });
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
