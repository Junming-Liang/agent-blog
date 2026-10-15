import {escapeHTML as e} from './content.mjs';

export const views = {
  async shell(c) {
    return `<!doctype html><html lang="${e(c.site.language || 'zh-CN')}"><head>${await c.render('head')}${await c.slot('head:after')}</head><body><div class="site-shell">${await c.render('header')}${await c.slot('header:after')}${c.post ? await c.render('article') : await c.render('index')}${await c.slot('footer:before')}${await c.render('footer')}</div></body></html>`;
  },
  head: c => `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(c.post ? `${c.post.metadata.title} · ${c.site.title}` : c.site.title)}</title>${c.styles.map(url => `<link rel="stylesheet" href="${e(url)}">`).join('')}`,
  header: c => `<header class="site-header"><a class="brand" href="/">${e(c.site.title)}</a><span>写作 · 思考 · 分享</span></header>`,
  async index(c) { return `<main>${await c.slot('index:before')}${await c.render('intro')}<div class="post-list">${c.html}</div>${await c.slot('index:after')}</main>`; },
  intro: c => `<div class="intro"><div class="eyebrow">PERSONAL NOTES</div><h1>${e(c.site.title)}</h1><p>${e(c.site.description || '把值得留下的想法，写成自己的文字。')}</p></div>`,
  async list(c) { return c.posts.length ? (await Promise.all(c.posts.map(post => c.render('card', {post})))).join('') : '<p class="empty">还没有发布的文章。</p>'; },
  card: c => `<a class="post-row" href="${e(c.permalink(c.post))}"><div class="post-date">${e(c.post.metadata.date || '')}</div><div><h2>${e(c.post.metadata.title)}</h2><p>${e(c.post.metadata.description || '')}</p><div class="tags">${(c.post.metadata.tags || []).map(e).join(' · ')}</div></div><span aria-hidden="true">↗</span></a>`,
  async article(c) { return `<main class="article"><a class="back" href="/">← 所有文章</a>${await c.render('metadata')}<h1>${e(c.post.metadata.title)}</h1>${await c.slot('post:before')}<div class="prose">${c.html}</div>${await c.slot('post:after')}</main>`; },
  metadata: c => `<div class="post-date">${e(c.post.metadata.date || '')}</div><div class="tags">${(c.post.metadata.tags || []).map(e).join(' · ')}</div>`,
  footer: () => '<footer>文字由你掌握。<span>Agent Blog</span></footer>'
};
