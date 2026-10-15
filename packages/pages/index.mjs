import manifest from './plugin.json' with {type: 'json'};
import {fileURLToPath} from 'node:url';

/** @type {import('@agent-blog/core').Plugin} */
export default {
  ...manifest,
  description: 'Standalone pages stored as ordinary content, with CLI and optional editor creation.',
  optionsSchema: {type: 'object', properties: {}, additionalProperties: false},
  setup(api, options) {
    if (Object.keys(options).length) api.fail('INVALID_OPTION', 'pages does not accept options.');
    const isPage = post => post.metadata.type === 'page';
    api.indexFilter(post => !isPage(post));
    api.command({
      name: 'pages-new', description: 'Create a draft standalone page without overwriting content.', arguments: ['slug'],
      flags: {title: {type: 'string', description: 'Page title'}}, stdin: 'text',
      run: ({args, flags, input}) => api.posts.write(args[0], {metadata: {type: 'page', title: flags.title || args[0], date: new Date().toISOString(), draft: true, tags: []}, body: input ?? ''}, null)
    });
    api.command({name: 'pages-list', description: 'List standalone pages, optionally including drafts.', flags: {drafts: {type: 'boolean'}}, run: ({flags}) => api.posts.list().filter(post => isPage(post) && (flags.drafts || !post.metadata.draft)).map(({body, ...post}) => post)});
    const editor = api.optional('editor');
    if (editor) {
      api.asset('/_assets/pages', fileURLToPath(new URL('./public', import.meta.url)), {public: false});
      editor.register({name: 'pages', module: '/_assets/pages/browser.mjs'});
    }
  }
};
