/** @param {import('@agent-blog/editor/browser').EditorAPI} api */
export function setup(api) {
  const panel = document.createElement('div');
  panel.id = 'writing-tools-panel';
  api.mount('panels', panel);
  const label = document.createElement('label'); label.textContent = '系列 ';
  const series = document.createElement('input'); series.id = 'writing-tools-series'; series.placeholder = '可选的文章系列';
  label.append(series); api.mount('sidebar', label);
  series.addEventListener('input', () => api.updateDraft({metadata: {series: series.value}}));
  api.on('open', draft => {series.value = typeof draft?.metadata.series === 'string' ? draft.metadata.series : '';});
  api.on('change', draft => { panel.textContent = draft ? `当前正文 ${[...draft.body.replace(/\s/g, '')].length} 字符 · 统计包含未保存的修改` : ''; });
  api.button({id: 'quote', label: '引用', run: () => api.insert('\n> ', '\n')});
  api.button({id: 'stats', label: '统计', run: async () => {
    const draft = api.getDraft();
    if (!draft) return;
    const result = await api.command('writing-stats', {input: draft});
    panel.textContent = `Agent 命令返回：${result.characters} 字符，${result.lines} 行`;
  }});
}
