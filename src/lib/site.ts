// Site-wide settings for components: links under the configured base path,
// the title, and what generated the site.
import pkg from '../../package.json' with { type: 'json' };
import { loadBundle } from './bundle.ts';
import { TITLE_ENV, VERSION_ENV } from './site-env.ts';

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
