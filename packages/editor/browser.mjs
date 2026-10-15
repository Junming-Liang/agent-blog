import {EditorState, StateEffect, Compartment} from '@codemirror/state';
import {EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter} from '@codemirror/view';
import {history, defaultKeymap, historyKeymap} from '@codemirror/commands';
import {syntaxHighlighting} from '@codemirror/language';

const editorListeners = new Map(), extraExtensions = [];
const $ = id => document.getElementById(id);
let active = null, saved = '', siteRoot = '', saving = false, previewSequence = 0, openSequence = 0, previewTimer;
const extensions = [lineNumbers(), highlightActiveLine(), highlightActiveLineGutter(), history(), keymap.of([{key: 'Mod-s', run: () => {save(); return true;}}, ...defaultKeymap, ...historyKeymap]), EditorView.lineWrapping, EditorView.updateListener.of(update => {if (update.docChanged) changed();})];
const editor = new EditorView({parent: $('editor'), state: EditorState.create({extensions})});
function metadata() {
  const originalDate = active?.metadata.date;
  const date = originalDate?.slice(0, 10) === $('date').value ? originalDate : $('date').value || undefined;
  return {...(active?.metadata || {}), title: $('title').value, date, description: $('description').value, tags: $('tags').value.split(/[,，]/).map(tag => tag.trim()).filter(Boolean), draft: active?.metadata.draft ?? true};
}
function snapshot() { return JSON.stringify({slug: $('slug').value, metadata: metadata(), body: editor.state.doc.toString()}); }
function dirty() { return !!active && snapshot() !== saved; }
function status(message, error = false) { $('save-status').textContent = message; $('save-status').classList.toggle('error', error); }
async function request(route, options = {}) {
  const response = await fetch('/__editor/api/' + route, {...options, headers: {...options.headers, ...(options.body ? {'Content-Type': 'application/json'} : {})}});
  const value = await response.json();
  if (!response.ok) { const error = Error(value.error?.message || '请求失败'); error.code = value.error?.code; throw error; }
  return value;
}
function notifyEditor(name, value) {
  for (const handler of editorListeners.get(name) || []) Promise.resolve().then(() => handler(structuredClone(value))).catch(error => status('扩展执行失败：' + error.message, true));
}
function getDraft() { return active ? structuredClone({slug: $('slug').value, revision: active.revision, metadata: metadata(), body: editor.state.doc.toString()}) : null; }
function changed() {
  if (!active) return;
  notifyEditor('change', getDraft());
  if (!saving) status(dirty() ? '有未保存的修改' : '已保存');
  $('word-count').textContent = `${editor.state.doc.length} 字符`;
  const sequence = ++previewSequence;
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => preview(sequence), 250);
}
async function preview(sequence) {
  try {
    const value = await request('preview', {method: 'POST', body: JSON.stringify({metadata: {...metadata(), title: metadata().title || '未命名文章'}, body: editor.state.doc.toString()})});
    if (sequence === previewSequence) $('preview').srcdoc = value.data;
  } catch (error) { if (sequence === previewSequence) status('预览失败：' + error.message, true); }
}
async function refreshList() {
  const value = await request('posts');
  siteRoot = value.site.root; $('site-title').textContent = value.site.title; $('post-count').textContent = value.data.length;
  $('post-list').replaceChildren();
  for (const post of value.data) {
    const button = document.createElement('button'); button.className = 'post-item'; button.dataset.slug = post.slug;
    button.classList.toggle('selected', post.slug === active?.slug);
    const title = document.createElement('strong'); title.textContent = post.metadata.title;
    const subtitle = document.createElement('small'); subtitle.textContent = `${post.metadata.draft ? '草稿' : '已发布'} · ${post.metadata.date || ''}`;
    button.append(title, subtitle); button.addEventListener('click', () => openPost(post.slug)); $('post-list').append(button);
  }
  return value.data;
}
function setPost(post) {
  active = post;
  $('title').value = post.metadata.title; $('slug').value = post.slug; $('slug').readOnly = !!post.revision;
  $('date').value = (post.metadata.date || new Date().toISOString()).slice(0, 10);
  $('tags').value = (post.metadata.tags || []).join(', '); $('description').value = post.metadata.description || '';
  editor.setState(EditorState.create({doc: post.body, extensions: [...extensions, ...extraExtensions]}));
  saved = snapshot(); changed(); updateState(); notifyEditor('open', getDraft());
}
function updateState() {
  $('article-status').textContent = active.metadata.draft ? '草稿' : '已发布';
  $('publish-post').textContent = active.metadata.draft ? '发布文章' : '转为草稿';
  document.querySelectorAll('.post-item').forEach(item => item.classList.toggle('selected', item.dataset.slug === active.slug));
}
async function openPost(slug, force = false) {
  if (saving) return;
  if (!force && dirty() && !confirm('当前修改还没有保存，是否放弃修改并打开另一篇文章？')) return;
  const sequence = ++openSequence;
  try { const post = (await request('posts/' + encodeURIComponent(slug))).data; if (sequence === openSequence) setPost(post); } catch (error) { if (sequence === openSequence) status(error.message, true); }
}
function newPost(input = {}) {
  if (saving || (dirty() && !confirm('当前修改还没有保存，是否放弃修改并新建文章？'))) return false;
  openSequence++;
  const slug = 'note-' + Date.now().toString(36);
  setPost({slug, revision: null, metadata: {title: '', date: new Date().toISOString().slice(0, 10), tags: [], ...structuredClone(input.metadata || {}), draft: true}, body: input.body || ''});
  $('title').focus();
  return true;
}
async function save(draft = active?.metadata.draft) {
  if (!active || saving) return;
  const slug = $('slug').value;
  const submittedMetadata = structuredClone(metadata());
  const payload = {metadata: {...submittedMetadata, draft}, body: editor.state.doc.toString(), revision: active.revision};
  if (!payload.metadata.title.trim()) { status('请先填写文章标题', true); $('title').focus(); return; }
  saving = true; $('save-post').disabled = true; $('publish-post').disabled = true; $('slug').disabled = true; status('正在保存…');
  try {
    const reply = await request('posts/' + encodeURIComponent(slug), {method: 'PUT', body: JSON.stringify(payload)});
    const result = reply.data;
    const currentMetadata = metadata(), mergedMetadata = {...result.metadata};
    for (const key of new Set([...Object.keys(submittedMetadata), ...Object.keys(currentMetadata)])) {
      if (JSON.stringify(currentMetadata[key]) !== JSON.stringify(submittedMetadata[key])) {
        if (Object.hasOwn(currentMetadata, key)) mergedMetadata[key] = currentMetadata[key];
        else delete mergedMetadata[key];
      }
    }
    active = {...result, metadata: mergedMetadata}; $('slug').readOnly = true;
    saved = JSON.stringify({slug, metadata: result.metadata, body: result.body});
    updateState(); await refreshList();
    status(dirty() ? '已保存提交的版本，新的修改尚未保存' : result.metadata.draft ? '草稿已保存' : '文章已发布');
    if (reply.warnings?.length) status('文章已保存；扩展执行失败：' + reply.warnings.map(w => w.message).join('；'), true);
    notifyEditor('saved', result);
  } catch (error) { status(error.code === 'CONFLICT' ? '文件已被 Agent 或本地编辑器修改。文字已保留，可点击「复制给 Agent」协助合并。' : error.code ? error.message : '保存结果未确认。文字已保留，请核对最新文件后再保存。', true); }
  finally { saving = false; $('save-post').disabled = false; $('publish-post').disabled = false; $('slug').disabled = false; }
}
function insert(before, after = '') {
  const {from, to} = editor.state.selection.main;
  const selected = editor.state.sliceDoc(from, to);
  editor.dispatch({changes: {from, to, insert: before + selected + after}, selection: {anchor: from + before.length, head: from + before.length + selected.length}}); editor.focus();
}
for (const id of ['title', 'slug', 'date', 'tags', 'description']) $(id).addEventListener('input', changed);
$('new-post').addEventListener('click', () => newPost());
$('save-post').addEventListener('click', () => save());
$('publish-post').addEventListener('click', () => save(!active.metadata.draft));
$('reload-post').addEventListener('click', () => {if (active?.revision) openPost(active.slug);});
window.addEventListener('beforeunload', event => {if (dirty()) {event.preventDefault(); event.returnValue = '';}});
async function loadExtensions() {
  const manifest = (await request('extensions')).data, failures = [];
  for (const entry of manifest) {
    const cleanups = [], compartment = new Compartment(), values = [];
    let extensionConfig = compartment.of([]);
    try {
      if (entry.stylesheet) {
        const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = entry.stylesheet; document.head.append(link);
        cleanups.push(() => link.remove());
      }
      if (!entry.module) continue;
      const extension = await import(entry.module);
      if (typeof extension.setup !== 'function') throw Error('编辑器扩展需要导出 setup');
      extraExtensions.push(extensionConfig);
      editor.dispatch({effects: StateEffect.appendConfig.of(extensionConfig)});
      const slots = {toolbar: document.querySelector('.format-actions'), sidebar: $('extension-sidebar'), panels: $('extension-panels'), topbar: document.querySelector('.top-actions')};
      const api = Object.freeze({
        editor, getDraft, newPost, insert, save, status, isDirty: dirty,
        getSite: () => ({root: siteRoot, title: $('site-title').textContent}),
        codemirror: {EditorState, EditorView, StateEffect, keymap, syntaxHighlighting},
        updateDraft(patch) {
          if (!active) return;
          if (patch.metadata) {
            const value = {...metadata(), ...patch.metadata}; active.metadata = value;
            $('title').value = value.title; $('date').value = value.date?.slice(0, 10) || '';
            $('tags').value = (value.tags || []).join(', '); $('description').value = value.description || '';
          }
          if (typeof patch.body === 'string') editor.dispatch({changes: {from: 0, to: editor.state.doc.length, insert: patch.body}});
          changed(); updateState();
        },
        mount(location, node) {
          if (!slots[location] || !(node instanceof HTMLElement)) throw Error('无效的编辑器插槽或元素');
          slots[location].append(node);
          const remove = () => node.remove(); cleanups.push(remove); return remove;
        },
        button({id, label, title = label, location = 'toolbar', run}) {
          if (!/^[a-z][a-z0-9-]*$/.test(id) || typeof label !== 'string') throw Error('扩展按钮需要有效的 id 和标签');
          const button = document.createElement('button'); button.id = `extension-${entry.name}-${id}`;
          if (document.getElementById(button.id) || typeof run !== 'function') throw Error('扩展按钮需要唯一 id 和操作');
          button.textContent = label; button.title = title;
          button.addEventListener('click', async () => {button.disabled = true; try {await run();} catch (error) {status(error.message, true);} finally {button.disabled = false;}});
          api.mount(location, button); return button;
        },
        extension(value) {
          values.push(value);
          const index = extraExtensions.indexOf(extensionConfig);
          extensionConfig = compartment.of([...values]);
          extraExtensions[index] = extensionConfig;
          editor.dispatch({effects: compartment.reconfigure([...values])});
        },
        on(name, handler) {
          if (!['open', 'change', 'saved'].includes(name) || typeof handler !== 'function') throw Error('无效的编辑器事件');
          if (!editorListeners.has(name)) editorListeners.set(name, new Set());
          editorListeners.get(name).add(handler);
          const remove = () => editorListeners.get(name).delete(handler); cleanups.push(remove); return remove;
        },
        async command(name, invocation = {}) {
          const reply = await request('commands/' + encodeURIComponent(name), {method: 'POST', body: JSON.stringify(invocation)});
          if (reply.warnings?.length) status('命令已完成；扩展执行失败：' + reply.warnings.map(w => w.message).join('；'), true);
          return reply.data;
        }
      });
      await extension.setup(api, entry.options || {});
    } catch (error) {
      for (const cleanup of cleanups.reverse()) cleanup();
      const index = extraExtensions.indexOf(extensionConfig);
      if (index >= 0) extraExtensions.splice(index, 1);
      editor.dispatch({effects: compartment.reconfigure([])});
      failures.push(`扩展 ${entry.name} 加载失败：${error.message}`);
    }
  }
  return failures;
}
try { const failures = await loadExtensions(); const posts = await refreshList(); if (posts.length) await openPost(posts[0].slug); else newPost(); if (failures.length) status(failures.join('；'), true); } catch (error) {status(error.message, true);}
