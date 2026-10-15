export function setup(api) {
  api.button({id: 'insert', label: "∑", title: "插入公式", run: () => api.insert("\n$$\n", "\n$$\n")});
}
