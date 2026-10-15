import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {BlogError, fail} from './content.mjs';
import {chain, pageFiles} from './extensions.mjs';

export function json(res, status, value) {
  res.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'});
  res.end(JSON.stringify(value));
}
export function html(res, value) {
  res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'});
  res.end(value);
}
export async function readJSON(req) {
  if (req.headers['content-type']?.split(';')[0] !== 'application/json') fail('CONTENT_TYPE', 'Send application/json.', 415);
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > 2 * 1024 * 1024) fail('BODY_TOO_LARGE', 'Request exceeds 2 MiB.', 413); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { fail('INVALID_JSON', 'Invalid JSON body.'); }
}
const mime = {'.html': 'text/html; charset=utf-8', '.json': 'application/json; charset=utf-8', '.xml': 'application/xml; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg'};
export function serveAsset(res, directory, relative) {
  if (relative.split('/').some(part => part.startsWith('.') || part.includes('\\'))) fail('NOT_FOUND', 'Asset not found.', 404);
  const target = path.resolve(directory, relative);
  if (!target.startsWith(directory + path.sep) || !fs.existsSync(target)) fail('NOT_FOUND', 'Asset not found.', 404);
  const real = fs.realpathSync(target);
  if (!real.startsWith(directory + path.sep) || !fs.statSync(real).isFile()) fail('NOT_FOUND', 'Asset not found.', 404);
  res.writeHead(200, {'Content-Type': mime[path.extname(real)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache'});
  fs.createReadStream(real).on('error', () => res.destroy()).pipe(res);
}
export async function serve(blog, {port = 4173} = {}) {
  const server = http.createServer(async (req, res) => {
    try {
      const host = req.headers.host || '';
      const origin = `http://${host}`;
      const hostURL = new URL(origin);
      if (!['127.0.0.1', 'localhost', '[::1]'].includes(hostURL.hostname)) fail('HOST_REJECTED', 'Use a loopback host.', 403);
      if (req.headers.origin && req.headers.origin !== origin) fail('ORIGIN_REJECTED', 'Cross-origin requests are not allowed.', 403);
      const url = new URL(req.url, origin);
      const pathname = decodeURIComponent(url.pathname);
      const context = {req, res, url, pathname, blog, json, html, readJSON};
      return await chain(blog.middleware, context, async () => {
        const route = blog.routes.find(route => pathname === route.prefix || pathname.startsWith(route.prefix + '/'));
        if (route) return await route.handler(context);
        if (req.method !== 'GET' && req.method !== 'HEAD') fail('METHOD_NOT_ALLOWED', 'Read-only route.', 405);
        const asset = blog.assets.find(asset => pathname.startsWith(asset.prefix + '/'));
        if (asset) {
          const relative = pathname.slice(asset.prefix.length + 1);
          if (asset.include && !asset.include.some(file => relative === file || relative.startsWith(file + '/'))) fail('NOT_FOUND', 'Asset not found.', 404);
          return serveAsset(res, asset.directory, relative);
        }
        const output = pathname.endsWith('/') ? pathname.slice(1) + 'index.html' : pathname.slice(1);
        if (blog.outputs.has(output)) {
          const body = await blog.renderOutput(output);
          res.writeHead(200, {'Content-Type': mime[path.extname(output)] || 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'});
          return res.end(body);
        }
        if (pathname === '/') return html(res, await blog.page());
        const published = blog.posts.list().filter(post => !post.metadata.draft);
        const relative = pathname.endsWith('/') ? pathname.slice(1) + 'index.html' : '';
        const post = pageFiles(blog, published).get(relative);
        if (post) return html(res, await blog.page(post, published));
        fail('NOT_FOUND', 'Page not found.', 404);
      });
    } catch (error) {
      if (res.headersSent) return res.destroy();
      json(res, error instanceof BlogError ? error.status : 500, {ok: false, error: {code: error.code || 'INTERNAL', message: error.message}});
    } finally {
      const warnings = await blog.flushEvents();
      if (warnings.length) console.error(JSON.stringify({warnings}));
    }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return server;
}
