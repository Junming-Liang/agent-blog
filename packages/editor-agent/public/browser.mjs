export function setup(api) {
  api.button({id: 'context', label: '复制给 Agent', location: 'topbar', async run() {
    const draft = api.getDraft(), site = api.getSite();
  if (!draft?.revision) return api.status('先保存文章，再把上下文交给 Agent。');
  const context = {site: site.root, slug: draft.slug, revision: draft.revision, unsavedChanges: api.isDirty(), draft: {metadata: draft.metadata, body: draft.body}, discover: ['agent-blog', 'schema', '--site', site.root, '--json'], read: ['agent-blog', 'get', draft.slug, '--site', site.root, '--json'], write: ['agent-blog', 'put', draft.slug, '--site', site.root, '--stdin', '--if-revision', draft.revision, '--json'], instructions: ['Read the latest file before writing; its revision may have changed.', 'Preserve custom metadata.', 'Merge this editor draft with the latest file; never overwrite a conflict.', 'Use the latest read revision when writing.', 'Ask the user what change they want.']};
  try { await navigator.clipboard.writeText(JSON.stringify(context, null, 2)); api.status('已复制文章上下文，可粘贴给 Agent。'); } catch { api.status('浏览器没有授予剪贴板权限。', true); }
  }});
}
