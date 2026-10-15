import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {loadSite, build, serve} from '../packages/core/index.mjs';

const plugin = name => fileURLToPath(new URL(`../packages/${name}/index.mjs`, import.meta.url));
const cli = fileURLToPath(new URL('../packages/core/cli.mjs', import.meta.url));
const features = ['notes', 'pages', 'navigation', 'archive', 'links', 'date-format', 'footer', 'publish'];
const entry = (name, options = {}) => ({use: plugin(name), options});
function site(t, plugins = []) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-blog-features-'));
  fs.mkdirSync(path.join(root, 'content'));
  fs.writeFileSync(path.join(root, 'blog.json'), JSON.stringify({version: 1, title: 'Independent features', plugins}));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  return root;
}
const post = (title, type, draft = false, body = `${title} body`) => ({metadata: {title, ...(type ? {type} : {}), date: '2026-10-14T20:00:00Z', draft}, body});
const read = (root, file) => fs.readFileSync(path.join(root, 'dist', file), 'utf8');

test('every feature works alone without an editor, Markdown renderer or theme', async t => {
  for (const name of features) await t.test(name, async t => {
    const root = site(t, [entry(name)]), blog = await loadSite(root);
    blog.posts.write('article', post('Published article'), null);
    blog.posts.write('note', post('Published note', 'note'), null);
    blog.posts.write('page', post('Published page', 'page'), null);
    blog.posts.write('private-note', post('Secret note', 'note', true), null);
    blog.posts.write('private-article', post('Secret article', undefined, true), null);
    await build(blog);
    assert.match(read(root, 'posts/article/index.html'), /Published article/);
    assert.doesNotMatch(read(root, 'index.html'), /Secret note|Secret article/);
    for (const output of blog.outputs.keys()) assert.doesNotMatch(read(root, output), /Secret note|Secret article/);
    assert.ok(!fs.existsSync(path.join(root, 'dist/posts/private-note')));
    assert.ok(!fs.existsSync(path.join(root, 'dist/_assets/editor')));
    if (name === 'notes') {
      assert.match(read(root, 'notes/index.html'), /<pre class="plain-text">Published note body/);
      assert.doesNotMatch(read(root, 'notes/index.html'), /Published article body/);
    }
  });
});

test('disabling one feature preserves other outputs, drafts and source bytes', async t => {
  const configured = features.filter(name => name !== 'publish').map(name => entry(name));
  const root = site(t, configured), original = await loadSite(root);
  original.posts.write('article', post('Long article'), null);
  original.posts.write('note', post('Short note', 'note'), null);
  original.posts.write('page', post('About page', 'page'), null);
  original.posts.write('draft', post('Private note', 'note', true), null);
  const before = fs.readdirSync(path.join(root, 'content')).map(name => [name, fs.readFileSync(path.join(root, 'content', name), 'utf8')]);
  await build(original);
  const home = read(root, 'index.html');
  assert.match(home, /Long article/);
  assert.match(home, /Short note/);
  assert.doesNotMatch(home, /About page|Private note/);
  const disabled = await loadSite(root, {config: {...original.site, plugins: configured.map(value => value.use === plugin('notes') ? {...value, enabled: false} : value)}});
  await build(disabled);
  assert.ok(!fs.existsSync(path.join(root, 'dist/notes')));
  assert.match(read(root, 'archive/index.html'), /Long article/);
  assert.doesNotMatch(read(root, 'archive/index.html'), /Short note|About page|Private note/);
  assert.ok(fs.existsSync(path.join(root, 'dist/links/index.html')));
  assert.ok(fs.existsSync(path.join(root, 'dist/posts/note/index.html')));
  assert.doesNotMatch(read(root, 'index.html'), /notes-section|About page|Private note/);
  assert.equal(disabled.commands.has('notes-new'), false);
  assert.equal(disabled.commands.has('pages-new'), true);
  for (const [name, bytes] of before) assert.equal(fs.readFileSync(path.join(root, 'content', name), 'utf8'), bytes);
});

