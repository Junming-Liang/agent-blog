# @agent-blog/auth

独立的单所有者登录插件。保护未标记为公开的插件路由和 `public: false` 的资源；不依赖 WordPress、PHP 或数据库。密码使用 Node.js PBKDF2-HMAC-SHA256（600,000 次迭代、独立随机盐）保存为派生值，账号文件位于站点私有 `.auth/` 目录。

## 第一次使用

默认站点已启用此插件。先启动本地预览，再在另一个终端生成一次性初始化链接：

```sh
agent-blog auth-setup --site ./my-blog --json
agent-blog auth-status --site ./my-blog --json
```

将返回的 `url` 路径添加到预览地址后打开，在网页设置用户名和至少 15 个字符的密码。链接有效期 30 分钟，仅可成功使用一次；重复生成会撤销旧链接。初始化码通过 URL fragment 传递，网页读取后立即清除，不进入服务器访问日志。不要公开分享初始化链接。

已初始化的站点直接访问 `/__editor/`，会转到独立登录页。CLI 与本地文件编辑继续使用文件系统权限，不经过网页登录。启用编辑器时，本插件通过公开扩展接口增加“退出登录”按钮。

## 部署

公开部署在插件配置中设置规范 HTTPS origin，例如：

```json
{"use":"@agent-blog/auth","options":{"origin":"https://blog.example"}}
```

Node 服务保持回环监听。Nginx 必须保留 Cookie，并覆盖 `Host` 和 `Origin` 为固定回环上游地址；原始浏览器 Origin 和客户端地址由 Nginx 分别写入 `X-Agent-Blog-Origin`、`X-Agent-Blog-Client`，不能透传客户端同名头。见[部署说明](../../deploy/README.md)。配置 `origin` 后，写请求必须经过这条验证链路；插件不信任任意 `X-Forwarded-*` 头。

HTTPS 会话使用 `__Host-` 前缀、Secure、HttpOnly、SameSite=Strict、Path=/ Cookie。会话只保存在编辑进程内存中，有效期 8 小时；重启服务会退出全部会话。错误登录按客户端限制为 15 分钟内最多 5 次，同时最多进行 2 次口令派生计算。修改账号文件后旧会话失效。

路由默认受保护；明确公开的 webhook/API 必须使用 `api.route(prefix, handler, {public: true})`。公开文章、静态输出和公开资源不要求登录。新站点未设置账号时，私有路由保持关闭；仅拿到初始化链接的所有者能建立账号。

## 维护与边界

- 要求 core `^0.2.1`、插件 API v1；无必需依赖或继承，`editor` 为可选联动。
- `.auth/` 目录权限为 0700、文件为 0600，应排除 Git 和公开构建；不要把它复制到静态网站目录。
- 遗失密码时，由服务器文件所有者停止编辑服务，将 `.auth/credentials.json` 从认证状态中移除，然后重新生成初始化链接；这会重置唯一所有者账号。文章文件不参与账号恢复。
- 此插件不提供多用户角色、跨进程会话或不可信插件沙箱。其他本地插件仍拥有启动者的文件权限，启用前需要按广场流程审核。
- 停用本插件会撤下登录和 HTTP 访问保护，只适用于受信任的本地工作区；公开部署应保留本插件或替换为已审查的独立认证提供者。

License: MIT.

验证：`node --test tests/auth.test.mjs` 覆盖接口与会话边界。具备 Playwright 和 Chrome 的环境可运行 `node scripts/check-auth-browser.mjs`，完成隔离样例的首次设置、登录、实际编辑、退出与重新登录；可用 `AGENT_BLOG_PLAYWRIGHT_MODULE` 和 `AGENT_BLOG_CHROME` 指定已有工具，不引入运行时依赖。
