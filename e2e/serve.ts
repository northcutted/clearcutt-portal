// Serves a built site over HTTP for the browser tests, the way a static host
// would: files as they are, directory URLs to their index.html, and the
// site's 404.html for anything else. Only for tests; it serves nothing
// outside the directory it is given.
//
//   node e2e/serve.ts DIR [PORT] [BASE]
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
};

export function serve(dir: string, port: number, base = '/'): Server {
  const root = path.resolve(dir);
  const prefix = `/${base.replace(/^\/+|\/+$/g, '')}/`.replace(/^\/\/$/, '/');
  const resolve = (url: string): string | undefined => {
    const pathname = decodeURIComponent(new URL(url, 'http://x').pathname);
    if (!pathname.startsWith(prefix)) return undefined;
    const file = path.join(root, pathname.slice(prefix.length));
    if (file !== root && !file.startsWith(root + path.sep)) return undefined;
    if (existsSync(file) && statSync(file).isDirectory()) {
      const index = path.join(file, 'index.html');
      return existsSync(index) ? index : undefined;
    }
    return existsSync(file) ? file : undefined;
  };
  return createServer((req, res) => {
    const file = resolve(req.url ?? '/');
    const send = file ?? path.join(root, '404.html');
    res.writeHead(file ? 200 : 404, { 'Content-Type': TYPES[path.extname(send)] ?? 'application/octet-stream' });
    createReadStream(send).pipe(res);
  }).listen(port, '127.0.0.1', () => console.log(`serving ${root} at http://127.0.0.1:${port}${prefix}`));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [dir, port = '4321', base = '/'] = process.argv.slice(2);
  if (!dir) {
    console.error('usage: node e2e/serve.ts DIR [PORT] [BASE]');
    process.exit(2);
  }
  serve(dir, Number(port), base);
}
