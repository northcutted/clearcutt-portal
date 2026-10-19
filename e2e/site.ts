// Builds the site the browser tests run against, then serves it: the
// northcutted-images fixture with everything clearcutt-verify v0.15 can write
// (test/helpers.v015Bundle: stacks, per-image history rows, and more), under
// a base path, as a project site on GitHub Pages is. Playwright starts this
// as its web server (playwright.config.ts).
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { root, scratch, v015Bundle } from '../test/helpers.ts';
import { serve } from './serve.ts';

export const BASE = '/portal/';
const port = process.argv[2] ?? '4329';
const out = scratch('portal-e2e-site-');
const build = spawnSync(process.execPath, [path.join(root, 'bin/clearcutt-portal.ts'), 'build', '--bundle', v015Bundle(), '--out', out, '--base', BASE], {
  cwd: root,
  stdio: 'inherit',
});
if (build.status !== 0) process.exit(build.status ?? 1);
// The server runs until Playwright stops it; the scratch site goes with it
// (test/helpers removes it at exit).
serve(out, Number(port), BASE);
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => process.exit(0));
