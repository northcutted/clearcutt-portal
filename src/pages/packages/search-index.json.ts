// The package search's index: every package version, the images that ship
// it, and each image's base, for the search on the packages page to filter
// in the browser.
import type { APIRoute } from 'astro';
import { searchIndex } from '../../lib/site.ts';

export const GET: APIRoute = () =>
  new Response(JSON.stringify(searchIndex()), { headers: { 'Content-Type': 'application/json' } });
