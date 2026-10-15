import manifest from './plugin.json' with {type: 'json'};
import {fileURLToPath} from 'node:url';

/** @type {import('@agent-blog/core').Plugin} */
export default {
  ...manifest,
  description: 'Independent short notes, an index, agent commands and an optional editor button.',
  optionsSchema: {type: 'object', properties: {title: {type: 'string'}, homeLimit: {type: 'integer', minimum: 0}}, additionalProperties: false},
  setup(api, options) {
    const {title = '说说', homeLimit = 5} = options;
    if (typeof title !== 'string' || !title.trim() || !Number.isSafeInteger(homeLimit) || homeLimit < 0 || Object.keys(options).some(key => !['title', 'homeLimit'].includes(key))) api.fail('INVALID_OPTION', 'notes accepts a nonempty title and a nonnegative integer homeLimit.');
    const e = api.escapeHTML, isNote = post => post.metadata.type === 'note';
    api.indexFilter(post => !isNote(post));
    api.command({
      name: 'notes-new', description: 'Create a draft note without overwriting existing content.', arguments: ['slug'],
      flags: {title: {type: 'string', description: 'Optional note title'}}, stdin: 'text',
      run({args, flags, input}) {
        const date = new Date().toISOString();
        return api.posts.write(args[0], {metadata: {type: 'note', title: flags.title || `${title} ${date.slice(0, 10)}`, date, draft: true, tags: []}, body: input ?? ''}, null);
      }
    });
    api.command({name: 'notes-list', description: 'List notes, optionally including drafts.', flags: {drafts: {type: 'boolean'}}, run: ({flags}) => api.posts.list().filter(post => isNote(post) && (flags.drafts || !post.metadata.draft)).map(({body, ...post}) => post)});
    api.component('notes:card', async c => `<article class="notes-card"><a href="${e(c.permalink(c.post))}"><div class="post-date">${await c.render('date')}</div><h3>${e(c.post.metadata.title)}</h3></a><div class="prose">${await c.renderPost(c.post)}</div></article>`, {fallback: true});
    api.component('notes:list', async c => c.posts.length ? (await Promise.all(c.posts.map(post => c.render('notes:card', {post})))).join('') : '<p class="empty">还没有发布的说说。</p>', {fallback: true});
    api.slot('index:after', async c => {
      const posts = c.posts.filter(isNote).slice(0, homeLimit);
      return posts.length ? `<section class="notes-section"><h2><a href="/notes/">${e(title)}</a></h2>${await c.render('notes:list', {posts})}</section>` : '';
    });
    api.output('notes/index.html', async c => c.renderPage({title, html: await c.render('notes:list', {posts: c.posts.filter(isNote)})}));
    api.slot('navigation:items', () => `<a href="/notes/">${e(title)}</a>`);
    api.slot('head:after', () => '<style>.notes-section{margin-top:3rem}.notes-card{border-top:1px solid var(--line,#ddd);padding:1.5rem 0}.notes-card h3{font-size:1rem}.notes-card .prose{margin-top:1rem}</style>');
    const editor = api.optional('editor');
    if (editor) {
      api.asset('/_assets/notes', fileURLToPath(new URL('./public', import.meta.url)), {public: false});
      editor.register({name: 'notes', module: '/_assets/notes/browser.mjs', options: {title}});
    }
  }
};
