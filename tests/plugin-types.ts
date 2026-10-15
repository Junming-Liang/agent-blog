import type {Plugin, PluginAPI} from '@agent-blog/core';
const plugin: Plugin = {
  name: 'typed-extension', apiVersion: 1, requires: ['markdown'],
  setup(api) {
    api.command({name: 'typed-extension', description: 'Inspect metadata', arguments: ['slug'], run: ({args}) => api.posts.read(args[0]).metadata});
    api.transform(({html, post}) => html + api.escapeHTML(post.metadata.title));
    api.output('feed.json', ({posts}) => JSON.stringify(posts.map(post => post.metadata)));
    api.layout(({html, styles}) => '<html>' + styles.join(',') + html + '</html>');
    api.route('/typed', async ({req, res, readJSON, json}) => {
      const input = api.posts.validate(await readJSON(req));
      json(res, 200, {title: input.metadata.title});
    });
  }
};
void plugin;
function invalidContracts(api: PluginAPI) {
  // @ts-expect-error renderers must produce strings
  api.renderer(() => 42);
  // @ts-expect-error writes require a revision
  api.posts.write('hello', {metadata: {title: 'Hello', draft: true}, body: ''});
}
void invalidContracts;

import type {EditorService} from '@agent-blog/editor';
import type {EditorExtension} from '@agent-blog/editor/browser';
const cells: Plugin = {
  name: 'typed-cells', apiVersion: 1, optionalRequires: ['editor'],
  setup(api) {
    api.codec({extension: '.json', decode: (_slug, source) => JSON.parse(source), encode: input => JSON.stringify(input)});
    api.validator(input => { if (input.metadata.series === false) api.fail('SERIES', 'Invalid series'); });
    api.component('footer', context => context.renderDefault('footer'));
    api.slot('post:after', context => context.post?.metadata.title || '');
    api.permalink(post => '/notes/' + encodeURIComponent(post.slug) + '/');
    api.builder(({build}) => build());
    api.middleware((_context, next) => next());
    api.commandMiddleware((_context, next) => next());
    api.on('post:written', ({post}) => { void post.revision; });
    api.indexFilter(post => post.metadata.type !== 'page');
    api.component('custom:card', context => context.html, {fallback: true});
    api.output('custom/index.html', context => context.renderPage({title: 'Custom', html: 'Custom'}));
    const editor = api.optional<EditorService>('editor');
    editor?.register({name: 'typed-ui', module: '/_assets/typed-ui/browser.mjs'});
    // @ts-expect-error event names are explicit
    api.on('post:unknown', () => {});
    // @ts-expect-error async raw storage does not meet the synchronous adapter contract
    api.storage({read: async () => null, list: () => [], write() {}, remove() {}});
  }
};
const browser: EditorExtension = {setup(api) {
  api.button({id: 'custom', label: 'Custom', run: () => api.insert('**', '**')});
  api.mount('panels', document.createElement('div'));
  api.newPost({metadata: {type: 'note'}});
  void api.getSite().root;
  api.updateDraft({metadata: {series: 'My series'}});
  api.on('saved', draft => {void draft?.revision;});
  // @ts-expect-error unknown editor mount points are rejected
  api.mount('unknown', document.createElement('div'));
}};
void cells; void browser;
