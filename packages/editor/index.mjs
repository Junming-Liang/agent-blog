import manifest from './plugin.json' with {type: 'json'};
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import runtime from './browser-runtime.json' with {type: 'json'};

/** @type {import('@agent-blog/core').Plugin} */
export default {
  ...manifest,
  description: 'Local writing workspace with a shared extension runtime and live preview.',
  setup(api) {
    const extensions = new Map();
    api.provide('editor', {
      register(extension) {
        if (!extension || !/^[a-z][a-z0-9-]*$/.test(extension.name) || extensions.has(extension.name) || (!extension.module && !extension.stylesheet)) api.fail('INVALID_EDITOR_EXTENSION', 'Use a unique extension name with a module or stylesheet.');
        for (const url of [extension.module, extension.stylesheet].filter(Boolean)) if (typeof url !== 'string' || !/^\/_assets\/[a-z0-9-]+\/[a-zA-Z0-9_./-]+$/.test(url) || url.split('/').some(part => part === '..')) api.fail('INVALID_EDITOR_EXTENSION', 'Editor assets must use local /_assets/ URLs.');
        JSON.stringify(extension.options || {});
        extensions.set(extension.name, {...extension});
      }
    });
    const directory = fileURLToPath(new URL('./public', import.meta.url));
    api.asset('/_assets/editor', directory, {public: false});
    api.route('/__editor', async ({req, res, pathname, blog, json, html, readJSON}) => {
      if (pathname === '/__editor' || pathname === '/__editor/') {
        if (req.method !== 'GET') return api.fail('METHOD_NOT_ALLOWED', 'Use GET.', 405);
        const imports = Object.fromEntries(Object.entries(runtime.modules).map(([specifier, file]) => [specifier, `/_assets/editor/bundle/runtime/${file}.js`]));
        const source = fs.readFileSync(new URL('./public/index.html', import.meta.url), 'utf8');
        return html(res, source.replace('<head>', `<head><script type="importmap">${JSON.stringify({imports})}</script>`));
      }
      if (pathname === '/__editor/api/extensions' && req.method === 'GET') return json(res, 200, {ok: true, data: [...extensions.values()]});
      const command = /^\/__editor\/api\/commands\/([a-z][a-z0-9-]*)$/.exec(pathname);
      if (command && req.method === 'POST') {
        const data = await blog.execute(command[1], await readJSON(req));
        const warnings = await blog.flushEvents();
        return json(res, 200, {ok: true, data, ...(warnings.length ? {warnings} : {})});
      }
      if (pathname === '/__editor/api/posts' && req.method === 'GET') return json(res, 200, {ok: true, data: api.posts.list().map(({body, ...post}) => post), site: {title: api.site.title, root: api.site.root}, plugins: blog.plugins});
      if (pathname === '/__editor/api/preview' && req.method === 'POST') {
        const input = await readJSON(req);
        api.posts.validate(input);
        return json(res, 200, {ok: true, data: await blog.page({slug: 'preview', metadata: input.metadata, body: input.body, revision: ''})});
      }
      const match = /^\/__editor\/api\/posts\/([^/]+)$/.exec(pathname);
      if (!match) return api.fail('NOT_FOUND', 'Editor route not found.', 404);
      const slug = match[1];
      if (req.method === 'GET') return json(res, 200, {ok: true, data: api.posts.read(slug)});
      if (req.method === 'PUT') {
        const input = await readJSON(req);
        const data = api.posts.write(slug, {metadata: input.metadata, body: input.body}, input.revision);
        const warnings = await blog.flushEvents();
        return json(res, 200, {ok: true, data, ...(warnings.length ? {warnings} : {})});
      }
      return api.fail('METHOD_NOT_ALLOWED', 'Use GET or PUT.', 405);
    });
  }
};
