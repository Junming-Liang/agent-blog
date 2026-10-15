import manifest from './plugin.json' with {type: 'json'};
import {fileURLToPath} from 'node:url';

/** @type {import('@agent-blog/core').Plugin} */
export default {
  ...manifest,
  description: 'An unofficial Overwatch 2 inspired field journal: warm white, orange and tactical geometry.',
  setup(api) {
    const e = api.escapeHTML;
    api.layout(c => c.render('shell'), {unstyled: true});
    api.asset('/_assets/theme-overwatch', fileURLToPath(new URL('./public', import.meta.url)));
    api.stylesheet('/_assets/theme-overwatch/style.css');
    api.component('header', async c => `<header class="site-header"><a class="brand" href="/"><span class="ow-insignia" aria-hidden="true">Ⅱ</span><span>${e(c.site.title)}</span></a>${await c.slot('header:nav')}</header>`);
    api.component('intro', c => `<section class="intro ow-briefing"><div class="ow-intro-copy"><div class="eyebrow"><span aria-hidden="true">//</span> FIELD JOURNAL <span class="ow-edition">02</span></div><h1>${e(c.site.title)}</h1><p>${e(c.site.description || '把值得留下的想法，写成自己的文字。')}</p>${c.posts.length ? `<a class="ow-action" href="${e(c.permalink(c.posts[0]))}">开始阅读 <span aria-hidden="true">↗</span></a>` : ''}<div class="ow-caption">记录此刻 · 探索下一程</div></div><div class="ow-scene" aria-hidden="true"><img src="/_assets/theme-overwatch/field-station.svg" alt="" width="640" height="560"><div class="ow-scene-top">FIELD STATION <span>02 / 日志</span></div><div class="ow-scene-bottom"><span>新的视角<br><strong>新的可能。</strong></span><span class="ow-coordinate">25.0° N<br>55.0° E</span></div></div></section><div class="ow-section-label" aria-hidden="true"><span>最新记录</span><span>JOURNAL / ENTRIES</span></div>`);
  }
};
