// The bundle's files, served as they were read, so anyone can check the site
// against the data it was built from.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { APIRoute, GetStaticPaths } from 'astro';
import { HISTORY_FILE, REPORT_FILE, loadBundle } from '../lib/bundle.ts';

export const getStaticPaths = (() => {
  const { history } = loadBundle();
  const files = history ? [REPORT_FILE, HISTORY_FILE] : [REPORT_FILE];
  return files.map((file) => ({ params: { file: file.replace(/\.json$/, '') }, props: { file } }));
}) satisfies GetStaticPaths;

export const GET: APIRoute = ({ props }) => {
  const body = readFileSync(path.join(loadBundle().dir, props.file as string));
  return new Response(body, { headers: { 'Content-Type': 'application/json' } });
};
