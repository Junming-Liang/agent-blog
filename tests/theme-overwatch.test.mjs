import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {loadSite, build} from '../packages/core/index.mjs';

const plugin = name => ({use: fileURLToPath(new URL(`../packages/${name}/index.mjs`, import.meta.url))});
function site(t, names) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-blog-overwatch-'));
  fs.mkdirSync(path.join(root, 'content'));
  fs.writeFileSync(path.join(root, 'blog.json'), JSON.stringify({version: 1, title: '<Field> & Journal', description: '真实描述 & <探索>', plugins: names.map(plugin)}));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  return root;
}
const read = (root, file) => fs.readFileSync(path.join(root, 'dist', file), 'utf8');
const content = (title, type, draft = false) => ({metadata: {title, date: '2026-10-14T20:00:00Z', draft, tags: ['<tag>'], ...(type ? {type} : {})}, body: '**正文**\n\n$$x^2 + y^2 = z^2$$\n\n```js\nconst x = 1;\n```'});

test('Overwatch theme alone renders escaped site text, local assets and an empty journal', async t => {
  const root = site(t, ['theme-overwatch']), blog = await loadSite(root);
  await build(blog);
  const html = read(root, 'index.html');
  assert.match(html, /&lt;Field&gt; &amp; Journal/);
  assert.match(html, /真实描述 &amp; &lt;探索&gt;/);
  assert.match(html, /还没有发布的文章/);
  assert.match(html, /ow-briefing/);
  assert.doesNotMatch(html, /class="ow-action"|<script|https?:\/\//);
  assert.ok(fs.existsSync(path.join(root, 'dist/_assets/theme-overwatch/field-station.svg')));
  assert.ok(!fs.existsSync(path.join(root, 'dist/_assets/core')));
  for (const file of ['style.css', 'field-station.svg']) {
    const asset = read(root, `_assets/theme-overwatch/${file}`);
    assert.doesNotMatch(asset, /<script|@import|(?:href|src)=["']https?:|url\(["']?https?:|\bon\w+=/i);
  }
  assert.deepEqual(fs.readdirSync(path.join(root, 'dist/_assets/theme-overwatch')).sort(), ['field-station.svg', 'style.css']);
});

test('theme composes with feature pages and renderers; switching to paper preserves source and metadata', async t => {
  const names = ['notes', 'pages', 'archive', 'links', 'navigation', 'date-format', 'footer', 'markdown', 'highlight', 'math'];
  const root = site(t, [...names, 'theme-overwatch']);
  fs.writeFileSync(path.join(root, 'permalinks.mjs'), "export default {name:'test-permalinks',apiVersion:1,setup(api){api.permalink(p=>'/entries/'+p.slug+'/')}};");
  const seed = await loadSite(root);
  const config = {...seed.site, plugins: [...seed.site.plugins, './permalinks.mjs']};
  const blog = await loadSite(root, {config});
  for (const [slug, type, draft] of [['article', undefined, false], ['note', 'note', false], ['about', 'page', false], ['private', undefined, true]]) {
    blog.posts.write(slug, content(slug === 'private' ? 'TOP SECRET' : `${slug} <真实标题>`, type, draft), null);
  }
  const before = blog.posts.list();
  const bytes = fs.readdirSync(path.join(root, 'content')).map(file => [file, fs.readFileSync(path.join(root, 'content', file), 'utf8')]);
  await build(blog);
  const home = read(root, 'index.html');
  assert.match(home, /href="\/entries\/article\/"/);
  assert.match(home, /href="\/archive\/"/);
  assert.match(home, /notes-section/);
  assert.match(home, /article &lt;真实标题&gt;/);
  for (const file of ['index.html', 'notes/index.html', 'archive/index.html', 'links/index.html', 'entries/article/index.html', 'entries/about/index.html']) {
    const html = read(root, file);
    assert.match(html, /_assets\/theme-overwatch\/style.css/);
    assert.doesNotMatch(html, /TOP SECRET/);
  }
  const article = read(root, 'entries/article/index.html');
  assert.match(article, /<strong>正文<\/strong>/);
  assert.match(article, /class="katex/);
  assert.match(article, /hljs/);
  assert.match(read(root, 'notes/index.html'), /2026\/10\/15/);
  assert.ok(!fs.existsSync(path.join(root, 'dist/entries/private')));
  const paper = await loadSite(root, {config: {...config, plugins: [...config.plugins.filter(p => p.use !== plugin('theme-overwatch').use), plugin('theme-paper')]}});
  await build(paper);
  assert.deepEqual(paper.posts.list(), before);
  for (const [file, source] of bytes) assert.equal(fs.readFileSync(path.join(root, 'content', file), 'utf8'), source);
  const paperArticle = read(root, 'entries/article/index.html');
  assert.equal(paperArticle.match(/<div class="prose">([\s\S]*?)<\/main>/)[1], article.match(/<div class="prose">([\s\S]*?)<\/main>/)[1]);
  assert.doesNotMatch(read(root, 'index.html'), /theme-overwatch|TOP SECRET/);
  assert.ok(!fs.existsSync(path.join(root, 'dist/_assets/theme-overwatch')));
  assert.ok(!fs.existsSync(path.join(root, 'dist/entries/private')));
});
