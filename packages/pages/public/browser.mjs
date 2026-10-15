/** @param {import('@agent-blog/editor/browser').EditorAPI} api */
export function setup(api) {
  api.button({id: 'pages-new', label: '新建页面', location: 'topbar', run() {
    api.newPost({metadata: {type: 'page'}});
  }});
}
