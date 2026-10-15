# 独立服务器部署与 WordPress 迁移

## 独立登录与公开部署

默认使用 `@agent-blog/auth`，日常运行仅需 Node.js 和静态托管/反向代理，不需要 WordPress、PHP 或数据库。迁移工具只用于一次性内容导入，完成后可停用。博客通过自己的账号登录编辑器。

在站点配置中为 auth 设置规范 HTTPS origin，并将 `__auth`、`__editor` 与未命中公开构建的私有 `/_assets/` 转发至固定回环上游。对应 location 可复用如下片段：

```nginx
proxy_pass http://127.0.0.1:4174;
proxy_set_header Host 127.0.0.1:4174;
proxy_set_header Origin http://127.0.0.1:4174;
proxy_set_header X-Agent-Blog-Origin $http_origin;
proxy_set_header X-Agent-Blog-Client $remote_addr;
proxy_http_version 1.1;
proxy_redirect off;
proxy_read_timeout 35s;
```

这两个自定义头必须由代理覆盖，不能透传外部同名头。原始 Origin 在 auth 插件中与配置的 HTTPS origin 精确比较；回环 Host/Origin 继续通过核心的本地服务边界。Cookie 和 Set-Cookie 应正常转发，不缓存登录及编辑响应。公开静态文件直接读取 `dist`。

以站点文件所有者身份运行 `auth-setup --site /path/to/site --json`，将一次性链接交给站点所有者，在网页中设置用户名和密码。账号状态仅位于私有 `.auth/`，不进入静态构建和 Git。详细的首次设置、会话失效和恢复流程见[登录插件文档](../packages/auth/README.md)。

核心服务器始终只监听回环地址。公开阅读使用 `build` 生成的静态 `dist/`，编辑入口由部署层认证后转发；不要将整个编辑服务器直接代理到公网。

## 迁移文章

`@agent-blog/wordpress` 是可选插件，依赖 Turndown；核心不依赖 WordPress 或数据库。导出器直接执行 SELECT，不加载 WordPress 插件，不修改原站。需要 PHP 8、mysqli 和使用字符串常量配置数据库的 WordPress 安装。

在旧站服务器创建仅管理员可读的导出文件：

```sh
umask 077
php /path/to/agent-blog/scripts/export-wordpress.php /path/to/wordpress > /private/wordpress.json
```

将 `@agent-blog/wordpress` 加到目标站点 `blog.json` 的 `plugins` 中，然后导入：

```sh
node packages/core/cli.mjs wordpress-import /private/wordpress.json --site /path/to/site --json
node packages/core/cli.mjs build --site /path/to/site --json
```

如果旧正文使用过服务器 IP 或其他域名，在插件配置中明确列出自己站点的旧地址，例如 `{"use":"@agent-blog/wordpress","options":{"legacyOrigins":["http://192.0.2.10"]}}`。这些地址及当前域名的链接会转换为站内路径，避免旧 HTTP 图片在 HTTPS 页面中失效；其他站点的图片保留原地址。

文章、页面和 `shuoshuo` 转成 `content/wp-ID.md`，保留 ID、时间、作者、分类、标签、来源状态和源内容指纹。只有原来已公开且无密码的内容会公开；私密内容、草稿、密码文章保持草稿状态。代码、GFM 表格、图片、附件链接和 `[latex]` / `$…$` 公式会转换为可编辑 Markdown。PDF 保留为附件链接。主题生成的空页面需要站点插件补充其展示逻辑。

重复导入会跳过来源指纹相同的文章，保留在新站的修改；同一 ID 的来源变化会拒绝导入，需要人工合并。导入不是数据库备份；原始导出应私下保留，不要提交到公开仓库。其中包含非公开内容和评论信息。修订记录、附件信息、菜单和评论保存在原始导出，导入器不将这些记录当成普通文章发布。

