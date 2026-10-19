// A synthetic estate of 500 images with 1,000 runs of history
// (scripts/gen-fixture.ts), built within a time budget, into a site whose
// size doesn't grow with the history. It takes a while, so it runs only when
// asked: CLEARCUTT_PORTAL_SCALE=1 node --test test/scale.test.ts (CI's
// "scale" job). CLEARCUTT_PORTAL_SCALE_BUDGET_S overrides the budget.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { DEFAULT_HISTORY_RUNS } from '../src/lib/site.ts';
import { root, scratch } from './helpers.ts';

const IMAGES = 500;
const RUNS = 1000;
// About 8 s on an Apple M-series laptop and 15 s on a GitHub-hosted runner;
// the budget is three times that, room for a slow runner without hiding a
// return to the quadratic build (110 s on the laptop before the history was
// windowed and indexed).
const BUDGET_S = Number(process.env.CLEARCUTT_PORTAL_SCALE_BUDGET_S ?? 45);

const run = (...args: string[]) => spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', maxBuffer: 64 << 20 });

function files(dir: string): { file: string; size: number }[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .map((f) => path.join(dir, f))
    .filter((f) => statSync(f).isFile())
    .map((file) => ({ file, size: statSync(file).size }));
}

test(`a ${IMAGES}-image estate with ${RUNS} runs builds within ${BUDGET_S} s`, { skip: process.env.CLEARCUTT_PORTAL_SCALE !== '1' && 'set CLEARCUTT_PORTAL_SCALE=1 to run' }, () => {
  const bundle = scratch('portal-scale-bundle-');
  const gen = run('scripts/gen-fixture.ts', '--out', bundle, '--images', String(IMAGES), '--runs', String(RUNS));
  assert.equal(gen.status, 0, gen.stderr);

  const out = scratch('portal-scale-site-');
  const started = performance.now();
  const build = run('bin/clearcutt-portal.ts', 'build', '--bundle', bundle, '--out', out);
  const seconds = (performance.now() - started) / 1000;
  console.log(`built ${IMAGES} images and ${RUNS} runs in ${seconds.toFixed(1)} s (budget ${BUDGET_S} s)`);
  assert.equal(build.status, 0, `${build.stdout}\n${build.stderr}`);
  assert.ok(seconds < BUDGET_S, `the build took ${seconds.toFixed(1)} s, over the ${BUDGET_S} s budget`);

  // The site grows with the estate, not with the history: comparisons only
  // among the latest runs, each image's history only as far back.
  const comparisons = readdirSync(path.join(out, 'history/changes'), { withFileTypes: true }).filter((d) => d.isDirectory());
  assert.equal(comparisons.length, 2 * (DEFAULT_HISTORY_RUNS - 1), 'each windowed run with the one before, and since each');
  const history = readFileSync(path.join(out, 'history/index.html'), 'utf8');
  assert.match(history, new RegExp(`${RUNS} runs recorded; this site shows the latest ${DEFAULT_HISTORY_RUNS}`));
  const all = files(out);
  const pages = all.filter((f) => f.file.endsWith('.html'));
  const biggest = pages.reduce((a, b) => (b.size > a.size ? b : a));
  console.log(`${pages.length} pages, the largest ${path.relative(out, biggest.file)} at ${(biggest.size / 1e6).toFixed(1)} MB`);
  assert.ok(biggest.size < 8e6, `${biggest.file} is ${biggest.size} bytes`);
  // Everything but the bundle's own files, which the site serves as they are.
  const site = all.filter((f) => !f.file.endsWith('estate-history.json') && !f.file.endsWith('estate-report.json')).reduce((n, f) => n + f.size, 0);
  console.log(`site ${(site / 1e6).toFixed(0)} MB besides the bundle`);
  assert.ok(site < 400e6, `the site is ${site} bytes besides the bundle; GitHub Pages takes 1 GB`);
});
