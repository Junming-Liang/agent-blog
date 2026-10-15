import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import http from 'node:http';
import {loadSite, build, serve} from '../packages/core/index.mjs';
import {main} from '../packages/core/cli.mjs';

const directory = fileURLToPath(new URL('../', import.meta.url));
const cli = path.join(directory, 'packages/core/cli.mjs');
const plugin = name => fileURLToPath(new URL(`../packages/${name}/index.mjs`, import.meta.url));
function site(t, plugins = []) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-blog-test-'));
  fs.mkdirSync(path.join(root, 'content'));
  fs.writeFileSync(path.join(root, 'blog.json'), JSON.stringify({version: 1, title: 'Test Blog', plugins}));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  return root;
}
const post = (body = '# Hello', draft = false) => ({metadata: {title: 'Hello', date: '2026-10-14', draft, customField: {preserved: true}}, body});
test('zero-dependency core runs with no plugins and builds no drafts or editor', async t => {
  const root = site(t), blog = await loadSite(root);
  blog.posts.write('hello', post('<script>alert(1)</script>'), null);
  blog.posts.write('private', post('secret draft', true), null);
  const result = await build(blog);
  const html = fs.readFileSync(path.join(result.output, 'posts/hello/index.html'), 'utf8');
  assert.match(html, /&lt;script&gt;/);
  assert.ok(!fs.existsSync(path.join(result.output, 'posts/private')));
  assert.ok(!fs.existsSync(path.join(result.output, '_assets/editor')));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory, 'packages/core/package.json'))).dependencies, undefined);
  fs.mkdirSync(path.join(root, 'dist/keep'));
  blog.posts.remove('hello', blog.posts.read('hello').revision);
  await build(blog);
  assert.ok(!fs.existsSync(path.join(result.output, 'posts/hello')));
});
test('revisions prevent CLI/editor clobbering and preserve custom metadata', async t => {
  const blog = await loadSite(site(t));
  const first = blog.posts.write('hello', post(), null);
  const second = blog.posts.write('hello', {...first, body: 'Agent changed this'}, first.revision);
  assert.throws(() => blog.posts.write('hello', {...first, body: 'Old editor buffer'}, first.revision), {code: 'CONFLICT'});
  assert.equal(blog.posts.read('hello').body, second.body);
  assert.deepEqual(second.metadata.customField, {preserved: true});
  assert.throws(() => blog.posts.write('hello', post()), {code: 'REVISION_REQUIRED'});
  assert.throws(() => blog.posts.write('hello', post(), null), {code: 'CONFLICT'});
  assert.throws(() => blog.posts.write('../escape', post(), null), {code: 'INVALID_SLUG'});
});
test('dependency order is resolved and rendering plugins remain removable', async t => {
  const root = site(t, [plugin('math'), plugin('highlight'), plugin('markdown'), plugin('editor')]);
  const blog = await loadSite(root);
  assert.deepEqual(blog.plugins.map(p => p.name), ['editor', 'markdown', 'math', 'highlight']);
  const article = blog.posts.write('math', post('# Heading\n\n$E=mc^2$\n\n$$\nx^2 + y^2 = z^2\n$$\n\n```javascript\nconst value = 1;\n```\n\n<script>alert(1)</script>'), null);
  const rendered = await blog.renderPost(article);
  assert.match(rendered, /<h1>Heading<\/h1>/);
  assert.match(rendered, /katex-display/);
  assert.match(rendered, /hljs-keyword/);
  assert.doesNotMatch(rendered, /<script>/);
  const codeOnly = await blog.renderPost({...article, body: '```text\n$do_not_render$\n```\n\n`$also_not_math$`'});
  assert.doesNotMatch(codeOnly, /class="katex/);
  const result = await build(blog);
  assert.ok(fs.existsSync(path.join(result.output, '_assets/math/katex.min.css')));
  assert.ok(!fs.existsSync(path.join(result.output, '_assets/math/katex.min.js')));
  assert.ok(!fs.existsSync(path.join(result.output, '_assets/editor')));
  await main(['plugin', 'disable', plugin('math'), '--site', root]);
  await main(['plugin', 'disable', plugin('highlight'), '--site', root]);
  await main(['plugin', 'disable', plugin('markdown'), '--site', root]);
  const plain = await loadSite(root);
  assert.match(await plain.renderPost(article), /<pre class="plain-text">/);
  assert.deepEqual(plain.plugins.map(p => p.name), ['editor']);
});
test('plugin contracts expose custom flags, stdin, routes and transforms', async t => {
  const root = site(t);
  const module = path.join(root, 'custom.mjs');
  fs.writeFileSync(module, `export default {name:'custom',apiVersion:1,setup(api){api.transform(({html})=>html+'<p>Extension</p>');api.command({name:'custom',description:'Custom agent command',arguments:['slug'],flags:{limit:{type:'number',required:true},verbose:{type:'boolean'}},stdin:'json',inputSchema:{type:'object'},run:({args,flags,input})=>({args,flags,input})});api.route('/extra',({res,json})=>json(res,200,{extension:true}));}};`);
  await main(['plugin', 'enable', './custom.mjs', '--site', root]);
  const schema = await main(['schema', '--site', root]);
  const custom = schema.commands.find(c => c.name === 'custom');
  assert.equal(custom.flags.limit.type, 'number'); assert.equal(custom.stdin, 'json');
  const result = spawnSync(process.execPath, [cli, 'custom', 'hello', '--limit', '2', '--verbose', '--stdin', '--site', root, '--json'], {input: '{"value":3}', encoding: 'utf8'});
  assert.equal(result.status, 0, result.stderr);
  const data = JSON.parse(result.stdout).data;
  assert.equal(data.flags.limit, 2); assert.equal(data.flags.verbose, true); assert.deepEqual(data.input, {value: 3});
  const blog = await loadSite(root), server = await serve(blog, {port: 0}); t.after(() => server.close());
  const origin = 'http://127.0.0.1:' + server.address().port;
  assert.deepEqual(await (await fetch(origin + '/extra')).json(), {extension: true});
  assert.match(await blog.renderPost(blog.posts.write('hello', post(), null)), /Extension/);
  await main(['plugin', 'disable', './custom.mjs', '--site', root]);
  assert.ok(!(await loadSite(root)).commands.has('custom'));
});
test('bad plugins and incompatible API versions cannot alter configuration', async t => {
  const root = site(t), file = path.join(root, 'blog.json'), before = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(path.join(root, 'bad.mjs'), "export default {name:'bad',apiVersion:99,setup(){}};");
  await assert.rejects(main(['plugin', 'enable', './bad.mjs', '--site', root]), {code: 'PLUGIN_API_VERSION'});
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  await assert.rejects(loadSite(root, {config: {version: 1, title: 'Test', plugins: [plugin('math')]}}), {code: 'MISSING_PLUGIN'});
  fs.writeFileSync(path.join(root, 'a.mjs'), "export default {name:'a',apiVersion:1,requires:['b'],setup(){}};");
  fs.writeFileSync(path.join(root, 'b.mjs'), "export default {name:'b',apiVersion:1,requires:['a'],setup(){}};");
  await assert.rejects(loadSite(root, {config: {version: 1, title: 'Test', plugins: ['./a.mjs', './b.mjs']}}), {code: 'PLUGIN_CYCLE'});
});
test('editor HTTP uses the same content contract and rejects foreign origins', async t => {
  const blog = await loadSite(site(t, [plugin('editor')]));
  const first = blog.posts.write('hello', post('draft', true), null);
  const server = await serve(blog, {port: 0}); t.after(() => server.close());
  const origin = 'http://127.0.0.1:' + server.address().port;
  assert.equal((await fetch(origin + '/posts/hello/')).status, 404);
  const payload = {...post('saved from browser', true), revision: first.revision};
  const response = await fetch(origin + '/__editor/api/posts/hello', {method: 'PUT', headers: {'Content-Type': 'application/json', Origin: origin}, body: JSON.stringify(payload)});
  assert.equal(response.status, 200); assert.equal(blog.posts.read('hello').body, 'saved from browser');
  const conflict = await fetch(origin + '/__editor/api/posts/hello', {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload)});
  assert.equal(conflict.status, 409);
  const crossOrigin = await fetch(origin + '/__editor/api/posts/hello', {method: 'PUT', headers: {'Content-Type': 'application/json', Origin: 'https://other.example'}, body: JSON.stringify(payload)});
  assert.equal(crossOrigin.status, 403);
  const rebindingStatus = await new Promise((resolve, reject) => {
    const req = http.get(origin + '/__editor/api/posts', {headers: {Host: 'other.example'}}, res => {res.resume(); resolve(res.statusCode);});
    req.on('error', reject);
  });
  assert.equal(rebindingStatus, 403);
});
test('agents can initialize, scaffold, discover and execute a working plugin', async t => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-blog-cli-')); t.after(() => fs.rmSync(parent, {recursive: true, force: true}));
  const root = path.join(parent, 'site');
  await main(['init', root]);
  await main(['new', 'hello', '--title', 'Hello', '--site', root]);
  await main(['plugin', 'scaffold', 'stats', '--site', root]);
  await main(['plugin', 'enable', './plugins/stats.mjs', '--site', root]);
  assert.equal((await main(['stats', '--drafts', '--site', root])).posts, 1);
  assert.equal((await main(['stats', '--site', root])).posts, 0);
  const read = await main(['get', 'hello', '--site', root]);
  await main(['publish', 'hello', '--if-revision', read.revision, '--site', root]);
  assert.equal((await main(['stats', '--site', root])).posts, 1);
  assert.ok(fs.existsSync(path.join(root, 'AGENTS.md')));
});
test('writer presets work outside the framework checkout without adding core dependencies', async t => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-blog-writer-')); t.after(() => fs.rmSync(parent, {recursive: true, force: true}));
  const root = path.join(parent, 'site');
  await main(['init', root, '--preset', 'writer']);
  assert.deepEqual((await loadSite(root)).plugins.map(p => p.name), ['editor', 'markdown', 'highlight', 'math', 'editor-markdown', 'editor-highlight', 'editor-agent']);
});
test('default initialization provides the bundled system with removable plugins and preserves explicit core-only setup', async t => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-blog-default-')); t.after(() => fs.rmSync(parent, {recursive: true, force: true}));
  const root = path.join(parent, 'site');
  const initialized = await main(['init', root]);
  assert.equal(initialized.preset, 'default');
  assert.ok(!initialized.plugins.includes('@agent-blog/wordpress'));
  const blog = await loadSite(root);
  assert.deepEqual(blog.plugins.map(p => p.name), ['editor', 'markdown', 'highlight', 'math', 'editor-markdown', 'editor-highlight', 'editor-agent', 'auth', 'theme-paper', 'notes', 'pages', 'navigation', 'archive', 'links', 'date-format', 'footer', 'publish-on-save', 'marketplace']);
  const schema = await main(['schema', '--site', root]);
  for (const name of ['notes-new', 'pages-new', 'marketplace-list', 'auth-setup']) assert.ok(schema.commands.some(command => command.name === name));
  assert.equal(schema.commands.find(command => command.name === 'init').flags.preset.default, 'default');
  const note = await main(['notes-new', 'short-note', '--title', 'Default note', '--site', root]);
  assert.equal(note.metadata.type, 'note');
  assert.equal(note.metadata.draft, true);
  await main(['pages-new', 'about', '--title', 'About', '--site', root]);
  await main(['publish', note.slug, '--if-revision', note.revision, '--site', root]);
  assert.match(fs.readFileSync(path.join(root, 'dist/notes/index.html'), 'utf8'), /Default note/);
  for (const output of ['archive/index.html', 'links/index.html']) assert.ok(fs.existsSync(path.join(root, 'dist', output)));
  assert.ok(!fs.existsSync(path.join(root, 'dist/posts/about')));
  assert.ok(!fs.existsSync(path.join(root, 'dist/_assets/editor')));
  assert.match(await blog.page(), /_assets\/theme-paper\/style.css/);
  await main(['plugin', 'disable', '@agent-blog/date-format', '--site', root]);
  const customized = fs.readFileSync(path.join(root, 'blog.json'), 'utf8');
  await assert.rejects(main(['init', root]), {code: 'EXISTS'});
  assert.equal(fs.readFileSync(path.join(root, 'blog.json'), 'utf8'), customized);
  const remaining = await loadSite(root);
  assert.ok(!remaining.plugins.some(plugin => plugin.name === 'date-format'));
  assert.ok(remaining.plugins.some(plugin => plugin.name === 'notes'));
  assert.equal(remaining.posts.read(note.slug).metadata.title, 'Default note');
  const minimal = path.join(parent, 'minimal');
  assert.deepEqual((await main(['init', minimal, '--preset', 'minimal'])).plugins, []);
  assert.deepEqual((await loadSite(minimal)).plugins, []);
});
test('installed CLI symlinks execute the same machine-readable command entry', async t => {
  const root = site(t), link = path.join(root, 'agent-blog');
  fs.symlinkSync(cli, link);
  const result = spawnSync(process.execPath, [link, 'schema', '--site', root, '--json'], {encoding: 'utf8'});
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).data.plugin.apiVersion, 1);
});
test('plugins register static feeds and independent pages without direct filesystem writes', async t => {
  const root = site(t), module = path.join(root, 'output.mjs');
  fs.writeFileSync(module, `export default {name:'output',apiVersion:1,setup(api){api.output('feed.json',({posts})=>JSON.stringify(posts.map(post=>post.metadata.title)));api.output('about/index.html','<h1>About this blog</h1>');}};`);
  await main(['plugin', 'enable', './output.mjs', '--site', root]);
  const blog = await loadSite(root);
  blog.posts.write('public', post(), null); blog.posts.write('draft', post('private', true), null);
  const result = await build(blog);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(result.output, 'feed.json'))), ['Hello']);
  assert.match(fs.readFileSync(path.join(result.output, 'about/index.html'), 'utf8'), /About this blog/);
  const server = await serve(blog, {port: 0}); t.after(() => server.close());
  const origin = 'http://127.0.0.1:' + server.address().port;
  assert.deepEqual(await (await fetch(origin + '/feed.json')).json(), ['Hello']);
  assert.match(await (await fetch(origin + '/about/')).text(), /About this blog/);
});
test('invalid output paths and return values fail with actionable plugin errors', async t => {
  const root = site(t), module = path.join(root, 'invalid.mjs');
  fs.writeFileSync(module, "export default {name:'invalid',apiVersion:1,setup(api){api.output('../escape.txt','bad');}};");
  await assert.rejects(main(['plugin', 'enable', './invalid.mjs', '--site', root]), {code: 'INVALID_OUTPUT'});
  const badReturn = path.join(root, 'bad-return.mjs');
  fs.writeFileSync(badReturn, "export default {name:'bad-return',apiVersion:1,setup(api){api.output('bad.json',()=>undefined);}};");
  await main(['plugin', 'enable', './bad-return.mjs', '--site', root]);
  const blog = await loadSite(root), server = await serve(blog, {port: 0}); t.after(() => server.close());
  const response = await fetch('http://127.0.0.1:' + server.address().port + '/bad.json');
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, 'INVALID_OUTPUT');
});

