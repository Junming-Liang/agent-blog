import manifest from './plugin.json' with {type: 'json'};
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import TurndownService from 'turndown';
import {gfm} from 'turndown-plugin-gfm';

export const sourceHash = value => createHash('sha256').update(value).digest('hex');

export function wordpressMarkdown(html, home, {legacyOrigins = []} = {}) {
  const localHosts = new Set([home, ...legacyOrigins].map(value => {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw Error('WordPress origins must use HTTP or HTTPS.');
    return parsed.host;
  }));
  const converter = new TurndownService({
    headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-',
    blankReplacement: (content, node) => node.nodeName === 'PRE' ? codeBlock(content, node) : ['OBJECT', 'IFRAME', 'EMBED'].includes(node.nodeName) ? documentLink(content, node) : node.isBlock ? '\n\n' : ''
  });
  converter.use(gfm);
  const escape = converter.escape.bind(converter);
  // Keep TeX intact while retaining Turndown's escaping for ordinary prose.
  converter.escape = text => text.replace(/\[latex(?:\s+[^\]]*)?\]([\s\S]*?)\[\/latex\]/gi, (_all, tex) => `$${tex.trim()}$`)
    .split(/(\$\$[\s\S]*?\$\$|\$(?!\s)[^$\n]*?[^\s$]\$)/g).map((part, i) => i % 2 ? part : escape(part)).join('');
  const url = value => {
    try {
      const parsed = new URL(value, home);
      if (!['http:', 'https:'].includes(parsed.protocol) || !localHosts.has(parsed.host)) return value;
      const id = parsed.searchParams.get('p') || parsed.searchParams.get('page_id');
      if (parsed.pathname === '/' && /^[1-9][0-9]*$/.test(id || '')) return `/posts/wp-${id}/${parsed.hash}`;
      return parsed.pathname + parsed.search + parsed.hash;
    } catch { return value; }
  };
  const documentLink = (content, node) => {
    const src = node.getAttribute('data') || node.getAttribute('src');
    return content.trim() ? `\n\n${content}\n\n` : src ? `\n\n[查看附件](<${url(src).replace(/[<>\r\n]/g, c => encodeURIComponent(c))}>)\n\n` : '';
  };
  const codeBlock = (_content, node) => {
    const code = node.querySelector('code') || node;
    const match = /(?:language|lang)-([a-zA-Z0-9_+-]+)/.exec(code.className + ' ' + node.className);
    const text = child => child.nodeType === 3 ? child.nodeValue : child.nodeName === 'BR' ? '\n' : Array.from(child.childNodes).map(text).join('');
    const source = text(code).replace(/\n$/, '');
    const fences = source.match(/`+/g) || [];
    const fence = '`'.repeat(Math.max(3, ...fences.map(s => s.length + 1)));
    return `\n\n${fence}${match?.[1] || ''}\n${source}\n${fence}\n\n`;
  };
  converter.addRule('wordpressCode', {filter: 'pre', replacement: codeBlock});
  converter.addRule('wordpressLink', {
    filter: node => node.nodeName === 'A' && node.getAttribute('href'),
    replacement: (content, node) => `[${content || node.getAttribute('href')}](${url(node.getAttribute('href')).replace(/[<>\s]/g, c => encodeURIComponent(c))})`
  });
  converter.addRule('wordpressImage', {
    filter: 'img',
    replacement: (_content, node) => {
      const src = node.getAttribute('src');
      return src ? `![${(node.getAttribute('alt') || '').replace(/[\[\]]/g, '')}](<${url(src).replace(/[<>\r\n]/g, c => encodeURIComponent(c))}>)` : '';
    }
  });
  converter.addRule('wordpressDocument', {
    filter: ['object', 'iframe', 'embed'],
    replacement: documentLink
  });
  converter.remove(['script', 'style', 'svg', 'button']);
  // Code Block Pro stores the editable source separately from its generated, styled HTML.
  const prepared = html.replace(/<!-- wp:kevinbatdorf\/code-block-pro (\{[\s\S]*?\}) -->[\s\S]*?<!-- \/wp:kevinbatdorf\/code-block-pro -->/g, (original, attrs) => {
    const block = JSON.parse(attrs);
    if (typeof block.code !== 'string') return original;
    const language = block.language === 'shellscript' ? 'bash' : block.language;
    const className = typeof language === 'string' && /^[a-zA-Z0-9_+-]+$/.test(language) ? ` class="language-${language}"` : '';
    return `<pre><code${className}>${block.code.replace(/[&<>]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;'}[c]))}</code></pre>`;
  });
  return converter.turndown(prepared).trim() + '\n';
}