test('feature pages share bundled themes and notes compose with Markdown and date formatting', async t => {
  const root = site(t), seed = await loadSite(root);
  seed.posts.write('article', post('Article title'), null);
  const note = seed.posts.write('note', post('Note title', 'note', false, '**Short thought**'), null);
  const bytes = fs.readFileSync(path.join(root, 'content/note.md'), 'utf8');
  for (const theme of ['theme-paper', 'theme-terminal', 'theme-overwatch']) {
    const blog = await loadSite(root, {config: {...seed.site, plugins: [entry('notes'), entry('archive'), entry('links'), entry('navigation'), entry('date-format'), entry('markdown'), entry(theme)]}});
    await build(blog);
    const html = read(root, 'notes/index.html');
    assert.match(html, new RegExp(`_assets/${theme}/style.css`));
    assert.match(html, /<strong>Short thought<\/strong>/);
    assert.match(html, /2026\/10\/15/);
    assert.match(html, /href="\/archive\/"/);
    assert.match(read(root, 'archive/index.html'), new RegExp(`_assets/${theme}/style.css`));
    assert.match(read(root, 'links/index.html'), new RegExp(`_assets/${theme}/style.css`));
    assert.equal(blog.posts.read('note').revision, note.revision);
  }
  assert.equal(fs.readFileSync(path.join(root, 'content/note.md'), 'utf8'), bytes);
});

test('note cards are replaceable without overriding the feature or other cards', async t => {
  const root = site(t, [entry('notes')]);
  fs.writeFileSync(path.join(root, 'note-card.mjs'), "export default {name:'note-card',apiVersion:1,setup(api){api.component('notes:card',c=>'<aside>Skin: '+api.escapeHTML(c.post.metadata.title)+'</aside>');}};");
  const blog = await loadSite(root, {config: {version: 1, title: 'Skin', plugins: ['./note-card.mjs', entry('notes')]}});
  blog.posts.write('note', post('A note', 'note'), null);
  blog.posts.write('article', post('An article'), null);
  await build(blog);
  assert.match(read(root, 'notes/index.html'), /<aside>Skin: A note<\/aside>/);
  assert.match(read(root, 'index.html'), /post-row/);
});

test('CLI note/page creation is draft-only, discoverable and never clobbers content', async t => {
  const root = site(t, [entry('notes'), entry('pages')]);
  const result = spawnSync(process.execPath, [cli, 'notes-new', 'quick-note', '--title', 'CLI note', '--stdin', '--site', root, '--json'], {input: 'Written by an agent\n', encoding: 'utf8'});
  assert.equal(result.status, 0, result.stderr);
  const created = JSON.parse(result.stdout).data;
  assert.equal(created.metadata.type, 'note');
  assert.equal(created.metadata.draft, true);
  assert.equal(created.body, 'Written by an agent\n');
  const blog = await loadSite(root);
  await assert.rejects(blog.execute('notes-new', {args: ['quick-note'], input: 'Overwrite attempt'}), {code: 'CONFLICT'});
  assert.equal(blog.posts.read('quick-note').revision, created.revision);
  assert.deepEqual(await blog.execute('notes-list'), []);
  assert.equal((await blog.execute('notes-list', {flags: {drafts: true}})).length, 1);
  const page = await blog.execute('pages-new', {args: ['about'], flags: {title: 'About'}, input: 'Page text'});
  assert.equal(page.metadata.type, 'page'); assert.equal(page.metadata.draft, true);
  assert.equal(blog.commands.get('notes-new').stdin, 'text');
  assert.equal(blog.commands.get('pages-new').flags.title.type, 'string');
  assert.equal((await blog.execute('pages-list', {flags: {drafts: true}}))[0].slug, 'about');
});

test('notes and pages register editor buttons only when editor is enabled', async t => {
  const root = site(t, [entry('notes'), entry('pages'), entry('editor')]), blog = await loadSite(root);
  const server = await serve(blog, {port: 0}); t.after(() => server.close());
  const origin = 'http://127.0.0.1:' + server.address().port;
  const manifest = await (await fetch(origin + '/__editor/api/extensions')).json();
  assert.deepEqual(manifest.data.map(value => value.name), ['notes', 'pages']);
  for (const extension of manifest.data) assert.equal((await fetch(origin + extension.module)).status, 200);
  await build(blog);
  assert.ok(!fs.existsSync(path.join(root, 'dist/_assets/notes')));
  assert.ok(!fs.existsSync(path.join(root, 'dist/_assets/pages')));
  for (const [name, type] of [['notes', 'note'], ['pages', 'page']]) {
    const {setup} = await import(`../packages/${name}/public/browser.mjs`);
    let action, input;
    setup({button: value => { action = value; }, newPost: value => { input = value; return false; }});
    action.run();
    assert.equal(input.metadata.type, type);
  }
});

