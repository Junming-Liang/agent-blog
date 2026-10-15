import manifest from './plugin.json' with {type: 'json'};
/** @type {import('@agent-blog/core').Plugin} */
export default {
  ...manifest,
  description: 'Display content dates in a chosen locale and time zone without rewriting source metadata.',
  optionsSchema: {type: 'object', properties: {locale: {type: 'string'}, timeZone: {type: 'string'}}, additionalProperties: false},
  setup(api, options) {
    const {locale = 'zh-CN', timeZone = 'Asia/Shanghai'} = options;
    if (typeof locale !== 'string' || typeof timeZone !== 'string' || Object.keys(options).some(key => !['locale', 'timeZone'].includes(key))) api.fail('INVALID_OPTION', 'date-format accepts locale and timeZone strings.');
    let format;
    try { format = new Intl.DateTimeFormat(locale, {timeZone, year: 'numeric', month: '2-digit', day: '2-digit'}); }
    catch { api.fail('INVALID_OPTION', 'Use a valid locale and IANA time zone.'); }
    api.component('date', c => {
      const value = c.post?.metadata.date;
      if (!value) return '';
      const date = new Date(value);
      return `<time datetime="${api.escapeHTML(value)}">${api.escapeHTML(format.format(date))}</time>`;
    }, {fallback: true});
  }
};