媒体需单独复制并校验文件指纹。保留原 `/wp-content/uploads/` URL 能减少正文链接变化。旧 `/?p=ID`、`/?page_id=ID` 可由服务器重定向到 `/posts/wp-ID/`；仅为公开内容生成重定向。

## 旧部署兼容：沿用 WordPress 登录（非默认）

`wordpress-gateway.php` 仅保留用于兼容旧部署；使用它就仍然依赖原 WordPress 登录，不属于独立部署方案。新部署应使用上面的 auth 插件和直接反向代理。旧适配器需要 PHP-FPM、curl 扩展和保留的 WordPress 安装，代理编辑与私有资源请求，要求原站管理员登录并校验写请求的 Origin。

在 HTTPS 虚拟主机中，为这两个前缀配置 FastCGI 并传入：

- `SCRIPT_FILENAME`：该适配器的绝对路径。
- `AGENT_BLOG_WORDPRESS_ROOT`：原 WordPress 安装目录。
- `AGENT_BLOG_UPSTREAM`：例如 `http://127.0.0.1:4174`。
- `AGENT_BLOG_ORIGIN`：站点的规范 HTTPS 来源，例如 `https://example.com`。

保留原站的 `wp-login.php` 和 `wp-admin/` 路由。多个域名建议先重定向到一个规范域名。其他未发布的插件资源需要自己的认证规则；公开目录只应指向 `dist/`，绝不能指向文章目录或原始导出。

如果 PHP 环境已设置 `open_basedir`，需在此网关的 FastCGI `PHP_ADMIN_VALUE` 中显式允许适配器目录、WordPress 目录及所需临时目录；保留原站其他请求的路径限制。首页替换为静态页面时，应将带 `rest_route` 参数的旧 WordPress 请求继续交给原 `index.php`，保留后台 API。

使用 IP 或其他临时 HTTPS 地址时，可在该入口的网关参数中设置 `AGENT_BLOG_WORDPRESS_REBASE=1`，并将其 `/wp-login.php` 也交给此适配器。此时 `WP_HOME`、`WP_SITEURL` 只在当前请求中指向 `AGENT_BLOG_ORIGIN`，登录链接、Cookie 和登录后返回地址会留在该入口，数据库中的原域名不变。原 WordPress 配置不能预先固定这些常量或 Cookie 域。登录页所用的 WordPress 样式、脚本与图片也需要通过该入口提供。

## 保存后生成静态站

把本目录的 `publish.mjs` 作为站点插件启用，即可在网页或 CLI 保存、删除文章后重新生成静态站。首次批量导入时先不要启用，以免每篇文章触发一次构建。进程间的 `.publish-lock/` 防止构建互相覆盖；保存已完成但构建失败时，CLI / 编辑 API 会返回生命周期告警。

文章文件直接编辑后需运行 `build`。进程异常退出留下锁时，先检查锁内的 `owner.json` 并确认对应进程已退出，再清理锁。站点规模增长后，可以用部署插件替换为外部构建队列；默认实现适合个人博客。


## 独立插件的页面与编辑资源

发布层应按构建目录提供所有插件输出，新增插件页不需要逐一增加专用路由。保留现有 WordPress 和其他应用的高优先级 location；博客的普通路径先查 `dist`，未找到再进入既有站点的静态文件处理。

编辑器插件可能把资源注册在任何 `/_assets/<plugin>/`。公开资源由 `dist/_assets` 提供；未命中的资源应走相同的管理员认证网关，再由回环服务的资产注册表处理，不能只代理 `/_assets/editor/`。网关允许的私有范围是 `__editor` 和 `_assets`，访问权限与写入来源检查继续适用。HTTP 入口的私有资源跳转到已配置的 HTTPS 编辑入口。

升级前后检查匿名编辑 API 和私有资源都返回 401，公开 CSS/字体返回 200，文章、说说、归档和友情链接页面可访问。插件删除并重新构建后，旧插件输出从 dist 撤下；原内容文件仍保留。
