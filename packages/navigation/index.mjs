import manifest from './plugin.json' with {type: 'json'};
/** @type {import('@agent-blog/core').Plugin} */
export default {
  ...manifest,
  description: 'A header navigation slot composed from configured links and independent plugin contributions.',
  optionsSchema: {type: 'object', properties: {links: {type: 'array', items: {type: 'object', required: ['title', 'url'], properties: {title: {type: 'string'}, url: {type: 'string'}}, additionalProperties: false}}}, additionalProperties: false},
  setup(api, options) {
    const {links = [{title: '文章', url: '/'}]} = options, e = api.escapeHTML;
    if (Object.keys(options).some(key => key !== 'links') || !Array.isArray(links)) api.fail('INVALID_OPTION', 'navigation accepts an array of links.');
    for (const link of links) {
      if (!link || typeof link.title !== 'string' || !link.title.trim() || typeof link.url !== 'string' || Object.keys(link).some(key => !['title', 'url'].includes(key))) api.fail('INVALID_OPTION', 'Each navigation link needs a title and URL.');
      if (/[\s\\\x00-\x1f\x7f]/.test(link.url) || (!/^\/(?!\/)/.test(link.url) && !/^https?:\/\//i.test(link.url))) api.fail('INVALID_OPTION', 'Link URLs must use http(s) or a local absolute path.');
      try { new URL(link.url, 'https://blog.invalid'); } catch { api.fail('INVALID_OPTION', 'Invalid navigation URL.'); }
    }
    api.slot('header:nav', async c => `<nav class="blog-navigation" aria-label="主导航">${links.map(link => `<a href="${e(link.url)}">${e(link.title)}</a>`).join('')}${await c.slot('navigation:items')}</nav>`);
    api.slot('head:after', () => '<style>.site-header:has(.blog-navigation){height:auto;min-height:104px;flex-wrap:wrap;gap:1rem;padding:1.25rem 0}.blog-navigation{display:flex;flex-wrap:wrap;gap:.7rem 1rem;font-size:.85rem}.blog-navigation a:hover{color:var(--accent,currentColor)}@media(max-width:600px){.site-header:has(.blog-navigation){min-height:80px}.blog-navigation{flex-basis:100%}}</style>');
  }
};
