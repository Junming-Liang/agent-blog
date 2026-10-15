#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadSite, readSiteConfig, build, serve} from './index.mjs';
import {fail, slugCheck, withWriteLock, postInputSchema} from './content.mjs';

const string = description => ({type: 'string', description});
const boolean = description => ({type: 'boolean', description});
const definitions = [
  {name: 'init', arguments: ['directory'], flags: {preset: {...string('minimal or writer'), enum: ['minimal', 'writer']}}, description: 'Initialize an empty site directory.'},
  {name: 'list', description: 'List published posts and drafts.'},
  {name: 'get', arguments: ['slug'], description: 'Read a post and its current revision.'},
  {name: 'new', arguments: ['slug'], flags: {title: string('Post title')}, stdin: 'text', description: 'Create a draft; optional --stdin supplies its plain body.'},
  {name: 'put', arguments: ['slug'], flags: {'if-revision': {...string('Current revision from get'), required: true}}, stdin: 'json', inputSchema: postInputSchema, description: 'Replace a post using {metadata,body} from --stdin.'},
  {name: 'publish', arguments: ['slug'], flags: {'if-revision': {...string('Current revision from get'), required: true}}, description: 'Publish a draft without changing its body.'},
  {name: 'remove', arguments: ['slug'], flags: {'if-revision': {...string('Current revision from get'), required: true}}, description: 'Remove only if the current revision matches.'},
  {name: 'build', description: 'Generate a static dist with published posts and public assets.'},
  {name: 'serve', flags: {port: {type: 'number', description: 'Loopback port; defaults to 4173'}}, description: 'Preview on loopback; an editor plugin adds editing.'},
  {name: 'plugins', description: 'List plugin configuration and resolved enabled manifests.'},
  {name: 'plugin', arguments: ['scaffold|enable|disable', 'name-or-module'], description: 'Scaffold a working plugin or validate and change its enabled state.'},
  {name: 'schema', description: 'Describe all commands and data contracts for agents.'}
];
const globals = {site: string('Site directory; defaults to current directory'), json: boolean('Compact machine-readable output'), help: boolean('Show command contracts')};
function extractGlobals(argv) {
  const rest = [], flags = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i].startsWith('--') ? argv[i].slice(2) : '';
    if (!Object.hasOwn(globals, key)) { rest.push(argv[i]); continue; }
    if (Object.hasOwn(flags, key)) fail('INVALID_OPTION', `Duplicate --${key}.`);
    if (key === 'site') {
      if (!argv[i + 1] || argv[i + 1].startsWith('--')) fail('INVALID_OPTION', 'Missing --site value.');
      flags.site = argv[++i];
    } else flags[key] = true;
  }
  return {rest, flags};
}
function parse(rest, definition, globals) {
  const args = [], flags = {...globals};
  const schema = {...definition.flags, ...(definition.stdin ? {stdin: boolean('Read input from stdin')} : {})};
  for (let i = 1; i < rest.length; i++) {
    if (!rest[i].startsWith('--')) { args.push(rest[i]); continue; }
    const key = rest[i].slice(2), field = schema[key];
    if (!field) fail('INVALID_OPTION', `Unknown option: --${key}. Run schema --json.`);
    if (Object.hasOwn(flags, key)) fail('INVALID_OPTION', `Duplicate --${key}.`);
    if (field.type === 'boolean') flags[key] = true;
    else {
      if (rest[i + 1] === undefined || rest[i + 1].startsWith('--')) fail('INVALID_OPTION', `Missing --${key} value.`);
      const value = rest[++i]; flags[key] = field.type === 'number' ? Number(value) : value;
      if (field.type === 'number' && !Number.isFinite(flags[key])) fail('INVALID_OPTION', `--${key} needs a number.`);
    }
    if (field.enum && !field.enum.includes(flags[key])) fail('INVALID_OPTION', `Invalid --${key} value.`);
  }
  for (const [key, field] of Object.entries(schema)) if (field.required && !Object.hasOwn(flags, key)) fail('INVALID_OPTION', `Required option: --${key}.`);
  if (definition.arguments && args.length !== definition.arguments.length) fail('INVALID_ARGUMENT', `Expected arguments: ${definition.arguments.join(' ')}.`);
  if (!definition.arguments && args.length) fail('INVALID_ARGUMENT', 'Unexpected positional arguments.');
  return {args, flags};
}
async function stdin() { let value = ''; for await (const chunk of process.stdin) value += chunk; return value; }
function init(directory, preset = 'minimal') {
  const root = path.resolve(directory);
  if (fs.existsSync(root) && fs.readdirSync(root).length) fail('EXISTS', 'Initialize an empty directory; existing files were left untouched.');
  fs.mkdirSync(path.join(root, 'content'), {recursive: true});
  fs.mkdirSync(path.join(root, 'plugins'));
  const plugins = preset === 'writer' ? ['@agent-blog/markdown', '@agent-blog/highlight', '@agent-blog/math', '@agent-blog/editor', '@agent-blog/editor-markdown', '@agent-blog/editor-highlight', '@agent-blog/editor-agent'] : [];
  fs.writeFileSync(path.join(root, 'blog.json'), JSON.stringify({version: 1, title: 'My Blog', description: 'Write in your own way.', plugins}, null, 2) + '\n');
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# Blog editing contract\n\nPosts in content/*.md are authoritative. Front matter is JSON between --- lines.\nDiscover commands and plugin flags with `agent-blog schema --json`.\nRead `get SLUG --json` before writing; use `put SLUG --stdin --if-revision REVISION --json`.\nThe input is {metadata,body}. Preserve custom metadata and merge revision conflicts.\nNew posts are drafts until explicitly published. Build does not deploy the site.\nUse `plugin scaffold NAME`, customize the resulting working plugin, then enable it.\nPlugins use API version 1 and declare dependencies with requires. They are trusted local code.\nPreview and editor remain loopback-only. Do not modify production routing or publish online without authorization.\n');
  return {root, preset, plugins};
}
async function configurePlugin(directory, action, name) {
  const {root, config} = readSiteConfig(directory);
  const configFile = path.join(root, 'blog.json'), before = fs.readFileSync(configFile, 'utf8');
  if (action === 'scaffold') {
    if (!/^[a-z][a-z0-9-]*$/.test(name)) fail('INVALID_PLUGIN', 'Use a lowercase plugin name.');
    const module = './plugins/' + name + '.mjs';
    fs.mkdirSync(path.join(root, 'plugins'), {recursive: true});
    fs.writeFileSync(path.join(root, module), `/** @type {import('@agent-blog/core').Plugin} */\nexport default {\n  name: ${JSON.stringify(name)},\n  apiVersion: 1,\n  description: 'Describe this site and count its posts.',\n  setup(api) {\n    api.command({\n      name: ${JSON.stringify(name)},\n      description: 'Count posts, optionally including drafts.',\n      flags: {drafts: {type: 'boolean', description: 'Include drafts'}},\n      run({flags}) {\n        const posts = api.posts.list().filter(post => flags.drafts || !post.metadata.draft);\n        return {title: api.site.title, posts: posts.length};\n      }\n    });\n  }\n};\n`, {flag: 'wx'});
    return {module, next: `agent-blog plugin enable ${module}`};
  }
  if (!['enable', 'disable'].includes(action)) fail('INVALID_PLUGIN', 'Use scaffold, enable or disable.');
  const entry = config.plugins.find(p => (typeof p === 'string' ? p : p.use) === name);
  if (!entry && action === 'disable') fail('NOT_FOUND', 'Plugin is not configured.');
  if (!entry) config.plugins.push({use: name});
  else config.plugins = config.plugins.map(p => p === entry ? {...(typeof p === 'string' ? {use: p} : p), enabled: action === 'enable'} : p);
  await loadSite(root, {config});
  withWriteLock(root, () => {
    if (fs.readFileSync(configFile, 'utf8') !== before) fail('CONFLICT', 'Plugin configuration changed during validation. Retry with the latest configuration.', 409);
    const temporary = configFile + '.tmp';
    fs.writeFileSync(temporary, JSON.stringify(config, null, 2) + '\n', {flag: 'wx'});
    try { fs.renameSync(temporary, configFile); } finally { fs.rmSync(temporary, {force: true}); }
  });
  return {module: name, enabled: action === 'enable', restartPreview: true};
}
export async function main(argv = process.argv.slice(2), {onWarnings = () => {}} = {}) {
  const {rest, flags: common} = extractGlobals(argv);
  const command = rest[0] || 'schema';
  if (common.help) return {version: 1, globals, commands: definitions};
  const core = definitions.find(definition => definition.name === command);
  if (command === 'init') { const {args, flags} = parse(rest, core, common); return init(args[0], flags.preset); }
  if (command === 'plugin') { const {args} = parse(rest, core, common); return configurePlugin(common.site || '.', args[0], args[1]); }
  const blog = await loadSite(common.site || '.');
  const definition = core || blog.commands.get(command);
  if (!definition) fail('UNKNOWN_COMMAND', `Unknown command: ${command}. Run schema --json.`);
  const {args, flags} = parse(rest, definition, common), slug = args[0], expected = flags['if-revision'];
  let input;
  if (flags.stdin) {
    input = await stdin();
    if (definition.stdin === 'json') { try { input = JSON.parse(input); } catch { fail('INVALID_JSON', 'Invalid JSON input.'); } }
  }
  const invocation = {args, flags: Object.fromEntries(Object.entries(flags).filter(([key]) => Object.hasOwn(definition.flags || {}, key))), input};
  async function run() {
    if (command === 'schema') return {version: 1, globals, commands: [...definitions, ...[...blog.commands.values()].map(({run, ...definition}) => definition)], plugins: blog.plugins, post: {inputSchema: postInputSchema, revision: {type: 'string', pattern: '^[a-f0-9]{64}$'}}, replies: {success: '{ok:true,data}', failure: '{ok:false,error:{code,message}}'}, errors: ['CONFLICT', 'BUSY', 'INVALID_POST', 'NOT_FOUND', 'MISSING_PLUGIN', 'PLUGIN_API_VERSION', 'INVALID_OPTION'], plugin: {apiVersion: 1, declaration: '{name, apiVersion, requires?, optionalRequires?, extends?, setup(api, options)}', hooks: ['storage', 'codec', 'validator', 'renderer', 'transform', 'layout', 'component', 'slot', 'indexFilter', 'permalink', 'builder', 'command', 'commandMiddleware', 'execute', 'route', 'middleware', 'output', 'asset', 'stylesheet', 'on'], components: ['shell', 'head', 'header', 'index', 'intro', 'list', 'card', 'article', 'metadata', 'date', 'footer'], slots: ['head:after', 'header:nav', 'header:after', 'index:before', 'index:after', 'post:before', 'post:after', 'footer:before'], events: ['post:written', 'post:removed', 'build:completed', 'command:completed'], services: ['provide', 'require', 'optional'], content: ['posts.read', 'posts.list', 'posts.write', 'posts.remove', 'posts.validate'], configuration: '{use, enabled?, options?}'} };
    if (command === 'list') return blog.posts.list().map(({body, ...post}) => post);
    if (command === 'get') return blog.posts.read(slug);
    if (command === 'new') return blog.posts.write(slugCheck(slug), {metadata: {title: flags.title || slug, date: new Date().toISOString().slice(0, 10), draft: true, tags: []}, body: input ?? ''}, null);
    if (command === 'put') {
      if (!flags.stdin) fail('STDIN_REQUIRED', 'Use --stdin to send {metadata,body}.');
      return blog.posts.write(slug, input, expected);
    }
    if (command === 'publish') { const post = blog.posts.read(slug); return blog.posts.write(slug, {metadata: {...post.metadata, draft: false}, body: post.body}, expected); }
    if (command === 'remove') return blog.posts.remove(slug, expected);
    if (command === 'plugins') return {configured: blog.site.plugins, enabled: blog.plugins};
    if (command === 'build') return build(blog);
    if (command === 'serve') {
      const port = flags.port ?? 4173;
      if (!Number.isInteger(port) || port < 1 || port > 65535) fail('INVALID_PORT', 'Choose a port between 1 and 65535.');
      const server = await serve(blog, {port});
      const value = {url: `http://127.0.0.1:${server.address().port}/`, ...(blog.plugins.some(p => p.name === 'editor') ? {editor: `http://127.0.0.1:${server.address().port}/__editor/`} : {})};
      const stop = () => server.close(() => process.exit(0));
      process.once('SIGINT', stop); process.once('SIGTERM', stop);
      return value;
    }
    return definition.run(invocation);
  }
  try { return await blog.invoke({...definition, run}, invocation); }
  finally { onWarnings(await blog.flushEvents()); }
}

if (process.argv[1] && fs.existsSync(process.argv[1]) && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let warnings = [];
  main(undefined, {onWarnings: value => { warnings = value; }}).then(data => console.log(JSON.stringify({ok: true, data, ...(warnings.length ? {warnings} : {})}, null, process.argv.includes('--json') ? 0 : 2))).catch(error => {
    console.error(JSON.stringify({ok: false, error: {code: error.code || 'INTERNAL', message: error.message}, ...(warnings.length ? {warnings} : {})}));
    process.exitCode = 1;
  });
}
