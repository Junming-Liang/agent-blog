# 独立服务器部署与 WordPress 迁移

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

## 沿用 WordPress 登录

`wordpress-gateway.php` 是可选部署适配器，需要 PHP-FPM、curl 扩展和保留的 WordPress 安装。它只代理 `/__editor/` 与 `/_assets/editor/`，要求原站管理员登录，校验写请求的 Origin，并转发到固定回环地址。适配器不接收上游地址参数，也不向编辑服务器转发 WordPress 登录凭证。

在 HTTPS 虚拟主机中，为这两个前缀配置 FastCGI 并传入：

- `SCRIPT_FILENAME`：该适配器的绝对路径。
- `AGENT_BLOG_WORDPRESS_ROOT`：原 WordPress 安装目录。
- `AGENT_BLOG_UPSTREAM`：例如 `http://127.0.0.1:4174`。
- `AGENT_BLOG_ORIGIN`：站点的规范 HTTPS 来源，例如 `https://example.com`。

保留原站的 `wp-login.php` 和 `wp-admin/` 路由。多个域名建议先重定向到一个规范域名。其他未发布的插件资源需要自己的认证规则；公开目录只应指向 `dist/`，绝不能指向文章目录或原始导出。

如果 PHP 环境已设置 `open_basedir`，需在此网关的 FastCGI `PHP_ADMIN_VALUE` 中显式允许适配器目录、WordPress 目录及所需临时目录；保留原站其他请求的路径限制。首页替换为静态页面时，应将带 `rest_route` 参数的旧 WordPress 请求继续交给原 `index.php`，保留后台 API。

## 保存后生成静态站

把本目录的 `publish.mjs` 作为站点插件启用，即可在网页或 CLI 保存、删除文章后重新生成静态站。首次批量导入时先不要启用，以免每篇文章触发一次构建。进程间的 `.publish-lock/` 防止构建互相覆盖；保存已完成但构建失败时，CLI / 编辑 API 会返回生命周期告警。

文章文件直接编辑后需运行 `build`。进程异常退出留下锁时，先检查锁内的 `owner.json` 并确认对应进程已退出，再清理锁。站点规模增长后，可以用部署插件替换为外部构建队列；默认实现适合个人博客。
