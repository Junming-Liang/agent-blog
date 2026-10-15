/** @param {import('@agent-blog/editor/browser').EditorAPI} api */
export function setup(api, {title = '说说'} = {}) {
  api.button({id: 'notes-new', label: `新建${title}`, location: 'topbar', run() {
    const date = new Date().toISOString();
    api.newPost({metadata: {type: 'note', title: `${title} ${date.slice(0, 10)}`, date}});
  }});
}
