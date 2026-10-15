import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {contentStore, jsonMarkdown, escapeHTML, fail} from './content.mjs';
import {notifications, validateInvocation, chain, pagePath, pageFiles} from './extensions.mjs';
import {views} from './views.mjs';
export {BlogError, escapeHTML} from './content.mjs';
export {serve} from './server.mjs';

const corePublic = fileURLToPath(new URL('./public', import.meta.url));
const requireFromCore = createRequire(import.meta.url);
const assetCheck = prefix => {
  if (!/^\/_assets\/[a-z0-9-]+(?:\/[a-z0-9-]+)*$/.test(prefix)) fail('INVALID_ASSET', 'Asset prefixes must be beneath /_assets/.');
};
export function readSiteConfig(directory) {
  const root = fs.realpathSync(path.resolve(directory));
  const configFile = path.join(root, 'blog.json');
  if (!fs.lstatSync(configFile).isFile()) fail('INVALID_CONFIG', 'blog.json must be a regular file.');
  const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  if (config.version !== 1 || typeof config.title !== 'string' || !Array.isArray(config.plugins)) fail('INVALID_CONFIG', 'Expected version 1, a title and a plugins array.');
  return {root, config};
}
export async function loadSite(directory, {config: override} = {}) {
  const {root, config: stored} = readSiteConfig(directory);
  const config = override || stored;
  const configFile = path.join(root, 'blog.json');
  const site = Object.freeze({...config, root});
  const events = notifications(), validators = [], middleware = [], commandMiddleware = [], components = new Map(), defaults = new Map(), slots = new Map(), indexFilters = [];
  let store, codec = jsonMarkdown, storage, builder, link = post => `/posts/${encodeURIComponent(post.slug)}/`;
  const replaced = new Set();
  const replace = (name, value) => { if (replaced.has(name)) fail('DUPLICATE_ADAPTER', `Only one ${name} adapter can be enabled.`); replaced.add(name); return value; };
  const posts = Object.freeze(Object.fromEntries(['read', 'list', 'write', 'remove', 'validate'].map(name => [name, (...args) => {
    store ||= contentStore(root, {codec, ...(storage ? {storage} : {}), validators, emit: events.emit});
    return store[name](...args);
  }])));
  const services = new Map(), serviceOwners = new Map(), commands = new Map(), outputs = new Map(), routes = [], transforms = [], assets = [{prefix: '/_assets/core', directory: corePublic, public: true}], styles = ['/_assets/core/site.css'], plugins = [];
  let renderer = body => `<pre class="plain-text">${escapeHTML(body)}</pre>`, layout = context => context.render('shell'), hasRenderer = false, hasLayout = false;
  const api = Object.freeze({
    apiVersion: 1, site, posts, escapeHTML, fail,
    storage(adapter) {
      if (store) fail('ADAPTER_AFTER_CONTENT', 'Register storage before accessing posts; declare plugin dependencies.');
      if (!adapter || ['read', 'list', 'write', 'remove'].some(name => typeof adapter[name] !== 'function')) fail('INVALID_STORAGE', 'Storage needs read, list, write and remove.');
      storage = replace('storage', adapter);
    },
    codec(adapter) {
      if (store) fail('ADAPTER_AFTER_CONTENT', 'Register the codec before accessing posts; declare plugin dependencies.');
      if (!adapter || !/^\.[a-z0-9]+$/.test(adapter.extension) || typeof adapter.decode !== 'function' || typeof adapter.encode !== 'function') fail('INVALID_CODEC', 'Codec needs extension, decode and encode.');
      codec = replace('codec', adapter);
    },
    validator(fn) { if (typeof fn !== 'function') fail('INVALID_PLUGIN', 'validator needs a synchronous function.'); validators.push(fn); },
    component(name, fn, {fallback = false} = {}) {
      const target = fallback ? defaults : components;
      if (!/^[a-z][a-z0-9:-]*$/.test(name) || typeof fn !== 'function' || target.has(name)) fail('INVALID_COMPONENT', `Register a unique component name and render function: ${name}.`);
      target.set(name, fn);
    },
    slot(name, fn) {
      if (!/^[a-z][a-z0-9:-]*$/.test(name) || typeof fn !== 'function') fail('INVALID_SLOT', 'slot needs a name and render function.');
      if (!slots.has(name)) slots.set(name, []);
      slots.get(name).push(fn);
    },
    indexFilter(fn) { if (typeof fn !== 'function') fail('INVALID_PLUGIN', 'indexFilter needs a synchronous predicate.'); indexFilters.push(fn); },
    permalink(fn) { if (typeof fn !== 'function') fail('INVALID_PERMALINK', 'permalink needs a function.'); link = replace('permalink', fn); },
    builder(fn) { if (typeof fn !== 'function') fail('INVALID_PLUGIN', 'builder needs a function.'); builder = replace('builder', fn); },
    middleware(fn) { if (typeof fn !== 'function') fail('INVALID_PLUGIN', 'middleware needs a function.'); middleware.push(fn); },
    commandMiddleware(fn) { if (typeof fn !== 'function') fail('INVALID_PLUGIN', 'commandMiddleware needs a function.'); commandMiddleware.push(fn); },
    on: events.on,
    execute: (name, invocation) => execute(name, invocation),
    provide(name, value) { if (services.has(name)) fail('DUPLICATE_SERVICE', name); services.set(name, value); },
    require(name) { if (!services.has(name)) fail('MISSING_SERVICE', `Enable the plugin providing ${name} and declare it in requires.`); return services.get(name); },
    renderer(fn) { if (typeof fn !== 'function') fail('INVALID_PLUGIN', 'renderer needs a function.'); if (hasRenderer) fail('DUPLICATE_RENDERER', 'Only one content renderer can be enabled.'); hasRenderer = true; renderer = fn; },
    transform(fn) { if (typeof fn !== 'function') fail('INVALID_PLUGIN', 'transform needs a function.'); transforms.push(fn); },
    layout(fn, {unstyled = false} = {}) { if (typeof fn !== 'function') fail('INVALID_PLUGIN', 'layout needs a function.'); if (hasLayout) fail('DUPLICATE_LAYOUT', 'Only one layout override can be enabled.'); hasLayout = true; layout = fn; if (unstyled) { assets.splice(0, 1); styles.splice(styles.indexOf('/_assets/core/site.css'), 1); } },
    command(definition) {
      if (!definition || typeof definition !== 'object') fail('INVALID_COMMAND', 'Pass a command definition object.');
      const {name, description, run} = definition;
      if (!/^[a-z][a-z0-9-]*$/.test(name) || ['init', 'list', 'get', 'new', 'put', 'publish', 'remove', 'build', 'serve', 'schema', 'plugins', 'plugin'].includes(name) || commands.has(name)) fail('INVALID_COMMAND', name);
      if (typeof description !== 'string' || typeof run !== 'function') fail('INVALID_COMMAND', 'Commands need a description and run function.');
      if (definition.arguments && (!Array.isArray(definition.arguments) || definition.arguments.some(arg => typeof arg !== 'string' || !arg))) fail('INVALID_COMMAND', 'arguments must be nonempty parameter names.');
      for (const [key, flag] of Object.entries(definition.flags || {})) {
        if (!/^[a-z][a-z0-9-]*$/.test(key) || ['site', 'json', 'stdin', 'help'].includes(key) || !['string', 'boolean', 'number'].includes(flag.type)) fail('INVALID_COMMAND', `Invalid flag: ${key}`);
        if (flag.enum && !Array.isArray(flag.enum)) fail('INVALID_COMMAND', `Flag enum must be an array: ${key}`);
      }
      if (definition.stdin && !['text', 'json'].includes(definition.stdin)) fail('INVALID_COMMAND', 'stdin must be text or json.');
      commands.set(name, {...definition});
    },
    route(prefix, handler) {
      if (typeof handler !== 'function') fail('INVALID_ROUTE', 'route needs a handler function.');
      const normalized = prefix.replace(/\/$/, '');
      if (!/^\/[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*\/?$/.test(prefix) || prefix.startsWith('/_assets') || routes.some(route => route.prefix === normalized || route.prefix.startsWith(normalized + '/') || normalized.startsWith(route.prefix + '/'))) fail('INVALID_ROUTE', `Overlapping or invalid route: ${prefix}`);
      if ([...outputs.keys()].some(name => ('/' + name).startsWith(normalized + '/') || '/' + name === normalized)) fail('OUTPUT_COLLISION', `Route overlaps a static output: ${prefix}`);
      routes.push({prefix: normalized, handler});
    },
    output(relative, render) {
      if (typeof relative !== 'string' || !relative || relative.split('/').some(part => !part || part.startsWith('.') || part.includes('\\')) || path.isAbsolute(relative) || ['index.html', 'posts', '_assets'].includes(relative) || relative.startsWith('posts/') || relative.startsWith('_assets/') || [...outputs.keys()].some(name => name === relative || name.startsWith(relative + '/') || relative.startsWith(name + '/'))) fail('INVALID_OUTPUT', 'Use a unique relative output path outside the core page and asset paths.');
      if (typeof render !== 'function' && typeof render !== 'string') fail('INVALID_OUTPUT', 'Output needs a string or render function.');
      if (routes.some(route => ('/' + relative).startsWith(route.prefix + '/') || '/' + relative === route.prefix)) fail('OUTPUT_COLLISION', `Static output overlaps a route: ${relative}`);
      outputs.set(relative, typeof render === 'string' ? () => render : render);
    },
    asset(prefix, directory, {public: published = true, include} = {}) {
      assetCheck(prefix);
      if (assets.some(asset => asset.prefix === prefix || asset.prefix.startsWith(prefix + '/') || prefix.startsWith(asset.prefix + '/'))) fail('DUPLICATE_ASSET', prefix);
      const resolved = fs.realpathSync(directory);
      if (!fs.statSync(resolved).isDirectory()) fail('INVALID_ASSET', 'Asset source must be a directory.');
      if (include && (!Array.isArray(include) || include.some(file => typeof file !== 'string' || !file || file.split('/').some(part => part.startsWith('.') || part.includes('\\'))))) fail('INVALID_ASSET', 'include must contain safe relative files or directories.');
      assets.push({prefix, directory: resolved, public: published, include});
    },
    stylesheet(url) { if (!url.startsWith('/_assets/')) fail('INVALID_STYLESHEET', url); styles.push(url); }
  });
  const requireFromSite = createRequire(configFile);
  const modules = new Map();
  for (const entry of config.plugins) {
    if (!entry || !['string', 'object'].includes(typeof entry)) fail('INVALID_PLUGIN', 'Invalid plugin entry.');
    if (typeof entry === 'object' && ((entry.enabled !== undefined && typeof entry.enabled !== 'boolean') || (entry.options !== undefined && (!entry.options || typeof entry.options !== 'object' || Array.isArray(entry.options))))) fail('INVALID_PLUGIN', 'enabled must be boolean and options must be an object.');
    if (typeof entry === 'object' && entry.enabled === false) continue;
    const specifier = typeof entry === 'string' ? entry : entry.use;
    if (typeof specifier !== 'string' || !specifier) fail('INVALID_PLUGIN', 'A plugin needs a module path or package name.');
    let resolved;
    if (specifier.startsWith('.') || path.isAbsolute(specifier)) resolved = path.resolve(root, specifier);
    else {
      try { resolved = requireFromSite.resolve(specifier); }
      catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; resolved = requireFromCore.resolve(specifier); }
    }
    const plugin = (await import(pathToFileURL(resolved).href)).default;
    if (!plugin || !/^[a-z][a-z0-9-]*$/.test(plugin.name || '') || typeof plugin.setup !== 'function' || modules.has(plugin.name)) fail('INVALID_PLUGIN', specifier);
    if (plugin.apiVersion !== 1) fail('PLUGIN_API_VERSION', `${plugin.name}: this core supports plugin API version 1.`);
    for (const field of ['requires', 'optionalRequires', 'extends']) {
      if (plugin[field] && (!Array.isArray(plugin[field]) || plugin[field].some(name => typeof name !== 'string' || !/^[a-z][a-z0-9-]*$/.test(name)) || new Set(plugin[field]).size !== plugin[field].length)) fail('INVALID_PLUGIN', `${field} must contain unique plugin names.`);
    }
    const relationships = [...(plugin.requires || []), ...(plugin.optionalRequires || []), ...(plugin.extends || [])];
    if (new Set(relationships).size !== relationships.length) fail('INVALID_PLUGIN', `${plugin.name}: a dependency must have only one relationship.`);
    modules.set(plugin.name, {plugin, specifier, options: typeof entry === 'object' ? entry.options || {} : {}});
  }
  const visiting = new Set(), ready = new Set();
  async function setup(name) {
    if (ready.has(name)) return;
    if (visiting.has(name)) fail('PLUGIN_CYCLE', `Cyclic plugin dependency: ${name}`);
    if (!modules.has(name)) fail('MISSING_PLUGIN', `Enable the required plugin: ${name}`);
    visiting.add(name);
    const {plugin, specifier, options} = modules.get(name);
    for (const dependency of [...(plugin.requires || []), ...(plugin.extends || [])]) await setup(dependency);
    for (const dependency of plugin.optionalRequires || []) if (modules.has(dependency)) await setup(dependency);
    const service = (key, optional) => {
      const owner = serviceOwners.get(key);
      if (!owner) {
        if (optional) return undefined;
        fail('MISSING_SERVICE', `${name}: enable the plugin providing ${key} and declare its dependency.`);
      }
      if (owner !== name && !(plugin.requires || []).includes(owner) && !(plugin.optionalRequires || []).includes(owner) && !(plugin.extends || []).includes(owner)) fail('UNDECLARED_DEPENDENCY', `${name}: declare ${owner} before using its ${key} service.`);
      return services.get(key);
    };
    await plugin.setup(Object.freeze({...api,
      provide(key, value) { api.provide(key, value); serviceOwners.set(key, name); },
      require: key => service(key, false),
      optional: key => service(key, true)
    }), options);
    plugins.push({name, apiVersion: plugin.apiVersion, description: plugin.description || '', requires: plugin.requires || [], optionalRequires: plugin.optionalRequires || [], extends: plugin.extends || [], use: specifier, ...(plugin.optionsSchema ? {optionsSchema: plugin.optionsSchema} : {})});
    visiting.delete(name); ready.add(name);
  }
  for (const name of modules.keys()) await setup(name);
  function checkHTML(value) {
    if (typeof value !== 'string') fail('INVALID_RENDER_OUTPUT', 'Rendering hooks must return HTML strings.');
    return value;
  }
  async function renderPost(post) {
    let html = checkHTML(await renderer(post.body, {post: structuredClone(post), site}));
    for (const transform of transforms) html = checkHTML(await transform({html, post: structuredClone(post), site, permalink}));
    return html;
  }
  function permalink(post) {
    const url = link(post), relative = pagePath(url), pathname = '/' + relative.slice(0, -'index.html'.length);
    if (routes.some(route => pathname === route.prefix + '/' || pathname.startsWith(route.prefix + '/'))) fail('OUTPUT_COLLISION', `Article URL overlaps a plugin route: ${url}`);
    return url;
  }
  function pageContext(context) {
    return {...context, renderPost, permalink: post => context.outputSlug === post.slug ? context.url : permalink(post),
      render: (name, overrides = {}) => renderComponent(name, {...context, ...overrides}),
      renderDefault: (name, overrides = {}) => renderComponent(name, {...context, ...overrides}, true),
      slot: async name => (await Promise.all((slots.get(name) || []).map(fn => fn(pageContext({...context, posts: structuredClone(context.posts), post: context.post ? structuredClone(context.post) : undefined}))))).map(checkHTML).join('')
    };
  }
  async function renderComponent(name, context, builtin = false) {
    const render = (builtin ? undefined : components.get(name)) || defaults.get(name) || views[name];
    if (!render) fail('MISSING_COMPONENT', `No component registered: ${name}`);
    return checkHTML(await render(pageContext(context)));
  }
  async function page(post, published = posts.list().filter(p => !p.metadata.draft)) {
    const context = {site, post, html: '', posts: published, styles: [...styles], url: post ? permalink(post) : '/'};
    context.html = post ? await renderPost(post) : await renderComponent('list', {...context, posts: published.filter(post => indexFilters.every(filter => {
      const included = filter(structuredClone(post));
      if (typeof included !== 'boolean') fail('INVALID_INDEX_FILTER', 'indexFilter must synchronously return a boolean.');
      return included;
    }))});
    return checkHTML(await layout(pageContext(context)));
  }
  async function invoke(definition, invocation) {
    const context = {name: definition.name, ...validateInvocation(definition, invocation), site};
    const result = await chain(commandMiddleware, context, () => definition.run(context));
    events.emit('command:completed', {name: definition.name, args: context.args});
    return result;
  }
  async function execute(name, invocation) {
    if (!commands.has(name)) fail('UNKNOWN_COMMAND', `Unknown plugin command: ${name}`);
    return invoke(commands.get(name), invocation);
  }
  async function renderOutput(name, published = posts.list().filter(post => !post.metadata.draft)) {
    const context = {site, posts: published, html: '', styles: [...styles], url: '/' + name.replace(/index\.html$/, '')};
    const value = await outputs.get(name)({...pageContext(context), renderPage: async ({title, html}) => {
      if (typeof title !== 'string' || typeof html !== 'string') fail('INVALID_OUTPUT', 'renderPage needs a title and HTML string.');
      const post = {slug: name, metadata: {title, draft: false}, body: '', revision: ''};
      return checkHTML(await layout(pageContext({...context, post, html, outputSlug: name})));
    }});
    if (typeof value !== 'string') fail('INVALID_OUTPUT', 'Output renderers must return strings.');
    return value;
  }
  return {site, posts, plugins, commands, routes, outputs, assets, middleware, builder, renderPost, renderOutput, page, permalink, invoke, execute, flushEvents: events.flush, notify: events.emit};
}
export async function build(blog) {
  const result = blog.builder ? await blog.builder({blog, build: () => staticBuild(blog)}) : await staticBuild(blog);
  if (!result || typeof result.output !== 'string' || !Number.isInteger(result.posts) || result.posts < 0 || !Array.isArray(result.plugins)) fail('INVALID_BUILD', 'Builders must return {output, posts, plugins}.');
  blog.notify('build:completed', {result});
  const warnings = await blog.flushEvents();
  return {...result, ...(warnings.length ? {warnings} : {})};
}
async function staticBuild(blog) {
  const output = path.join(blog.site.root, 'dist');
  if (fs.existsSync(output) && (!fs.lstatSync(output).isDirectory() || !fs.existsSync(path.join(output, '.agent-blog-build.json')))) fail('UNOWNED_OUTPUT', 'dist already exists without an Agent Blog build marker; it was left untouched.');
  const staging = path.join(blog.site.root, '.build-' + randomUUID());
  fs.mkdirSync(staging);
  try {
    const published = blog.posts.list().filter(post => !post.metadata.draft);
    fs.writeFileSync(path.join(staging, 'index.html'), await blog.page(undefined, published));
    for (const [relative, post] of pageFiles(blog, published)) {
      const destination = path.join(staging, relative);
      fs.mkdirSync(path.dirname(destination), {recursive: true});
      fs.writeFileSync(destination, await blog.page(post, published));
    }
    for (const name of blog.outputs.keys()) {
      const destination = path.join(staging, name);
      fs.mkdirSync(path.dirname(destination), {recursive: true});
      fs.writeFileSync(destination, await blog.renderOutput(name, published));
    }
    for (const asset of blog.assets.filter(asset => asset.public)) {
      fs.cpSync(asset.directory, path.join(staging, asset.prefix.slice(1)), {recursive: true, dereference: false, filter: source => {
        const relative = path.relative(asset.directory, source).split(path.sep).join('/');
        return !fs.lstatSync(source).isSymbolicLink() && (!relative || !asset.include || asset.include.some(file => relative === file || relative.startsWith(file + '/') || file.startsWith(relative + '/')));
      }});
    }
    fs.writeFileSync(path.join(staging, '.agent-blog-build.json'), JSON.stringify({version: 1, posts: published.map(post => post.slug)}));
    if (fs.existsSync(output)) fs.rmSync(output, {recursive: true});
    fs.renameSync(staging, output);
    return {output, posts: published.length, plugins: blog.plugins};
  } finally { fs.rmSync(staging, {recursive: true, force: true}); }
}