test('skins replace their assets while components and slots compose on the same posts', async t => {
  const root = site(t, [plugin('markdown'), plugin('theme-paper')]);
  fs.writeFileSync(path.join(root, 'cells.mjs'), `export default {name:'cells',apiVersion:1,setup(api){api.component('footer',()=>'<footer>Custom footer</footer>');api.slot('post:after',({post})=>'<aside>'+api.escapeHTML(post.metadata.title)+'</aside>');api.slot('post:after',()=>'<small>Second slot</small>');}};`);
  await main(['plugin', 'enable', './cells.mjs', '--site', root]);
  const paper = await loadSite(root), article = paper.posts.write('hello', post(), null);
  const first = await build(paper), page = fs.readFileSync(path.join(first.output, 'posts/hello/index.html'), 'utf8');
  assert.match(page, /theme-paper\/style.css/); assert.match(page, /Custom footer/);
  assert.match(page, /<aside>Hello<\/aside><small>Second slot<\/small>/);
  assert.doesNotMatch(page, /_assets\/core/); assert.ok(!fs.existsSync(path.join(first.output, '_assets/core')));
  const before = fs.readFileSync(path.join(root, 'content/hello.md'), 'utf8');
  const configBefore = fs.readFileSync(path.join(root, 'blog.json'), 'utf8');
  await assert.rejects(main(['plugin', 'enable', plugin('theme-terminal'), '--site', root]), {code: 'DUPLICATE_LAYOUT'});
  assert.equal(fs.readFileSync(path.join(root, 'blog.json'), 'utf8'), configBefore);
  await main(['plugin', 'disable', plugin('theme-paper'), '--site', root]);
  await main(['plugin', 'enable', plugin('theme-terminal'), '--site', root]);
  const terminal = await loadSite(root), second = await build(terminal);
  assert.match(fs.readFileSync(path.join(second.output, 'posts/hello/index.html'), 'utf8'), /theme-terminal\/style.css/);
  assert.ok(!fs.existsSync(path.join(second.output, '_assets/theme-paper')));
  assert.equal(terminal.posts.read('hello').revision, article.revision);
  assert.equal(fs.readFileSync(path.join(root, 'content/hello.md'), 'utf8'), before);
});

