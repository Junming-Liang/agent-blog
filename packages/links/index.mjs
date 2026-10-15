import manifest from './plugin.json' with {type: 'json'};
/** @type {import('@agent-blog/core').Plugin} */
export default {
  ...manifest,
  description: 'A standalone links page and optional empty legacy page presentation.',
  optionsSchema: {type: 'object', properties: {title: {type: 'string'}, links: {type: 'array', items: {type: 'object', required: ['title', 'url'], properties: {title: {type: 'string'}, url: {type: 'string'}}, additionalProperties: false}}, legacySlugs: {type: 'array', items: {type: 'string'}}}, additionalProperties: false},
  setup(api, options) {
    const {title = '友情链接', links = [], legacySlugs = []} = options, e = api.escapeHTML;
    if (typeof title !== 'string' || !title.trim() || !Array.isArray(links) || !Array.isArray(legacySlugs) || legacySlugs.some(slug => typeof slug !== 'string' || !slug) || Object.keys(options).some(key => !['title', 'links', 'legacySlugs'].includes(key))) api.fail('INVALID_OPTION', 'links accepts title, links and legacySlugs.');
    for (const link of links) {
      if (!link || typeof link.title !== 'string' || !link.title.trim() || typeof link.url !== 'string' || Object.keys(link).some(key => !['title', 'url'].includes(key))) api.fail('INVALID_OPTION', 'Each link needs a title and URL.');
      if (/[\s\\\x00-\x1f\x7f]/.test(link.url) || (!/^\/(?!\/)/.test(link.url) && !/^https?:\/\//i.test(link.url))) api.fail('INVALID_OPTION', 'Link URLs must use http(s) or a local absolute path.');
      try { new URL(link.url, 'https://blog.invalid'); } catch { api.fail('INVALID_OPTION', 'Invalid link URL.'); }
    }
    const list = () => `<ul class="blog-links">${links.map(link => `<li><a href="${e(link.url)}">${e(link.title)}</a></li>`).join('')}</ul>`;
    api.output('links/index.html', c => c.renderPage({title, html: list()}));
    api.slot('navigation:items', () => `<a href="/links/">${e(title)}</a>`);
    if (legacySlugs.length) api.transform(c => legacySlugs.includes(c.post.slug) && !c.post.body.trim() ? list() : c.html);
  }
};
