import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {loadSite, serve, build} from '../packages/core/index.mjs';

const module = name => fileURLToPath(new URL(`../packages/${name}/index.mjs`, import.meta.url));
const password = 'A private test passphrase 2026!';
async function fixture(t, {editor = true, origin} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-blog-auth-'));
  fs.mkdirSync(path.join(root, 'content'));
  fs.mkdirSync(path.join(root, 'private-assets'));
  fs.writeFileSync(path.join(root, 'private-assets/secret.txt'), 'private asset');
  fs.writeFileSync(path.join(root, 'routes.mjs'), `export default {name:'test-routes',apiVersion:1,setup(api){api.route('/private',({res,html})=>html(res,'private route'));api.route('/public',({res,html})=>html(res,'public route'),{public:true});api.asset('/_assets/private',${JSON.stringify(path.join(root, 'private-assets'))},{public:false});}};`);
  const config = {version: 1, title: 'Independent login', plugins: ['./routes.mjs', {use: module('auth'), options: origin ? {origin} : {}}, ...(editor ? [module('editor')] : [])]};
  fs.writeFileSync(path.join(root, 'blog.json'), JSON.stringify(config));
  const blog = await loadSite(root), server = await serve(blog, {port: 0});
  const base = 'http://127.0.0.1:' + server.address().port;
  t.after(async () => { await new Promise(resolve => server.close(resolve)); fs.rmSync(root, {recursive: true, force: true}); });
  const post = (url, value, cookie) => fetch(base + url, {method: 'POST', headers: {'Content-Type': 'application/json', Origin: base, ...(origin ? {'X-Agent-Blog-Origin': origin, 'X-Agent-Blog-Client': 'test-client'} : {}), ...(cookie ? {Cookie: cookie} : {})}, body: JSON.stringify(value)});
  const setup = async () => {
    const link = await blog.execute('auth-setup');
    const token = new URL(link.url, base).hash.slice(1);
    const response = await post('/__auth/setup', {token, username: 'owner', password});
    assert.equal(response.status, 200, await response.clone().text());
    return response.headers.get('set-cookie').split(';')[0];
  };
  return {root, config, blog, server, base, post, setup};
}

test('standalone auth protects private routes and assets while keeping public output independent', async t => {
  const {root, blog, base} = await fixture(t, {editor: false});
  assert.equal((await fetch(base + '/')).status, 200);
  assert.equal((await fetch(base + '/public')).status, 200);
  assert.equal((await fetch(base + '/private')).status, 401);
  assert.equal((await fetch(base + '/_assets/private/secret.txt')).status, 401);
  assert.equal((await fetch(base + '/_assets/auth/login.js')).status, 200);
  const html = await (await fetch(base + '/__auth/setup')).text();
  assert.ok(!/wordpress|wp-login|php/i.test(html));
  assert.deepEqual(await blog.execute('auth-status'), {configured: false, setupPending: false});
  await build(blog);
  assert.ok(!fs.existsSync(path.join(root, 'dist/.auth')));
  assert.ok(!fs.existsSync(path.join(root, 'dist/_assets/private')));
});

test('one-time setup, independent login, authenticated editing and logout work without WordPress', async t => {
  const {root, blog, base, post, setup} = await fixture(t);
  const source = blog.posts.write('draft', {metadata: {title: 'Private draft', draft: true, custom: {keep: true}}, body: 'Original'}, null);
  const redirect = await fetch(base + '/__editor/', {redirect: 'manual'});
  assert.equal(redirect.status, 302);
  assert.equal(redirect.headers.get('location'), '/__auth/setup');
  const cookie = await setup();
  const stored = fs.readFileSync(path.join(root, '.auth/credentials.json'), 'utf8');
  assert.ok(!stored.includes(password));
  assert.equal(fs.statSync(path.join(root, '.auth/credentials.json')).mode & 0o777, 0o600);
  assert.equal(fs.statSync(path.join(root, '.auth')).mode & 0o777, 0o700);
  assert.ok(!fs.existsSync(path.join(root, '.auth/bootstrap.json')));
  await assert.rejects(blog.execute('auth-setup'), {code: 'AUTH_CONFIGURED'});
  assert.equal((await post('/__auth/setup', {token: 'old', username: 'other', password})).status, 409);
  const response = await fetch(base + '/__editor/api/posts/draft', {headers: {Cookie: cookie}});
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).data.metadata.custom, {keep: true});
  const saved = await fetch(base + '/__editor/api/posts/draft', {method: 'PUT', headers: {Cookie: cookie, Origin: base, 'Content-Type': 'application/json'}, body: JSON.stringify({metadata: source.metadata, body: 'Saved independently', revision: source.revision})});
  assert.equal(saved.status, 200);
  assert.equal(blog.posts.read('draft').body, 'Saved independently');
  assert.equal((await fetch(base + '/posts/draft/')).status, 404);
  assert.equal((await post('/__auth/logout', {}, cookie)).status, 200);
  assert.equal((await fetch(base + '/__editor/api/posts', {headers: {Cookie: cookie}})).status, 401);
  const login = await post('/__auth/login', {username: 'owner', password});
  assert.equal(login.status, 200);
  assert.match(login.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
  const renewed = login.headers.get('set-cookie').split(';')[0];
  assert.equal((await fetch(base + '/private', {headers: {Cookie: renewed}})).status, 200);
});

