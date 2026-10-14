// The site is static: every page is rendered from the bundle at build time,
// and nothing in the browser talks to a registry. bin/clearcutt-portal.ts
// passes the deployed URL and base path.
import { defineConfig } from 'astro/config';

export default defineConfig({
  output: 'static',
  trailingSlash: 'ignore',
  build: { format: 'directory', assets: '_assets' },
  devToolbar: { enabled: false },
  // No page is Markdown, and Shiki's inline styles would need a CSP exception.
  markdown: { syntaxHighlight: false },
  // A Content-Security-Policy <meta> on every page. Astro adds script-src and
  // style-src with the hash of each inline script and style it emits; every
  // other script or stylesheet is a file of this site. The rest is denied:
  // the site loads nothing from another origin, submits nothing, and runs no
  // script a report could smuggle in.
  security: {
    csp: {
      directives: ["default-src 'none'", "img-src 'self'", "base-uri 'none'", "form-action 'none'"],
    },
  },
});
