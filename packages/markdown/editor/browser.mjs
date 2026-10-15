export function setup(api) {
  api.button({id: 'insert', label: "B", title: "插入加粗", run: () => api.insert("**", "**")});
}
