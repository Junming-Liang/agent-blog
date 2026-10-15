import manifest from './plugin.json' with {type: 'json'};
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash, randomBytes, pbkdf2, timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';

const derive = promisify(pbkdf2), iterations = 600000;
const hash = value => createHash('sha256').update(value).digest('hex');
const equal = (a, b) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const matches = (pathname, prefix) => pathname === prefix || pathname.startsWith(prefix + '/');
const lifetime = 8 * 60 * 60 * 1000;

/** @type {import('@agent-blog/core').Plugin} */
export default {
  ...manifest,
  description: 'Independent owner login, one-time setup and private plugin route protection.',
  optionsSchema: {type: 'object', properties: {origin: {type: 'string', description: 'Canonical HTTPS origin behind the documented loopback proxy.'}}, additionalProperties: false},
  setup(api, options) {
    if (Object.keys(options).some(key => key !== 'origin')) api.fail('INVALID_OPTION', 'auth only accepts origin.');
    let canonical;
    if (options.origin !== undefined) {
      try { canonical = new URL(options.origin); } catch { api.fail('INVALID_OPTION', 'Use an HTTPS origin.'); }
      if (canonical.origin !== options.origin || canonical.protocol !== 'https:') api.fail('INVALID_OPTION', 'Use an HTTPS origin without a path or credentials.');
    }
    const secure = !!canonical, cookieName = secure ? '__Host-agent_blog_session' : 'agent_blog_session';
    const directory = path.join(api.site.root, '.auth');
    fs.mkdirSync(directory, {mode: 0o700, recursive: true});
    if (!fs.lstatSync(directory).isDirectory()) api.fail('AUTH_CONFIG', '.auth must be a real directory.', 503);
    fs.chmodSync(directory, 0o700);
    function read(name) {
      const file = path.join(directory, name + '.json');
      if (!fs.existsSync(file)) return null;
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || (stat.mode & 0o077)) api.fail('AUTH_CONFIG', 'Auth state must be a private regular file.', 503);
      try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { api.fail('AUTH_CONFIG', 'Invalid auth state.', 503); }
    }
    function credentials() {
      const value = read('credentials');
      if (value && (value.version !== 1 || typeof value.username !== 'string' || !/^[a-f0-9]{32}$/.test(value.salt || '') || !/^[a-f0-9]{64}$/.test(value.hash || '') || value.iterations !== iterations)) api.fail('AUTH_CONFIG', 'Invalid credentials state.', 503);
      return value;
    }
    function write(name, value) {
      const file = path.join(directory, name + '.json'), temporary = file + '.' + randomBytes(8).toString('hex');
      try {
        fs.writeFileSync(temporary, JSON.stringify(value) + '\n', {mode: 0o600, flag: 'wx'});
        fs.renameSync(temporary, file);
      } finally { fs.rmSync(temporary, {force: true}); }
    }
    function locked(operation) {
      const lock = path.join(directory, 'lock');
      try { fs.mkdirSync(lock, {mode: 0o700}); } catch (error) { if (error.code === 'EEXIST') api.fail('AUTH_BUSY', 'Another setup operation is running. Retry.', 409); throw error; }
      try { return operation(); } finally { fs.rmdirSync(lock); }
    }
    // Sessions are local to the editing process; restarting it signs everyone out.
    const sessions = new Map(), attempts = new Map();
    let deriving = 0;
    function cookie(token, seconds) { return `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${seconds}${secure ? '; Secure' : ''}`; }
    function session(req, record) {
      const cookies = (req.headers.cookie || '').split(/;\s*/).filter(value => value.startsWith(cookieName + '='));
      if (cookies.length !== 1 || !record) return null;
      const token = cookies[0].slice(cookieName.length + 1), key = hash(token), value = sessions.get(key);
      if (!value) return null;
      if (value.expires <= Date.now() || value.credentials !== hash(JSON.stringify(record))) { sessions.delete(key); return null; }
      return key;
    }
    function signedIn(res, record) {
      for (const [key, value] of sessions) if (value.expires <= Date.now()) sessions.delete(key);
      if (sessions.size >= 32) sessions.delete(sessions.keys().next().value);
      const token = randomBytes(32).toString('base64url');
      sessions.set(hash(token), {expires: Date.now() + lifetime, credentials: hash(JSON.stringify(record))});
      res.setHeader('Set-Cookie', cookie(token, lifetime / 1000));
    }
    function sameOrigin(req) {
      proxyConfiguration(req);
      const expected = canonical?.origin || `http://${req.headers.host}`;
      const supplied = canonical ? req.headers['x-agent-blog-origin'] : req.headers.origin;
      if (supplied !== expected) api.fail('ORIGIN_REJECTED', 'Same-origin requests are required.', 403);
    }
    function proxyConfiguration(req) {
      if (!canonical && (req.headers['x-agent-blog-client'] !== undefined || req.headers['x-agent-blog-origin'] !== undefined)) api.fail('AUTH_ORIGIN_CONFIG', 'Configure an HTTPS origin before proxying authentication.', 503);
    }
    function rate(req) {
      const now = Date.now(), key = canonical ? req.headers['x-agent-blog-client'] || req.socket.remoteAddress : req.socket.remoteAddress;
      for (const [id, value] of attempts) if (value.until <= now) attempts.delete(id);
      let value = attempts.get(key);
      if (!value) { if (attempts.size >= 1024) attempts.delete(attempts.keys().next().value); value = {count: 0, until: now + 15 * 60 * 1000}; attempts.set(key, value); }
      if (++value.count > 5 || deriving >= 2) api.fail('AUTH_RATE_LIMIT', '尝试次数过多，请稍后再试。', 429);
      return key;
    }
    async function passwordHash(password, salt) {
      if (deriving >= 2) api.fail('AUTH_RATE_LIMIT', '尝试次数过多，请稍后再试。', 429);
      deriving++;
      try { return (await derive(password, salt, iterations, 32, 'sha256')).toString('hex'); }
      finally { deriving--; }
    }
    async function input(req) {
      if (req.headers['content-type']?.split(';')[0] !== 'application/json') api.fail('CONTENT_TYPE', 'Use JSON.', 415);
      const chunks = []; let length = 0;
      for await (const chunk of req) { length += chunk.length; if (length > 8192) api.fail('BODY_TOO_LARGE', 'Request too large.', 413); chunks.push(chunk); }
      try {
        const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error();
        return value;
      } catch { api.fail('INVALID_JSON', 'Use a JSON object.'); }
    }
    function redirect(res, target) { res.writeHead(302, {Location: target, 'Cache-Control': 'no-store'}); res.end(); }
    function page(setup) {
      const e = api.escapeHTML;
      return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${setup ? '设置登录' : '登录'} · ${e(api.site.title)}</title><link rel="stylesheet" href="/_assets/auth/style.css"></head><body><main><a class="brand" href="/">${e(api.site.title)}</a><p class="eyebrow">YOUR WORDS, YOUR SPACE</p><h1>${setup ? '建立你的写作入口' : '欢迎回来'}</h1><p class="lead">${setup ? '设置独立的站点账号，开启你的写作空间。' : '登录后继续写作，管理你的文章与说说。'}</p><form data-mode="${setup ? 'setup' : 'login'}">${setup ? '<label id="token-field">初始化码<input name="token" required autocomplete="off"></label>' : ''}<label>用户名<input name="username" required maxlength="80" autocomplete="username"></label><label>密码<input type="password" name="password" required ${setup ? 'minlength="15"' : ''} maxlength="256" autocomplete="${setup ? 'new-password' : 'current-password'}"></label>${setup ? '<small>密码至少 15 个字符，可以使用空格和中文。</small>' : ''}<button>${setup ? '设置账号并进入' : '进入写作空间'}</button><p id="message" role="status" aria-live="polite"></p></form><a class="back" href="/">← 返回博客</a></main><script type="module" src="/_assets/auth/login.js"></script></body></html>`;
    }
    api.asset('/_assets/auth', fileURLToPath(new URL('./public', import.meta.url)));
    api.command({name: 'auth-status', description: 'Describe independent login setup without revealing credentials.', run: () => ({configured: !!credentials(), setupPending: !!read('bootstrap')})});
    api.command({name: 'auth-setup', description: 'Issue a 30-minute one-time setup link before the owner account exists.', run: () => locked(() => {
      if (credentials()) api.fail('AUTH_CONFIGURED', 'An owner account already exists.', 409);
      const token = randomBytes(32).toString('base64url'), expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
      write('bootstrap', {hash: hash(token), expiresAt});
      return {url: `${canonical?.origin || ''}/__auth/setup#${token}`, expiresAt};
    })});
    api.route('/__auth', async ({req, res, pathname, blog, html, json}) => {
      proxyConfiguration(req);
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
      const record = credentials(), key = session(req, record);
      const destination = blog.routes.some(route => route.prefix === '/__editor') ? '/__editor/' : '/';
      if (req.method === 'GET') {
        if (pathname === '/__auth/setup') return record ? redirect(res, '/__auth/login') : html(res, page(true));
        if (pathname === '/__auth/login') return key ? redirect(res, destination) : !record ? redirect(res, '/__auth/setup') : html(res, page(false));
        api.fail('NOT_FOUND', 'Not found.', 404);
      }
      if (req.method !== 'POST' || !['/__auth/setup', '/__auth/login', '/__auth/logout'].includes(pathname)) api.fail('METHOD_NOT_ALLOWED', 'Use a supported auth route.', 405);
      sameOrigin(req);
      if (pathname === '/__auth/logout') {
        if (key) sessions.delete(key);
        res.setHeader('Set-Cookie', cookie('', 0));
        return json(res, 200, {ok: true, data: {next: '/__auth/login'}});
      }
      const ip = rate(req), value = await input(req);
      if (typeof value.username !== 'string' || !value.username.trim() || value.username.length > 80 || /[\x00-\x1f\x7f]/.test(value.username) || typeof value.password !== 'string' || !value.password || value.password.length > 256) api.fail('AUTH_INPUT', 'Provide a username and password.');
      if (pathname === '/__auth/setup') {
        if (record) api.fail('AUTH_CONFIGURED', 'An owner account already exists.', 409);
        const pending = read('bootstrap');
        if (!pending || typeof value.token !== 'string' || !Number.isFinite(Date.parse(pending.expiresAt)) || Date.parse(pending.expiresAt) <= Date.now() || !equal(hash(value.token), pending.hash || '')) api.fail('AUTH_SETUP', '初始化链接无效或已过期，请重新获取。', 403);
        if (value.password.length < 15) api.fail('AUTH_INPUT', '密码至少需要 15 个字符。');
        const salt = randomBytes(16).toString('hex');
        const created = {version: 1, username: value.username.trim(), salt, hash: await passwordHash(value.password, salt), iterations};
        locked(() => {
          if (credentials() || JSON.stringify(read('bootstrap')) !== JSON.stringify(pending) || Date.parse(pending.expiresAt) <= Date.now()) api.fail('AUTH_SETUP', '初始化链接已失效，请重新获取。', 409);
          write('credentials', created);
          fs.unlinkSync(path.join(directory, 'bootstrap.json'));
        });
        signedIn(res, created);
      } else {
        const candidate = await passwordHash(value.password, record?.salt || '0'.repeat(32));
        if (!record || !equal(hash(value.username.trim()), hash(record.username)) || !equal(candidate, record.hash)) api.fail('AUTH_LOGIN', '用户名或密码不正确。', 401);
        signedIn(res, record);
      }
      attempts.delete(ip);
      json(res, 200, {ok: true, data: {next: destination}});
    }, {public: true});
    api.middleware(async ({req, res, pathname, blog, json}, next) => {
      const route = blog.routes.find(value => matches(pathname, value.prefix));
      const asset = blog.assets.find(value => pathname.startsWith(value.prefix + '/'));
      if (!(route && !route.public) && !(asset && !asset.public)) return next();
      proxyConfiguration(req);
      const record = credentials();
      if (!session(req, record)) {
        if (req.method === 'GET' && route && (pathname === '/__editor/' || pathname === '/__editor' || req.headers.accept?.includes('text/html'))) return redirect(res, record ? '/__auth/login' : '/__auth/setup');
        return json(res, 401, {ok: false, error: {code: 'AUTH_REQUIRED', message: 'Sign in to continue.'}});
      }
      if (!['GET', 'HEAD'].includes(req.method)) sameOrigin(req);
      return next();
    });
    api.optional('editor')?.register({name: 'auth', module: '/_assets/auth/editor.js'});
  }
};
