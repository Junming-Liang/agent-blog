export function setup(api) {
  api.button({id: 'logout', label: '退出登录', location: 'topbar', async run() {
    if (api.isDirty() && !confirm('当前修改尚未保存，是否放弃修改并退出登录？')) return;
    const response = await fetch('/__auth/logout', {method: 'POST'});
    if (!response.ok) throw Error('退出失败，请稍后重试。');
    location.assign('/__auth/login');
  }});
}
