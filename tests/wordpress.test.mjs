import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadSite, build} from '../packages/core/index.mjs';
import {importWordPress, wordpressMarkdown} from '../packages/wordpress/index.mjs';

const plugin = name => fileURLToPath(new URL(`../packages/${name}/index.mjs`, import.meta.url));
function site(t, plugins) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-blog-wordpress-'));
  fs.mkdirSync(path.join(root, 'content'));
  fs.writeFileSync(path.join(root, 'blog.json'), JSON.stringify({version: 1, title: 'Migration test', plugins}));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  return root;
}
const row = (ID, status = 'publish', content = '<p>Hello</p>') => ({ID, post_type: 'post', post_status: status, post_content: content, post_title: 'Article', post_date_gmt: '2024-01-02 03:04:05', post_name: 'article', post_modified_gmt: '2024-01-03 00:00:00', post_password: '', author: 'Author'});
const data = posts => ({version: 1, options: {home: 'https://example.test'}, posts, terms: [{object_id: '1', taxonomy: 'category', name: 'Research'}]});

test('WordPress conversion retains code, tables, TeX, media and document links', async t => {
  const root = site(t, [plugin('markdown'), plugin('highlight'), plugin('math')]);
  const html = '<p>Inline [latex]V_t(x_t)[/latex] and $x_i^2$.</p><p>$$x_t^2+y_t^2=z_t^2$$</p><div><button>Copy code</button><pre><code class="language-python">x = 1\nprint(x)\n</code></pre></div><table><thead><tr><th>Name</th><th>Value</th></tr></thead><tbody><tr><td>A</td><td>1</td></tr></tbody></table><figure><img src="https://example.test/wp-content/uploads/a.png" alt="A"></figure><object data="https://example.test/wp-content/uploads/paper.pdf"></object><a href="https://example.test/?p=2">Next</a><script>evil()</script>';
  const body = wordpressMarkdown(html, 'https://example.test');
  assert.match(body, /\$V_t\(x_t\)\$/);
  assert.match(body, /\$x_i\^2\$/);
  assert.match(body, /```python\nx = 1\nprint\(x\)/);
  assert.match(body, /\/wp-content\/uploads\/a.png/);
  assert.match(body, /paper.pdf/);
  assert.match(body, /\/posts\/wp-2\//);
  assert.doesNotMatch(body, /Copy code|evil\(\)/);
  assert.match(wordpressMarkdown('<pre><code>[latex]x_i[/latex]</code></pre>', 'https://example.test'), /\[latex\]x_i\[\/latex\]/);
  const block = '<!-- wp:kevinbatdorf/code-block-pro ' + JSON.stringify({code: '  echo "$HOME"\n', language: 'shellscript'}) + ' --><pre>outdated generated HTML</pre><!-- /wp:kevinbatdorf/code-block-pro -->';
  assert.match(wordpressMarkdown(block, 'https://example.test'), /```bash\n  echo "\$HOME"\n```/);
  assert.match(wordpressMarkdown('<pre><code></code></pre>', 'https://example.test'), /```\n\n```/);
  assert.match(wordpressMarkdown('<pre><code>a<br>b</code></pre>', 'https://example.test'), /```\na\nb\n```/);
  const legacyImage = '<img src="http://192.0.2.10/wp-content/uploads/a.png">';
  assert.match(wordpressMarkdown(legacyImage, 'https://example.test'), /http:\/\/192.0.2.10/);
  assert.doesNotMatch(wordpressMarkdown(legacyImage, 'https://example.test', {legacyOrigins: ['http://192.0.2.10']}), /192\.0\.2\.10/);
  assert.match(wordpressMarkdown('<img src="https://external.test/wp-content/uploads/a.png">', 'https://example.test', {legacyOrigins: ['http://192.0.2.10']}), /external.test/);
  const blog = await loadSite(root);
  const rendered = await blog.renderPost({slug: 'sample', metadata: {title: 'Sample', draft: false}, body});
  assert.match(rendered, /<table>/);
  assert.match(rendered, /katex-display/);
  assert.match(rendered, /hljs-number/);
});

test('WordPress import preserves visibility, source identity and edits on repeated imports', async t => {
  const root = site(t, [plugin('wordpress')]), blog = await loadSite(root);
  const first = {...row('1'), post_type: 'page'};
  const source = data([first, row('2', 'draft'), row('3', 'private'), {...row('4'), post_password: 'old-password'}, {...row('5'), post_type: 'shuoshuo'}, {...row('6'), post_type: 'revision'}]);
  const result = importWordPress({...blog, fail: (code, message) => { throw Object.assign(Error(message), {code}); }}, source);
  assert.equal(result.imported.length, 5);
  assert.equal(blog.posts.read('wp-3').metadata.draft, true);
  assert.equal(blog.posts.read('wp-3').metadata.wordpress.status, 'private');
  assert.equal(blog.posts.read('wp-4').metadata.draft, true);
  assert.deepEqual(blog.posts.read('wp-1').metadata.categories, ['Research']);
  assert.equal(blog.posts.read('wp-1').metadata.date, '2024-01-02T03:04:05Z');
  const before = blog.posts.read('wp-1');
  blog.posts.write(before.slug, {...before, body: 'A later edit'}, before.revision);
  const api = {...blog, fail: (code, message) => { throw Object.assign(Error(message), {code}); }};
  assert.equal(importWordPress(api, source).skipped.length, 5);
  assert.equal(blog.posts.read('wp-1').body, 'A later edit');
  const changed = data([row('7'), {...first, post_content: '<p>Source changed</p>'}]);
  assert.throws(() => importWordPress(api, changed), {code: 'IMPORT_CONFLICT'});
  assert.throws(() => blog.posts.read('wp-7'), {code: 'NOT_FOUND'});
  const output = await build(blog);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(output.output, '.agent-blog-build.json'))).posts.sort(), ['wp-1', 'wp-5']);
});

test('publish-on-save updates the public site and removes unpublished content', async t => {
  const publisher = fileURLToPath(new URL('../deploy/publish.mjs', import.meta.url));
  const root = site(t, [publisher]), blog = await loadSite(root);
  const post = blog.posts.write('article', {metadata: {title: 'First', draft: false}, body: 'Published text'}, null);
  assert.deepEqual(await blog.flushEvents(), []);
  const file = path.join(root, 'dist/posts/article/index.html');
  assert.match(fs.readFileSync(file, 'utf8'), /Published text/);
  blog.posts.write('article', {...post, metadata: {...post.metadata, draft: true}}, post.revision);
  assert.deepEqual(await blog.flushEvents(), []);
  assert.ok(!fs.existsSync(file));
  assert.ok(!fs.existsSync(path.join(root, '.publish-lock')));
});