test('file codecs change serialization while preserving revision protection and custom metadata', async t => {
  const root = site(t, [path.join(directory, 'examples/demo/plugins/json-format.mjs')]), blog = await loadSite(root);
  const first = blog.posts.write('hello', post(), null), file = path.join(root, 'content/hello.json');
  assert.ok(!fs.existsSync(path.join(root, 'content/hello.md')));
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).metadata.customField, {preserved: true});
  fs.writeFileSync(file, JSON.stringify(post('external editor')));
  assert.throws(() => blog.posts.write('hello', first, first.revision), {code: 'CONFLICT'});
  const latest = blog.posts.read('hello');
  blog.posts.remove('hello', latest.revision); assert.deepEqual(blog.posts.list(), []);
});

test('storage providers work without a content directory and own atomic compare-and-write', async t => {
  const root = site(t); fs.rmSync(path.join(root, 'content'), {recursive: true});
  fs.writeFileSync(path.join(root, 'store.mjs'), `import {createHash} from 'node:crypto';
export default {name:'store',apiVersion:1,setup(api){const data=new Map();let race=false;const revision=source=>source===undefined?null:createHash('sha256').update(source).digest('hex');api.storage({list:()=>[...data.keys()],read:slug=>data.get(slug)??null,write(slug,source,expected){if(race){race=false;data.set(slug,source+'\\n');}if(revision(data.get(slug))!==expected)api.fail('CONFLICT','Storage CAS refused',409);data.set(slug,source);},remove(slug,expected){if(revision(data.get(slug))!==expected)api.fail('CONFLICT','Storage CAS refused',409);data.delete(slug);}});api.command({name:'race',description:'Inject a concurrent storage write',run(){race=true;return true;}});}};`);
  await main(['plugin', 'enable', './store.mjs', '--site', root]);
  const blog = await loadSite(root), first = blog.posts.write('hello', post(), null);
  assert.equal(blog.posts.read('hello').revision, first.revision);
  await blog.execute('race');
  assert.throws(() => blog.posts.write('hello', post('changed'), first.revision), {code: 'CONFLICT'});
  const latest = blog.posts.read('hello'); blog.posts.remove('hello', latest.revision);
  assert.deepEqual(blog.posts.list(), []);
});