export function importWordPress(api, data, options = {}) {
  if (data.version !== 1 || !Array.isArray(data.posts) || typeof data.options?.home !== 'string') api.fail('INVALID_WORDPRESS_EXPORT', 'Expected a version 1 WordPress content export.');
  const existing = new Map(api.posts.list().map(post => [post.slug, post]));
  const plans = [], skipped = [];
  const seen = new Set();
  for (const row of data.posts.filter(row => ['post', 'page', 'shuoshuo'].includes(row.post_type))) {
    const id = String(row.ID);
    if (!/^[1-9][0-9]*$/.test(id) || seen.has(id) || typeof row.post_content !== 'string') api.fail('INVALID_WORDPRESS_EXPORT', 'Invalid or duplicate post ID.');
    seen.add(id);
    const slug = `wp-${id}`;
    const fingerprint = sourceHash(JSON.stringify(row));
    const current = existing.get(slug);
    if (current) {
      if (current.metadata.wordpress?.sourceHash !== fingerprint) api.fail('IMPORT_CONFLICT', `${slug}: source differs; merge manually. Existing content was left untouched.`);
      skipped.push(slug);
      continue;
    }
    const utc = row.post_date_gmt && row.post_date_gmt !== '0000-00-00 00:00:00' ? row.post_date_gmt.replace(' ', 'T') + 'Z' : null;
    const terms = (data.terms || []).filter(term => String(term.object_id) === id);
    const value = {
      metadata: {
        type: row.post_type === 'shuoshuo' ? 'note' : row.post_type,
        title: row.post_title.trim() || `未命名页面 ${id}`,
        draft: row.post_status !== 'publish' || Boolean(row.post_password),
        ...(utc ? {date: utc} : {}),
        tags: terms.filter(term => term.taxonomy === 'post_tag').map(term => term.name),
        categories: terms.filter(term => term.taxonomy === 'category').map(term => term.name),
        author: row.author || '',
        wordpress: {id: Number(id), type: row.post_type, status: row.post_status, slug: row.post_name, modified: row.post_modified_gmt, sourceHash: fingerprint, contentHash: sourceHash(row.post_content), passwordProtected: Boolean(row.post_password), url: `${data.options.home}/?${row.post_type === 'page' ? 'page_id' : 'p'}=${id}`}
      },
      body: wordpressMarkdown(row.post_content, data.options.home, options)
    };
    api.posts.validate(value);
    plans.push({slug, value});
  }
  // Validate the complete batch before the first write; an interrupted run can be resumed.
  for (const {slug, value} of plans) api.posts.write(slug, value, null);
  return {imported: plans.map(plan => plan.slug), skipped, preservedSourceRecords: data.posts.length};
}

export default {
  ...manifest,
  description: 'Import a read-only WordPress export as editable Markdown without overwriting existing posts.',
  optionsSchema: {type: 'object', properties: {legacyOrigins: {type: 'array', items: {type: 'string'}, description: 'Previous URLs of this WordPress installation; links become local paths.'}}},
  setup(api, options) {
    api.command({
      name: 'wordpress-import', description: 'Import the JSON produced by scripts/export-wordpress.php. Keep the source export private.',
      arguments: ['file'],
      run({args}) { return importWordPress(api, JSON.parse(fs.readFileSync(args[0], 'utf8')), options); }
    });
  }
};
