import manifest from './plugin.json' with {type: 'json'};
/** @type {import('@agent-blog/core').Plugin} */
export default {
  ...manifest,
  description: 'A configurable footer with independently owned text and links.',
  optionsSchema: {type: 'object', properties: {text: {type: 'string'}, links: {type: 'array', items: {type: 'object', required: ['title', 'url'], properties: {title: {type: 'string'}, url: {type: 'string'}}, additionalProperties: false}}}, additionalProperties: false},
  setup(api, options) {
    const {text = '文字由你掌握。', links = []} = options, e = api.escapeHTML;
    if (typeof text !== 'string' || !Array.isArray(links) || Object.keys(options).some(key => !['text', 'links'].includes(key))) api.fail('INVALID_OPTION', 'footer accepts text and links.');
    for (const link of links) {
      if (!link || typeof link.title !== 'string' || !link.title.trim() || typeof link.url !== 'string' || Object.keys(link).some(key => !['title', 'url'].includes(key))) api.fail('INVALID_OPTION', 'Each footer link needs a title and URL.');
      if (/[\s\\\x00-\x1f\x7f]/.test(link.url) || (!/^\/(?!\/)/.test(link.url) && !/^https?:\/\//i.test(link.url))) api.fail('INVALID_OPTION', 'Link URLs must use http(s) or a local absolute path.');
      try { new URL(link.url, 'https://blog.invalid'); } catch { api.fail('INVALID_OPTION', 'Invalid footer URL.'); }
    }
    api.component('footer', () => `<footer><span>${e(text)}</span><span>${links.map(link => `<a href="${e(link.url)}">${e(link.title)}</a>`).join(' · ')}</span></footer>`, {fallback: true});
  }
};
