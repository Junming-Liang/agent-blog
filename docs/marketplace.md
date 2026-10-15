# 插件广场与社区贡献

[插件广场](../marketplace/README.md)是 GitHub 上可以直接浏览的目录，也提供给 Agent 使用的[机器可读目录](../packages/marketplace/catalog.json)。任何人都可以提交 PR。插件可以放在自己的公开 GitHub 仓库；提交目录条目即可，无需把实现合并进本项目。

广场本身是可选的 `@agent-blog/marketplace` 插件。未启用时，博客不加载目录，也不提供目录命令。

网页编辑功能也按职责分包：`editor` 提供编辑引擎，`editor-markdown` 提供 Markdown 语言支持，`editor-highlight` 提供语法着色，`editor-agent` 提供 Agent 交接。后三者显式依赖 `editor`，可以分别启用或禁用。这里的编辑器语言与着色，与控制公开文章渲染的 `markdown` / `highlight` 插件分别配置。

## 搜索和使用

在已有站点启用随框架提供的目录插件：

```sh
agent-blog plugin enable @agent-blog/marketplace --site ./my-blog
agent-blog marketplace-list --site ./my-blog --json
agent-blog marketplace-list --category content --query 说说 --site ./my-blog --json
agent-blog marketplace-get notes --site ./my-blog --json
```

`marketplace-list` 返回 `{schemaVersion, apiVersion, plugins}`；`marketplace-get` 返回完整条目，包括 `requires`、`optionalRequires`、`extends` 和自动计算的 `dependents`，找不到时返回 `NOT_FOUND`。`schema --json` 可发现命令及参数。目录是当前安装版本随附的离线快照，更新框架或目录包后更新。查询不会联网、下载代码、安装依赖或自动启用插件。

选择插件后，先阅读源码、许可证、依赖和配置约定。对于外部插件，应检出条目指定的完整 commit，审查后按该仓库的说明安装，再使用 `plugin enable` 指定本地入口。**启用本身会运行插件代码**；不能把 `plugin enable` 当成不执行代码的安全检查。需要停用时使用 `plugin disable`，再重新构建或重启预览服务。插件不得因为禁用而删除用户内容。

## 依赖、联动与继承

插件可以依赖或继承其他插件，关系必须显式声明，并与运行时实际使用一致：

| 关系 | 声明 | 启用条件和执行顺序 | 使用方式 |
| --- | --- | --- | --- |
| 必需依赖 | `requires: ["base"]` | `base` 必须启用，先初始化它，再初始化当前插件。 | 调用对方公开服务；例如数学公式插件依赖 Markdown 渲染器。 |
| 可选联动 | `optionalRequires: ["editor"]` | 对方存在时先初始化；不存在时当前插件必须仍可运行。 | 通过可选服务探测增强功能；例如说说向编辑器增加按钮。 |
| 继承基础功能 | `extends: ["base"]` | 基础插件必须启用并先初始化；缺失或停用基础插件时不能静默继续。 | 组合基础插件的公开服务，按声明的组件覆盖与回退规则扩展展示。 |

`extends` 表示显式的基础插件关系，运行时按该关系排序并检查基础插件是否可用。它不会自动复制对象、私有状态或 JavaScript 类；继承的具体行为由插件通过公开服务和组件组合完成。插件须在文档中说明继承哪些能力、覆盖哪些组件以及如何回退。不要读取基础插件私有文件或依赖其未公开内部实现。

同一目标只能出现在一种关系里；基础插件已经是必需项，无需同时写进 `requires`。三类关系共同参与缺失引用和循环关系检查。禁用必需依赖或基础插件前，先停用或改配使用者；停用可选依赖时，需要验证缺席时的正常行为。依赖关系约束加载顺序，独立性要求功能边界和影响范围可解释。

每个插件保存一个权威 `plugin.json`：

```json
{
  "name": "your-plugin",
  "apiVersion": 1,
  "requires": [],
  "optionalRequires": [],
  "extends": []
}
```

运行时入口导入这份清单并用于插件声明。随本仓库提供的插件，目录校验直接读取清单核对这五项；修改关系时必须同时更新运行时清单与目录条目。外部插件须在固定 commit 中提供清单，并由审查者核对其入口使用的实际声明。不要维护另一份与入口脱节的“目录专用依赖表”。

