# 独立功能插件

功能按职责分包，每个包通过 Plugin API 注册自己的入口。启用“说说”不要求启用网页编辑器、导航、Markdown 或皮肤；存在编辑器时，说说插件才贡献“新建说说”按钮。停用插件并重新构建会撤下它生成的页面、按钮和资源，文章源文件保持不变。

`agent-blog init ./my-blog` 默认启用当前系统的 18 个插件，包括下列功能包，以及 Markdown、高亮、公式、编辑器、编辑器语言、编辑器着色、Agent 上下文、纸张皮肤、WordPress 迁移和插件广场。源码安装还附带可切换的终端皮肤。默认安装只选择一个皮肤；其他功能仍可独立启停。

`--preset minimal` 可显式创建纯核心站点，`--preset writer` 保留原来的七个写作插件组合。默认组合只在初始化时写入 `blog.json`，不会在每次启动时强行补回已停用的插件，也不会改写已有站点配置。

| 包 | 插件名 | 职责 | 可选联动 |
| --- | --- | --- | --- |
| `@agent-blog/notes` | `notes` | 说说类型、列表、首页区块、CLI | `editor` 新建按钮；导航贡献项 |
| `@agent-blog/pages` | `pages` | 独立页面类型、CLI、从文章首页排除页面 | `editor` 新建按钮 |
| `@agent-blog/navigation` | `navigation` | 页头导航，组合各插件贡献的链接 | `navigation:items` 插槽 |
| `@agent-blog/archive` | `archive` | `/archive/` 文章归档 | 导航贡献项；旧空白归档页展示 |
| `@agent-blog/links` | `links` | `/links/` 友情链接 | 导航贡献项；旧空白友情链接页展示 |
| `@agent-blog/date-format` | `date-format` | 公共 `date` 组件的地区与时区格式 | 文章卡片、文章信息、说说卡片 |
| `@agent-blog/footer` | `footer` | 页脚文字和链接 | 当前皮肤的页脚样式 |
| `@agent-blog/publish` | `publish-on-save` | 保存或删除后构建公开站点 | 所有写入入口共用生命周期 |

以上包无运行时第三方依赖，声明 `@agent-blog/core` 为 peer dependency。说说和页面通过 `optionalRequires: ['editor']` 声明可选编辑器能力；缺少编辑器不影响 CLI 和公开页面。插件是受信任的本地代码，依赖声明和注册冲突检查是组合契约，不是进程沙箱。

## 配置

将所需条目加入站点 `blog.json` 的 `plugins` 数组；无需一次启用全部插件：

```json
[
  {"use": "@agent-blog/notes", "options": {"title": "说说", "homeLimit": 5}},
  "@agent-blog/pages",
  {"use": "@agent-blog/navigation", "options": {"links": [{"title": "文章", "url": "/"}]}},
  {"use": "@agent-blog/archive", "options": {"title": "归档"}},
  {"use": "@agent-blog/links", "options": {"links": [{"title": "Example", "url": "https://example.com"}]}},
  {"use": "@agent-blog/date-format", "options": {"locale": "zh-CN", "timeZone": "Asia/Shanghai"}},
  {"use": "@agent-blog/footer", "options": {"text": "我的博客", "links": [{"title": "源码", "url": "https://github.com/example/blog"}]}},
  "@agent-blog/publish"
]
```

`notes.title` 默认“说说”，`homeLimit` 默认 5，设为 0 隐藏首页区块而保留说说列表页。`archive.title` 默认“归档”，`links.title` 默认“友情链接”。导航默认包含“文章 → /”，页脚默认文字“文字由你掌握。”且没有额外链接。链接只接受本站绝对路径或 HTTP(S) 地址，文字统一转义。

配置中的包需要先安装或在工作区中可解析；源码检出也可以使用相应 `packages/<name>/index.mjs` 的文件路径。启停会改变注册表，因此编辑服务需要重新加载配置，静态站点需要重新构建。

## 内容与 Agent 命令

文章没有 `metadata.type` 或设为 `post`；说说为 `note`，独立页面为 `page`。这些是框架站点自身的内容字段，与 WordPress 无关。正文、日期、标签和自定义元数据仍保存在同一批内容文件中。

```bash
printf '今天的一点想法。\n' | agent-blog notes-new today --stdin --json
agent-blog notes-list --drafts --json
printf '# 关于我\n' | agent-blog pages-new about --title '关于' --stdin --json
agent-blog pages-list --drafts --json
agent-blog schema --json
```

新内容总是草稿，创建时使用 `null` revision，已有同名内容会报冲突。发布和修改沿用通用 `get`、`put`、`publish` 命令及 revision 检查。编辑器按钮调用同一个通用新建入口，保留编辑器对未保存内容和保存中状态的保护。

停用 `notes` 或 `pages` 后，内容仍能被通用 CLI 读取，也仍受草稿权限约束。公开内容会回到普通文章展示，不会因为插件退出被删除或隐藏。导航、归档和其他插件继续工作。

## 展示与换肤

说说列表及归档、友情链接页面通过当前布局生成完整页面，切换 Paper、Terminal 或自定义皮肤会同时作用于这些页面。说说正文复用当前 renderer 和 transform，因此 Markdown、代码高亮、公式各自按启用状态生效。

说说提供可替换的默认组件 `notes:card`、`notes:list`；皮肤可以调用 `api.component('notes:card', render)` 单独替换说说卡片。导航使用 `header:nav`，其他功能通过 `navigation:items` 贡献链接。缺少导航插件时，只是不展示这些导航项。

归档仅列出已发布的普通文章；说说、独立页面和草稿不混入归档。说说和页面对首页的排除使用独立过滤器，不替换其他插件的列表实现。

## 旧页面兼容与发布

`archive` 和 `links` 可配置 `legacySlugs: ["old-page-slug"]`，在对应正文为空时生成归档或链接展示。已有正文会优先保留，源文件不会被自动改写。站点迁移时显式配置旧页面标识即可，插件不内置个人站点 ID。

`publish-on-save` 在内容写入或删除完成后重新加载最新文件并构建 `dist`。它沿用站点级 `.publish-lock`，协调 CLI 和编辑服务的构建；当前实现适合个人博客写入量，锁等待最多 25 秒。构建失败作为 `HOOK_FAILED` 警告报告，已经保存的正文保持有效，原有无归属目录也不会被覆盖。修复原因后执行 `agent-blog build` 重建即可。

此插件只更新站点构建目录，发布到哪台服务器以及公开路由由部署层负责。旧的 `deploy/publish.mjs` 入口保留兼容导出。