test('validators reject input before writing and failed lifecycle observers cannot undo a saved post', async t => {
  const root = site(t);
  fs.writeFileSync(path.join(root, 'events.mjs'), `export default {name:'events',apiVersion:1,setup(api){api.validator(input=>{if(input.metadata.series!==undefined&&typeof input.metadata.series!=='string')api.fail('INVALID_SERIES','series must be text');});api.on('post:written',async()=>{throw Error('Notification unavailable');});api.on('post:written',({post})=>{post.metadata.title='Do not mutate the authoritative post';});}};`);
  await main(['plugin', 'enable', './events.mjs', '--site', root]);
  const blog = await loadSite(root);
  assert.throws(() => blog.posts.write('bad', {body:'',metadata:{title:'Bad',draft:true,series:5}}, null), {code: 'INVALID_SERIES'});
  assert.ok(!fs.existsSync(path.join(root, 'content/bad.md')));
  const saved = blog.posts.write('hello', post(), null), warnings = await blog.flushEvents();
  assert.equal(warnings.length, 1); assert.equal(warnings[0].event, 'post:written');
  assert.equal(blog.posts.read('hello').metadata.title, saved.metadata.title);
  const result = spawnSync(process.execPath, [cli,'put','hello','--site',root,'--stdin','--if-revision',saved.revision,'--json'], {input:JSON.stringify(post('CLI committed')),encoding:'utf8'});
  assert.equal(result.status, 0, result.stderr); assert.equal(JSON.parse(result.stdout).warnings[0].code, 'HOOK_FAILED');
  assert.equal(blog.posts.read('hello').body, 'CLI committed');
});

