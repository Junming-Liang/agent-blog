const form = document.querySelector('form'), message = document.getElementById('message');
if (form.dataset.mode === 'setup' && location.hash.length > 1) {
  form.elements.token.value = location.hash.slice(1);
  document.getElementById('token-field').hidden = true;
  history.replaceState(null, '', location.pathname);
}
form.addEventListener('submit', async event => {
  event.preventDefault();
  const button = form.querySelector('button');
  button.disabled = true; message.textContent = '正在验证…';
  try {
    const response = await fetch('/__auth/' + form.dataset.mode, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(Object.fromEntries(new FormData(form)))});
    const result = await response.json();
    if (!response.ok) throw Error(result.error?.message || '操作失败，请稍后重试。');
    form.reset(); location.assign(result.data.next);
  } catch (error) { message.textContent = error.message; }
  finally { button.disabled = false; }
});