生成的 `dependents` 按 `requiredBy`、`optionalFor`、`extendedBy` 列出直接使用者，供发布者评估影响；这些字段由目录生成，不能手填到条目。广场同时显示关系图。变更基础插件时，从直接使用者继续向下检查，直到受影响的继承和依赖链核对完成。

## 从开发到发布和投稿

1. **作者定义功能和契约。** 遵守[插件 API](plugin-api.md)，在 `plugin.json` 声明名称、API 版本及三类关系。功能、配置、命令和公开资源归属自己的包；公开服务、组件覆盖、权限需求和数据格式写入文档。
2. **作者开发并验证。** 基于下面的测试矩阵检查正常路径、禁用和组合行为；记录可复现命令及结果。任何新增必需关系或基础插件关系都要写明原因及替代方案。
3. **作者准备源码发布。** 同步 `package.json` 版本、npm 依赖范围、许可证、变更说明和迁移指引；打包清单必须包含 `plugin.json`、入口和需要的资源。外部源码提交确定后，取得完整 commit SHA；发布标签可以辅助阅读，但目录始终固定到 commit。
4. **作者提交目录 PR。** 在 `marketplace/entries/` 新增或更新 `<id>.json`，填入发布的固定 commit、入口和清单路径。依赖或基础插件还没有条目时，在同一 PR 补齐。检查生成的反向使用者列表，并在 PR 标明会受影响的插件及兼容性结论。
5. **作者生成与检查。** 运行 `node scripts/check-marketplace.mjs`，提交生成的 Markdown / JSON，再运行 `node scripts/check-marketplace.mjs --check` 和 `node --test tests/marketplace.test.mjs`。本仓库提供 [Plugin checks 工作流](../.github/workflows/plugins.yml)：`Plugin catalog and dependency graph` 无需安装 npm 依赖，核对目录、关系图及目录命令契约；`Plugin composition and content contracts` 安装锁定依赖后执行编辑器构建、组合/内容测试、类型检查和示例构建。两项均以当前 PR 的实际检查结果为准；本地通过或存在工作流文件不表示远端检查已经运行。
6. **维护者审核并合并。** [CODEOWNERS](../.github/CODEOWNERS) 指定维护者审阅。维护者核对固定源码中的 `plugin.json`、实际入口和目录元数据一致；审查许可证、权限、API 与 npm 兼容范围、三类关系、覆盖与回退、测试证据及下游影响。合并前确认当前 PR 两项检查和审查结论；是否强制要求 CODEOWNERS 批准及检查成功，由远端分支保护或规则集配置决定，CODEOWNERS 文件本身不会阻止合并。确认后由维护者合并，目录才进入主分支；校验通过不会自动批准或合并。
7. **作者与维护者持续更新。** 每次源码或关系更新使用新的 PR 和固定 commit，记录变更与迁移步骤。破坏性变更需要明确标记、按包的版本策略升级版本，并完成受影响依赖者和继承者的兼容审查；不能只改一条 SHA 就忽略下游。停用或撤回条目时，同样核对反向关系并协调依赖者。

## 发布前测试矩阵

| 场景 | 必须确认的行为 |
| --- | --- |
| 最小配置 | 插件与它声明的必需/基础插件一起可运行，不依赖额外隐式插件。 |
| 必需依赖缺失 | 给出明确加载错误，配置变更不产生半启用状态。 |
| 可选依赖缺席和存在 | 两种情况分别通过；缺席仍可用，存在时增强生效。 |
| 基础插件缺失或停用 | 继承者明确报错；按依赖顺序停用后，剩余功能正常。 |
| 继承覆盖与回退 | 公开服务兼容，组件覆盖可解释；取消覆盖能回退到基础实现。 |
| 组合与冲突 | 命令、服务、路由、资源和独占组件没有静默覆盖；有冲突时能定位双方。 |
| 停用当前插件 | 功能、路由和资源撤下，用户内容保留，其他插件保持正常行为。 |
| 升级兼容性 | API 版本与 npm 范围声明真实可用；需要迁移时有操作步骤和恢复方式。 |
| 下游影响 | 对反向列表中的依赖者、可选联动者和继承者核对变更，必要时沿链继续验证。 |

审查者依据代码和实际验证记录判断上述结果。目录校验器负责元数据一致性，不会代替作者执行外部插件的功能测试。

以下是外部插件条目的字段格式说明，示例中的仓库和 commit 需要替换为自己的真实值；不要提交示例本身。

