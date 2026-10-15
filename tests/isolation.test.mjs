import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {loadSite, build} from '../packages/core/index.mjs';

function fixture(t, modules) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-blog-isolation-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  fs.mkdirSync(path.join(root, 'content'));
  for (const [name, source] of Object.entries(modules)) fs.writeFileSync(path.join(root, name + '.mjs'), source);
  fs.writeFileSync(path.join(root, 'blog.json'), JSON.stringify({version: 1, title: 'Independent features', plugins: Object.keys(modules).map(name => './' + name + '.mjs')}));
  return root;
}
test('optional integrations resolve order, disappear without the provider, and enforce declared service use', async t => {
  const root = fixture(t, {
    feature: `export default {name:'feature',apiVersion:1,optionalRequires:['provider'],setup(api){const p=api.optional('service');api.command({name:'feature',description:'Test integration',run:()=>p?.value??'standalone'});}};`,
    provider: `export default {name:'provider',apiVersion:1,setup(api){api.provide('service',{value:'connected'});}};`
  });
  const connected = await loadSite(root);
  assert.equal(await connected.execute('feature'), 'connected');
  const alone = await loadSite(root, {config: {...connected.site, plugins: ['./feature.mjs']}});
  assert.equal(await alone.execute('feature'), 'standalone');
  fs.writeFileSync(path.join(root, 'consumer.mjs'), `export default {name:'consumer',apiVersion:1,setup(api){api.require('service');}};`);
  await assert.rejects(loadSite(root, {config: {...connected.site, plugins: ['./provider.mjs','./consumer.mjs']}}), {code:'UNDECLARED_DEPENDENCY'});
});
test('overlapping routes and outputs are rejected regardless of registration order', async t => {
  for (const registration of [
    "api.route('/feature',()=>{});api.route('/feature/nested',()=>{});",
    "api.route('/feature/nested',()=>{});api.route('/feature',()=>{});",
    "api.output('feature/index.html','page');api.route('/feature',()=>{});",
    "api.route('/feature',()=>{});api.output('feature/index.html','page');"
  ]) {
    const root = fixture(t, {collision:`export default {name:'collision',apiVersion:1,setup(api){${registration}}};`});
    await assert.rejects(loadSite(root), error => ['INVALID_ROUTE','OUTPUT_COLLISION'].includes(error.code));
  }
});
test('skin overrides feature fallback components without depending on configuration order', async t => {
  const modules = {
    feature:`export default {name:'feature',apiVersion:1,setup(api){api.component('feature:cell',()=>'<b>Default cell</b>',{fallback:true});api.slot('index:after',c=>c.render('feature:cell'));}};`,
    skin:`export default {name:'skin',apiVersion:1,setup(api){api.component('feature:cell',async c=>'<aside>'+await c.renderDefault('feature:cell')+'</aside>');}};`
  };
  const root = fixture(t, modules);
  for (const plugins of [['./skin.mjs','./feature.mjs'],['./feature.mjs','./skin.mjs']]) {
    const blog = await loadSite(root,{config:{version:1,title:'Test',plugins}});
    assert.match(await blog.page(), /<aside><b>Default cell<\/b><\/aside>/);
  }
  const standalone = await loadSite(root,{config:{version:1,title:'Test',plugins:['./feature.mjs']}});
  assert.match(await standalone.page(), /<b>Default cell<\/b>/);
});
test('transform and slot data cannot silently mutate another feature or persisted content', async t => {
  const root = fixture(t, {feature:`export default {name:'feature',apiVersion:1,setup(api){api.transform(c=>{c.post.metadata.title='changed';return c.html});api.transform(c=>c.html+'<b>'+c.post.metadata.title+'</b>');api.slot('index:after',c=>{c.posts[0].metadata.title='slot mutation';return ''});api.slot('index:after',c=>'<aside>'+c.posts[0].metadata.title+'</aside>');}};`});
  const blog = await loadSite(root);
  const post = blog.posts.write('hello',{metadata:{title:'Original',draft:false},body:'Body'},null);
  assert.match(await blog.page(post), /<b>Original<\/b>/);
  assert.match(await blog.page(), /<aside>Original<\/aside>/);
  assert.equal(blog.posts.read('hello').revision, post.revision);
});
test('a failing optional output preserves the previous published build', async t => {
  const root = fixture(t, {}), blog = await loadSite(root);
  blog.posts.write('hello',{metadata:{title:'Published',draft:false},body:'Keep me'},null);
  await build(blog);
  const file=path.join(root,'dist/index.html'), before=fs.readFileSync(file,'utf8');
  fs.writeFileSync(path.join(root,'failing.mjs'),`export default {name:'failing',apiVersion:1,setup(api){api.output('extra/index.html',()=>{throw Error('Plugin failed')})}};`);
  const broken = await loadSite(root,{config:{...blog.site,plugins:['./failing.mjs']}});
  await assert.rejects(build(broken), /Plugin failed/);
  assert.equal(fs.readFileSync(file,'utf8'),before);
});