test('archive and links preserve legacy source while honoring custom permalinks', async t => {
  const root = site(t, [entry('archive', {legacySlugs: ['old-archive']}), entry('links', {legacySlugs: ['old-links'], links: [{title: 'Example & friends', url: 'https://example.com/?a=1&b=2'}]})]);
  fs.writeFileSync(path.join(root, 'urls.mjs'), "export default {name:'urls',apiVersion:1,setup(api){api.permalink(post=>'/entries/'+post.slug+'/');}};");
  const original = await loadSite(root);
  const blog = await loadSite(root, {config: {...original.site, plugins: [...original.site.plugins, './urls.mjs']}});
  blog.posts.write('article', post('Public article'), null);
  blog.posts.write('private', post('Private article', undefined, true), null);
  const archive = blog.posts.write('old-archive', post('Legacy archive', 'page', false, ''), null);
  const links = blog.posts.write('old-links', post('Legacy links', 'page', false, ''), null);
  assert.match(await blog.renderPost(archive), /href="\/entries\/article\/"/);
  assert.doesNotMatch(await blog.renderPost(archive), /Private article/);
  assert.match(await blog.renderPost(links), /Example &amp; friends/);
  assert.equal(blog.posts.read('old-archive').body, '');
  assert.equal(blog.posts.read('old-links').revision, links.revision);
  const authored = blog.posts.write('old-archive', {...archive, body: 'My authored archive'}, archive.revision);
  assert.match(await blog.renderPost(authored), /My authored archive/);
  assert.doesNotMatch(await blog.renderPost(authored), /archive-list/);
});

test('unsafe links and invalid options fail before loading a site', async t => {
  const root = site(t);
  for (const name of ['navigation', 'links', 'footer']) {
    for (const url of ['javascript:alert(1)', '//evil.example', '/\\evil.example', 'https://', 'https://example.com/\nscript']) {
      await assert.rejects(loadSite(root, {config: {version: 1, title: 'Unsafe links', plugins: [entry(name, {links: [{title: 'Unsafe', url}]})]}}), {code: 'INVALID_OPTION'});
    }
    const safe = await loadSite(root, {config: {version: 1, title: 'Escaping', plugins: [entry(name, {links: [{title: '<script>', url: '/?x="&y=1'}]})]}});
    const html = name === 'links' ? await safe.renderOutput('links/index.html') : await safe.page();
    assert.doesNotMatch(html, /<script>/); assert.match(html, /&lt;script&gt;/); assert.match(html, /&quot;&amp;y=1/);
  }
  for (const [name, options] of [['notes', {homeLimit: -1}], ['date-format', {timeZone: 'bad/time-zone'}], ['archive', {legacySlugs: [3]}], ['pages', {surprise: true}]]) {
    await assert.rejects(loadSite(root, {config: {version: 1, title: 'Invalid option', plugins: [entry(name, options)]}}), {code: 'INVALID_OPTION'});
  }
});

test('publishing on save updates output and reports build failures without undoing a write', async t => {
  const root = site(t, [entry('publish')]), blog = await loadSite(root);
  const article = blog.posts.write('article', post('First version'), null);
  assert.deepEqual(await blog.flushEvents(), []);
  assert.match(read(root, 'posts/article/index.html'), /First version/);
  blog.posts.remove('article', article.revision);
  assert.deepEqual(await blog.flushEvents(), []);
  assert.ok(!fs.existsSync(path.join(root, 'dist/posts/article')));
  assert.ok(!fs.existsSync(path.join(root, '.publish-lock')));
  fs.rmSync(path.join(root, 'dist'), {recursive: true});
  fs.mkdirSync(path.join(root, 'dist')); fs.writeFileSync(path.join(root, 'dist/owned-by-someone-else.txt'), 'Keep this');
  const committed = blog.posts.write('saved', post('Content survives'), null);
  const warnings = await blog.flushEvents();
  assert.equal(warnings.length, 1); assert.equal(warnings[0].code, 'HOOK_FAILED');
  assert.equal(blog.posts.read('saved').revision, committed.revision);
  assert.equal(fs.readFileSync(path.join(root, 'dist/owned-by-someone-else.txt'), 'utf8'), 'Keep this');
  assert.ok(!fs.existsSync(path.join(root, '.publish-lock')));
});