test('custom permalinks, preview middleware and builders share the published output contract', async t => {
  const root = site(t);
  fs.writeFileSync(path.join(root, 'pipeline.mjs'), `export default {name:'pipeline',apiVersion:1,setup(api){api.permalink(post=>'/notes/'+encodeURIComponent(post.slug)+'/');api.middleware(async({res},next)=>{res.setHeader('X-Blog-Extension','active');return next();});api.builder(async({build})=>({...await build(),customBuilder:true}));}};`);
  await main(['plugin', 'enable', './pipeline.mjs', '--site', root]);
  const blog = await loadSite(root); blog.posts.write('中文', post(), null); blog.posts.write('draft', post('private',true), null);
  const result = await build(blog); assert.equal(result.customBuilder, true);
  assert.ok(fs.existsSync(path.join(result.output, 'notes/中文/index.html')));
  assert.ok(!fs.existsSync(path.join(result.output, 'notes/draft')));
  assert.match(await blog.page(), /href="\/notes\/%E4%B8%AD%E6%96%87\/"/);
  const server = await serve(blog, {port:0}); t.after(()=>server.close()); const origin='http://127.0.0.1:'+server.address().port;
  const response=await fetch(origin+'/notes/'+encodeURIComponent('中文')+'/'); assert.equal(response.status,200); assert.equal(response.headers.get('x-blog-extension'),'active');
  assert.equal((await fetch(origin+'/posts/'+encodeURIComponent('中文')+'/')).status,404);
  assert.equal((await fetch(origin+'/notes/draft/')).status,404);
});