```json
{
  "schemaVersion": 1,
  "id": "your-plugin",
  "name": "你的插件名称",
  "summary": "一句话说明插件提供的独立功能。",
  "category": "content",
  "apiVersion": 1,
  "license": "MIT",
  "authors": [{"name": "你的名字", "url": "https://github.com/your-account"}],
  "requires": [],
  "optionalRequires": [],
  "extends": [],
  "dependencies": {},
  "peerDependencies": {"@agent-blog/core": "^0.2.0"},
  "source": {
    "type": "github",
    "repository": "https://github.com/your-account/your-plugin",
    "commit": "0123456789abcdef0123456789abcdef01234567",
    "path": "index.mjs",
    "manifest": "plugin.json"
  }
}
```

| 字段 | 约定 |
| --- | --- |
| `schemaVersion` | 目录格式版本，目前为 `1`。 |
| `id` | 与插件导出的 `name` 一致，小写字母开头，仅含小写字母、数字和连字符；目录内唯一。建议社区插件带作者前缀以避免冲突。 |
| `name` / `summary` | 展示名称和简短说明，分别最多 80 / 200 个字符，不能包含换行。 |
| `category` | `content`、`rendering`、`editor`、`theme`、`integration`、`publishing` 或 `tools`。 |
| `apiVersion` | 当前支持 `1`；应与插件声明一致。 |
| `license` | 源码的 SPDX 许可证标识符，例如 `MIT`、`Apache-2.0`。校验器检查标识符格式；维护者核对实际许可证。 |
| `authors` | 至少一位作者，包含名字和不带账号密码的 HTTPS 主页地址。 |
| `requires` | 必须启用的其他插件运行时名称；这些插件必须有目录条目。无依赖也必须写 `[]`。 |
| `optionalRequires` | 可选联动的插件名称；缺少时本插件仍能独立加载。 |
| `extends` | 必须启用的基础插件名称；无继承也必须写 `[]`。继承通过公开契约组合实现。三类关系均要求被引用条目存在，不能重叠，并共同参与环检测。 |
| `dependencies` / `peerDependencies` | 与 npm 包的运行依赖、对等依赖声明分别一致；没有也必须写 `{}`。插件依赖和 npm 依赖各自声明。 |
| `source` | 外部插件使用 `github`、公开仓库地址、完整小写 40 位 commit SHA、仓库内入口路径 `path` 和 JSON 清单路径 `manifest`；不接受分支或标签。路径必须相对且不含 `..`、转义或反斜线。 |

随本仓库提供的插件使用 `source: {"type":"builtin","path":"packages/notes","package":"@agent-blog/notes"}`。校验器读取真实 `package.json`，核对包名、许可证、运行依赖和对等依赖，并检查导出入口文件；读取同目录的 `plugin.json`，核对插件名称、API 版本和三类关系。版本号从包清单读取，不在条目中重复维护。`publish-on-save` 的包目录和包名分别是 `packages/publish`、`@agent-blog/publish`。

## 审核边界

目录校验器只读取 JSON、文件路径和包清单，不导入插件模块，不拉取外部仓库，不运行安装脚本。它能发现格式错误、重复名称、路径穿越、缺失依赖或基础插件、跨关系的环、本地清单不一致、未固定的来源版本和未更新的生成目录。外部 commit 是否存在、固定清单和入口是否一致、依赖或继承是否完整以及插件行为是否符合声明，仍需要维护者审查；不能把静态校验通过等同于代码审核通过。

目录命令测试会加载本仓库的核心和目录插件，组合测试会执行本仓库的插件实现；这与只读元数据校验分开。两项工作都不会根据外部目录条目下载或执行其来源仓库。审查者不能据此把整个 PR 测试过程描述成“不执行代码”。

插件在同一个 Node.js 进程中执行，拥有启动者的文件和网络权限。当前架构通过独立包、显式依赖、命名注册和冲突检查约束相互影响；它**不提供隔离恶意代码的沙箱**。不要声称已收录的任意第三方插件一定安全，也不要把密钥、私有文章或生产环境配置放进投稿和测试夹具。

更新外部插件时，用新 PR 修改固定 commit 和变更说明；不要悄悄换成浮动分支。撤回条目会影响发现入口，不会远程删除已经安装的代码或文章。每次生成目录按文件名排序、没有时间戳；相同条目应产生完全相同的输出。
