// Site-wide settings for components: links under the configured base path,
// the title, and what generated the site.
import pkg from '../../package.json' with { type: 'json' };
import { loadBundle } from './bundle.ts';
import { buildSearchIndex, type SearchIndex } from './package-search.ts';
import { scanAgeLimit } from './overview.ts';
import { SCAN_AGE_ENV, TITLE_ENV, VERSION_ENV } from './site-env.ts';

/** A link to a page of this site, under the base path it is deployed at. */
export function href(path: string): string {
  const base = import.meta.env.BASE_URL.replace(/\/+$/, '');
  return `${base}/${path.replace(/^\/+/, '')}`;
}

/**
 * The page of the image with this ID. readBundle only accepts IDs that are a
 * single plain path segment (IMAGE_ID); encoding them as well keeps a link
 * from ever leaving images/.
 */
export function imageHref(id: string): string {
  return href(`images/${encodeURIComponent(id)}/`);
}

/** The page of the package group with this slug. */
export function packageHref(slug: string): string {
  return href(`packages/${encodeURIComponent(slug)}/`);
}

export function siteTitle(): string {
  return process.env[TITLE_ENV] || loadBundle().report.metadata.name;
}

/** This portal's version: the release it was built from, or "source". */
export function portalVersion(): string {
  return process.env[VERSION_ENV] || (pkg.version === '0.0.0' ? 'source' : `v${pkg.version}`);
}

/** A whole number from the environment, or undefined when it isn't set. */
export function envCount(name: string): number | undefined {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) throw new Error(`${name}=${raw}: not a whole number`);
  return n;
}

/**
 * Days after which a vulnerability scan is flagged as old: --scan-age-days,
 * else the policy's maxScanAgeDays, else 7 (overview.scanAgeLimit).
 */
export function scanAgeDays(): number {
  return scanAgeLimit(loadBundle().report, envCount(SCAN_AGE_ENV));
}

let index: SearchIndex | null = null;
let indexed: Map<string, SearchIndex['packages'][number]> | null = null;

/** The package search's index, as packages/search-index.json serves it. */
export function searchIndex(): SearchIndex {
  index ??= buildSearchIndex(loadBundle().report, { image: imageHref, package: packageHref });
  return index;
}

/** The index's entry for the package group with this slug. */
export function indexedPackage(slug: string): SearchIndex['packages'][number] | undefined {
  indexed ??= new Map(searchIndex().packages.map((p) => [p.href, p]));
  return indexed.get(packageHref(slug));
}