test('editor extensions invoke the same validated commands and middleware as agents', async t => {
  const root=site(t,[plugin('editor'),path.join(directory,'examples/demo/plugins/writing-tools.mjs')]);
  fs.writeFileSync(path.join(root,'audit.mjs'),`export default {name:'audit',apiVersion:1,setup(api){api.commandMiddleware(async({name},next)=>{const result=await next();return name==='writing-stats'?{...result,audited:true}:result;});}};`);
  await main(['plugin','enable','./audit.mjs','--site',root]);
  const blog=await loadSite(root), server=await serve(blog,{port:0});t.after(()=>server.close());const origin='http://127.0.0.1:'+server.address().port;
  const manifest=await (await fetch(origin+'/__editor/api/extensions')).json();assert.equal(manifest.data[0].name,'writing-tools');
  const response=await fetch(origin+'/__editor/api/commands/writing-stats',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({input:post('abc')})});
  assert.deepEqual((await response.json()).data,{characters:3,lines:1,audited:true});
  const cliResult=spawnSync(process.execPath,[cli,'writing-stats','--site',root,'--stdin','--json'],{input:JSON.stringify(post('abc')),encoding:'utf8'});
  assert.equal(cliResult.status,0,cliResult.stderr);assert.deepEqual(JSON.parse(cliResult.stdout).data,{characters:3,lines:1,audited:true});
  await assert.rejects(blog.execute('writing-stats',{flags:{unknown:true},input:post()}),{code:'INVALID_OPTION'});
  await assert.rejects(blog.execute('writing-stats',{args:['unexpected'],input:post()}),{code:'INVALID_ARGUMENT'});
  const result=await build(blog);assert.ok(!fs.existsSync(path.join(result.output,'_assets/writing-tools')));
});

