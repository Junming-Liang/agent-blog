import manifest from './plugin.json' with {type: 'json'};
/** @type {import('@agent-blog/core').Plugin} */
export default {
  ...manifest,
  description: 'A chronological archive with optional presentation of empty legacy archive pages.',
  optionsSchema: {type: 'object', properties: {title: {type: 'string'}, legacySlugs: {type: 'array', items: {type: 'string'}}}, additionalProperties: false},
  setup(api, options) {
    const {title = '归档', legacySlugs = []} = options, e = api.escapeHTML;
    if (typeof title !== 'string' || !title.trim() || !Array.isArray(legacySlugs) || legacySlugs.some(slug => typeof slug !== 'string' || !slug) || Object.keys(options).some(key => !['title', 'legacySlugs'].includes(key))) api.fail('INVALID_OPTION', 'archive accepts a nonempty title and legacySlugs array.');
    const articles = posts => posts.filter(post => !post.metadata.draft && (!post.metadata.type || post.metadata.type === 'post'));
    const list = (posts, permalink) => `<ul class="archive-list">${articles(posts).map(post => `<li><time datetime="${e(post.metadata.date || '')}">${e((post.metadata.date || '').slice(0, 10))}</time> <a href="${e(permalink(post))}">${e(post.metadata.title)}</a></li>`).join('')}</ul>`;
    api.output('archive/index.html', c => c.renderPage({title, html: list(c.posts, c.permalink)}));
    api.slot('navigation:items', () => `<a href="/archive/">${e(title)}</a>`);
    if (legacySlugs.length) api.transform(c => legacySlugs.includes(c.post.slug) && !c.post.body.trim() ? list(api.posts.list(), c.permalink) : c.html);
    api.slot('head:after', () => '<style>.archive-list{padding-left:1.25rem}.archive-list li{margin:.8rem 0}.archive-list time{font-variant-numeric:tabular-nums;font-size:.85em;color:var(--muted,#666);margin-right:.5rem}</style>');
  }
};
