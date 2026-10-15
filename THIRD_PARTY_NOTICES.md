# 第三方依赖说明

Agent Blog 的源码使用 MIT 许可证。以下是直接依赖在各自 package.json 中声明的许可证；这些库及其资产保留各自的许可证和版权声明。

核心包没有运行时依赖。以下运行时依赖仅由相应可选插件引入。

| 依赖 | 用途 | 声明的许可证 | 上游 |
| --- | --- | --- | --- |
| markdown-it | Markdown 渲染 | MIT | [markdown-it](https://github.com/markdown-it/markdown-it) |
| highlight.js | 代码高亮 | BSD-3-Clause | [highlight.js](https://github.com/highlightjs/highlight.js) |
| KaTeX | 数学公式、样式与字体资产 | MIT | [KaTeX](https://github.com/KaTeX/KaTeX) |
| CodeMirror state / view / commands / language / lang-markdown / lang-javascript / lang-python | 网页编辑器与语法支持 | MIT | [CodeMirror](https://codemirror.net/)、[源码](https://github.com/codemirror) |
| Lezer common / highlight | 编辑器与独立语法插件共享的语法树和高亮标签协议 | MIT | [common](https://code.haverbeke.berlin/lezer/common)、[highlight](https://code.haverbeke.berlin/lezer/highlight) |
| Turndown / turndown-plugin-gfm | 可选 WordPress 迁移：HTML 转 Markdown、表格与代码块 | MIT | [Turndown](https://github.com/mixmark-io/turndown)、[GFM 插件](https://github.com/mixmark-io/turndown-plugin-gfm) |

开发工具依赖：

| 依赖 | 用途 | 声明的许可证 | 上游 |
| --- | --- | --- | --- |
| esbuild | 构建可选编辑器资源 | MIT | [esbuild](https://github.com/evanw/esbuild) |
| TypeScript | 公开接口类型检查 | Apache-2.0 | [TypeScript](https://github.com/microsoft/TypeScript) |
| @types/node | Node.js 类型定义 | MIT | [DefinitelyTyped](https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/node) |

精确版本、完整依赖树及完整性校验值记录在 package-lock.json 中。浏览器测试使用的 Playwright 由开发者另行安装，不属于核心或插件的运行时依赖。
