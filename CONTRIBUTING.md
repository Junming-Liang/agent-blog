# 贡献指南

欢迎贡献插件、皮肤、文档、接口契约和问题修复。

## 开始开发

需要 Node.js 22 或更新版本及 npm。在仓库根目录执行：

```sh
npm ci --ignore-scripts
npm run build:editor
npm run dev
```

所有贡献者和 coding agent 使用同一套 [AGENTS.md](AGENTS.md) 约定。

## 提交问题

在本仓库 Issues 中提供问题描述、期望行为、复现步骤、Node.js 版本和最小插件配置。插件或内容相关问题尽量附上最小示例，移除账号凭据与私人文章。

涉及接口变化时，先说明具体使用场景、现有接口无法完成的步骤和兼容性影响。可以通过插件解决的能力，优先放进插件。

## 分享插件

每个人都可以 Fork 本仓库并提交 PR。阅读[插件广场投稿指南](docs/marketplace.md)，新增目录条目、固定源码 commit、声明依赖、继承关系和许可证，再运行 `npm run marketplace:build` 与 `npm run marketplace:check`。广场收录经过维护者审阅，合并后出现在公开目录和 Agent 查询结果中。

插件用同一份 `plugin.json` 维护运行时和目录的名称、API 版本及关系；发布包应包含清单、入口和资源。更新时检查目录自动生成的反向依赖列表，说明对依赖者、可选联动者和继承者的影响，并沿受影响链继续核对兼容性。破坏性变更需升级相应包版本、明确标记并提供迁移步骤，不能只替换固定 commit。

## 编写插件与皮肤

阅读 [插件协议](docs/plugin-api.md)，参考 [示例插件](examples/demo/plugins) 和 [内置皮肤](packages/theme-paper)。

- 每项新功能必须在独立插件中实现；禁止把无关功能放进一个站点定制插件。
- 核心保持零运行时依赖，只增加可复用协议，功能依赖放在对应插件中。
- 必需协作用 `requires`，可选联动用 `optionalRequires`，继承基础功能用 `extends`；跨插件访问通过公开服务，同一目标只声明一种关系。
- 继承的基础插件必须先初始化；通过公开服务和组件回退组合功能，不依赖基础插件的私有实现。
- 展示使用追加插槽和有命名空间的 fallback 组件；皮肤不得拥有内容类型或发布行为。
- 验证最小配置、逐个禁用、组合使用、换肤和内容保留；分别检查可选依赖缺席/存在、必需依赖或基础插件缺失，以及组件覆盖/回退。
- 在 setup 阶段注册能力，内容适配器应在首次内容访问前注册。
- 原始存储适配器需要原子地比较版本并执行写入或删除。
- 保留文章自定义字段，明确处理版本冲突。
- 组件、插槽和渲染结果使用公开接口；文本需要适当转义。
- CLI 输入、返回值和配置应能被 Agent 发现和使用。

## 验证改动

```sh
npm run marketplace:check
npm run build:editor
npm test
npm run test:types
npm run build
```

为新的行为增加有意义的定向验证；保持改动范围与问题一致。PR 描述说明问题、改动后的行为、验证结果以及接口兼容性影响。

仓库提供 [Plugin checks 工作流](.github/workflows/plugins.yml)：`Plugin catalog and dependency graph` 核对目录与关系图，`Plugin composition and content contracts` 检查构建、测试和类型契约。[CODEOWNERS](.github/CODEOWNERS) 指定维护者审阅；是否已成为强制合并条件由远端分支保护或规则集决定。合并前检查当前 PR 的实际状态和审查结果，文件存在或本地通过都不表示远端检查已完成。

浏览器验证是可选的，使用 `scripts/check-browser.mjs`。该脚本需要另行安装的 Playwright 和浏览器。默认使用 Playwright 的 Chromium；可以通过 `AGENT_BLOG_CHROME` 指定已有浏览器，通过 `AGENT_BLOG_PLAYWRIGHT_MODULE` 指定 Playwright 模块。脚本只访问自己启动的回环服务，生成的结果在 `test-results/` 中。

## 许可证

提交贡献即表示该贡献可以按本仓库的 MIT 许可证分发。引入新的第三方依赖时，记录其用途和许可证。