test('unsafe or colliding article URLs preserve the previous successful build', async t => {
  const root=site(t), original=await loadSite(root);
  original.posts.write('first',post(),null);original.posts.write('second',post(),null);
  const {output}=await build(original), before=fs.readFileSync(path.join(output,'index.html'),'utf8');
  fs.writeFileSync(path.join(root,'urls.mjs'),`export default {name:'urls',apiVersion:1,setup(api,options){api.permalink(()=>options.url);if(options.output)api.output(options.output,'custom');if(options.route)api.route(options.route,()=>{});}};`);
  for (const [url, extra, code] of [['/../escape/',{},'INVALID_PERMALINK'],['/same/',{},'OUTPUT_COLLISION'],['/same/',{output:'same/index.html'},'OUTPUT_COLLISION'],['/same/',{route:'/same'},'OUTPUT_COLLISION']]) {
    const blog=await loadSite(root,{config:{version:1,title:'Test',plugins:[{use:'./urls.mjs',options:{url,...extra}}]}});
    await assert.rejects(build(blog),{code});
    assert.equal(fs.readFileSync(path.join(output,'index.html'),'utf8'),before);
  }
});

test('registration order supports legacy content reads and rejects adapters registered too late', async t => {
  const root=site(t);
  fs.writeFileSync(path.join(root,'legacy.mjs'),`export default {name:'legacy',apiVersion:1,setup(api){const count=api.posts.list().length;api.command({name:'legacy',description:'Read the setup count',run:()=>count});}};`);
  await main(['plugin','enable','./legacy.mjs','--site',root]);assert.equal(await main(['legacy','--site',root]),0);
  const before=fs.readFileSync(path.join(root,'blog.json'),'utf8');
  await assert.rejects(main(['plugin','enable',path.join(directory,'examples/demo/plugins/json-format.mjs'),'--site',root]),{code:'ADAPTER_AFTER_CONTENT'});
  assert.equal(fs.readFileSync(path.join(root,'blog.json'),'utf8'),before);
  fs.writeFileSync(path.join(root,'async.mjs'),`export default {name:'async-codec',apiVersion:1,setup(api){api.codec({extension:'.json',decode:(_slug,source)=>JSON.parse(source),encode:async value=>JSON.stringify(value)});}};`);
  const asyncBlog=await loadSite(root,{config:{version:1,title:'Test',plugins:['./async.mjs']}});
  assert.throws(()=>asyncBlog.posts.write('hello',post(),null),{code:'INVALID_CODEC'});
  assert.ok(!fs.existsSync(path.join(root,'content/hello.json')));
});
