// The site is static: every page is rendered from the bundle at build time,
// and nothing in the browser talks to a registry. bin/clearcutt-portal.ts
// passes the deployed URL and base path.
import { defineConfig } from 'astro/config';

export default defineConfig({
  output: 'static',
  trailingSlash: 'ignore',
  build: { format: 'directory', assets: '_assets' },
  devToolbar: { enabled: false },
});