test('setup rejects missing origin, invalid or expired tokens and concurrent claims', async t => {
  const {root, blog, base, post} = await fixture(t);
  const first = await blog.execute('auth-setup'), second = await blog.execute('auth-setup');
  const oldToken = new URL(first.url, base).hash.slice(1), token = new URL(second.url, base).hash.slice(1);
  assert.equal((await fetch(base + '/__auth/setup', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({token, username: 'owner', password})})).status, 403);
  assert.equal((await post('/__auth/setup', {token: oldToken, username: 'owner', password})).status, 403);
  const pendingFile = path.join(root, '.auth/bootstrap.json'), pending = JSON.parse(fs.readFileSync(pendingFile));
  fs.writeFileSync(pendingFile, JSON.stringify({...pending, expiresAt: 'invalid'}));
  assert.equal((await post('/__auth/setup', {token, username: 'owner', password})).status, 403);
  fs.writeFileSync(pendingFile, JSON.stringify(pending));
  const claims = await Promise.all([post('/__auth/setup', {token, username: 'owner', password}), post('/__auth/setup', {token, username: 'other', password})]);
  assert.deepEqual(claims.map(response => response.status).sort(), [200, 409]);
  assert.equal((await blog.execute('auth-status')).configured, true);
});

test('sessions expire, restart clears them and invalid credential files fail closed', async t => {
  const {root, config, base, setup} = await fixture(t), cookie = await setup();
  const reopened = await loadSite(root, {config}), server = await serve(reopened, {port: 0});
  t.after(() => new Promise(resolve => server.close(resolve)));
  const next = 'http://127.0.0.1:' + server.address().port;
  assert.equal((await fetch(next + '/private', {headers: {Cookie: cookie}})).status, 401);
  const now = Date.now();
  t.mock.method(Date, 'now', () => now + 9 * 60 * 60 * 1000);
  assert.equal((await fetch(base + '/private', {headers: {Cookie: cookie}})).status, 401);
  t.mock.restoreAll();
  fs.chmodSync(path.join(root, '.auth/credentials.json'), 0o644);
  assert.equal((await fetch(base + '/private', {headers: {Cookie: cookie}})).status, 503);
  assert.equal((await fetch(base + '/public')).status, 200);
});

test('HTTPS proxy preserves original-origin validation and host-only secure cookies', async t => {
  const {base, post, setup} = await fixture(t, {origin: 'https://blog.example'});
  const cookie = await setup();
  const login = await post('/__auth/login', {username: 'owner', password});
  assert.equal(login.status, 200);
  assert.match(login.headers.get('set-cookie'), /^__Host-agent_blog_session=.*; Path=\/; HttpOnly; SameSite=Strict; Max-Age=28800; Secure$/);
  const forbidden = await fetch(base + '/__auth/logout', {method: 'POST', headers: {Origin: base, Cookie: cookie, 'X-Agent-Blog-Origin': 'https://attacker.example'}});
  assert.equal(forbidden.status, 403);
  const missing = await fetch(base + '/__editor/api/posts/anything', {method: 'PUT', headers: {Origin: base, Cookie: cookie, 'Content-Type': 'application/json'}, body: '{}'});
  assert.equal(missing.status, 403);
});

test('repeated login attempts are bounded and never grant a session', async t => {
  const {post, setup} = await fixture(t);
  await setup();
  for (let attempt = 0; attempt < 5; attempt++) assert.equal((await post('/__auth/login', {username: 'owner', password: 'wrong'})).status, 401);
  const limited = await post('/__auth/login', {username: 'owner', password});
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get('set-cookie'), null);
});
