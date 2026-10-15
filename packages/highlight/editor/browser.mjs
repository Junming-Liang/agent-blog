export function setup(api) {
  api.button({id: 'insert', label: "</>", title: "插入代码块", run: () => api.insert("\n```javascript\n", "\n```\n")});
}
