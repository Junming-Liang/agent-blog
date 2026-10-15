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

## 编写插件与皮肤

阅读 [插件协议](docs/plugin-api.md)，参考 [示例插件](examples/demo/plugins) 和 [内置皮肤](packages/theme-paper)。

- 核心保持零运行时依赖，功能依赖放在对应插件中。
- 在 setup 阶段注册能力，内容适配器应在首次内容访问前注册。
- 原始存储适配器需要原子地比较版本并执行写入或删除。
- 保留文章自定义字段，明确处理版本冲突。
- 组件、插槽和渲染结果使用公开接口；文本需要适当转义。
- CLI 输入、返回值和配置应能被 Agent 发现和使用。

## 验证改动

```sh
npm run build:editor
npm test
npm run test:types
npm run build
```

为新的行为增加有意义的定向验证；保持改动范围与问题一致。PR 描述说明问题、改动后的行为、验证结果以及接口兼容性影响。

浏览器验证是可选的，使用 `scripts/check-browser.mjs`。该脚本需要另行安装的 Playwright 和浏览器。默认使用 Playwright 的 Chromium；可以通过 `AGENT_BLOG_CHROME` 指定已有浏览器，通过 `AGENT_BLOG_PLAYWRIGHT_MODULE` 指定 Playwright 模块。脚本只访问自己启动的回环服务，生成的结果在 `test-results/` 中。

## 许可证

提交贡献即表示该贡献可以按本仓库的 MIT 许可证分发。引入新的第三方依赖时，记录其用途和许可证。