test('declared inheritance loads bases, grants services and rejects missing or cyclic bases', async t => {
  const root = fixture(t, {
    child: `export default {name:'child',apiVersion:1,extends:['base'],setup(api){const base=api.require('base');api.component('example:cell',c=>base+' child');}};`,
    base: `export default {name:'base',apiVersion:1,setup(api){api.provide('base','Base');api.component('example:cell',()=>'Base',{fallback:true});api.slot('index:after',c=>c.render('example:cell'));}};`
  });
  const blog=await loadSite(root);
  assert.deepEqual(blog.plugins.map(p=>p.name),['base','child']);
  assert.deepEqual(blog.plugins[1].extends,['base']);
  assert.match(await blog.page(),/Base child/);
  await assert.rejects(loadSite(root,{config:{...blog.site,plugins:['./child.mjs']}}),{code:'MISSING_PLUGIN'});
  fs.writeFileSync(path.join(root,'loop.mjs'),`export default {name:'loop',apiVersion:1,extends:['loop'],setup(){}};`);
  await assert.rejects(loadSite(root,{config:{...blog.site,plugins:['./loop.mjs']}}),{code:'PLUGIN_CYCLE'});
});
test('list cards keep article URLs inside home and generated pages', async t => {
  const root=fixture(t,{output:`export default {name:'output',apiVersion:1,setup(api){api.output('catalog/index.html',async c=>c.renderPage({title:'Catalog',html:await c.render('list')}));}};`});
  const blog=await loadSite(root);
  blog.posts.write('hello',{metadata:{title:'Article',draft:false},body:'Text'},null);
  assert.match(await blog.page(),/class="post-row" href="\/posts\/hello\/"/);
  assert.match(await blog.renderOutput('catalog/index.html'),/class="post-row" href="\/posts\/hello\/"/);
});

test('bundled runtime declarations consume the same manifest validated by the marketplace', async () => {
  const root = new URL('../packages/', import.meta.url);
  for (const directory of fs.readdirSync(root).filter(name => name !== 'core')) {
    const manifest = JSON.parse(fs.readFileSync(new URL(directory + '/plugin.json', root), 'utf8'));
    const plugin = (await import(new URL(directory + '/index.mjs', root))).default;
    for (const field of ['name','apiVersion','requires','optionalRequires','extends']) assert.deepEqual(plugin[field], manifest[field], directory + ':' + field);
  }
});
test('skins can wrap date and footer features without registering competing owners', async t => {
  const root = fixture(t, {skin:`export default {name:'skin',apiVersion:1,setup(api){api.component('date',async c=>'<b>'+await c.renderDefault('date')+'</b>');api.component('footer',async c=>'<section>'+await c.renderDefault('footer')+'</section>');}};`});
  const plugins=['date-format','footer'].map(name=>new URL('../packages/'+name+'/index.mjs',import.meta.url).pathname);
  const blog=await loadSite(root,{config:{version:1,title:'Test',plugins:['./skin.mjs',...plugins]}});
  const article=blog.posts.write('dated',{metadata:{title:'Dated',draft:false,date:'2026-10-15'},body:'Text'},null);
  const html=await blog.page(article);
  assert.match(html,/<b><time/);
  assert.match(html,/<section><footer>/);
});
