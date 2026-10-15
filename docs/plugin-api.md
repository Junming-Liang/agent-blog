# 插件协议 v1

这是使用者和 agent 扩展 Agent Blog 的公开边界。内置的 Markdown、高亮、数学、皮肤和编辑器插件与使用者插件使用同一个 API。功能既能整体替换，也能在组件、插槽和工作流中组合扩展。

## 插件声明与配置

```js
/** @type {import('@agent-blog/core').Plugin} */
export default {
  name: 'article-summary',
  apiVersion: 1,
  description: 'Expose article metadata to agents.',
  setup(api, options) {
    api.command({
      name: 'article-summary',
      description: 'Read one article and its current revision.',
      arguments: ['slug'],
      flags: {body: {type: 'boolean', description: 'Include the body'}},
      run({args, flags}) {
        const post = api.posts.read(args[0]);
        return {
          slug: post.slug,
          revision: post.revision,
          metadata: post.metadata,
          ...(flags.body ? {body: post.body} : {})
        };
      }
    });
  }
};
```

在 `blog.json` 中配置：

```json
{"use":"./plugins/article-summary.mjs","enabled":true,"options":{}}
```

`use` 可以是相对于站点的本地模块、绝对模块路径或已安装的 npm 包。包名优先从站点解析，再从框架安装位置解析，因此预设也能用于仓库外的新站点。停用的模块不会被导入。当前核心只接受 `apiVersion: 1`；不匹配的版本会报告 `PLUGIN_API_VERSION`。

`requires: ['markdown']` 声明插件名称依赖；核心自动决定初始化顺序。缺少依赖、循环依赖和重名插件会明确报错，不会自动下载或启用别的模块。`setup` 用于注册功能，应避免修改文件或启动后台进程；初始化可以异步完成。

插件还可以声明 `optionsSchema`，以 JSON Schema 描述配置。它会随插件清单进入 `schema --json`，让 agent 同时发现配置入口。与命令的 `inputSchema` 一样，具体选项的领域校验由插件负责。

## 扩展接口

| 接口 | 契约 |
| --- | --- |
| `api.posts.read(slug)` | 返回 `{slug, metadata, body, revision}` |
| `api.posts.list()` | 返回所有文章与草稿，按日期排序 |
| `api.posts.validate(input)` | 校验未知输入，返回 `{metadata, body}` |
| `api.posts.write(slug, input, revision)` | 修改要求最新版本；新建使用 `null`；版本冲突拒绝写入 |
| `api.posts.remove(slug, revision)` | 要求最新版本再删除 |
| `api.renderer(fn)` | 注册一个正文渲染器：`(body, {post,site}) → HTML` |
| `api.transform(fn)` | 注册顺序执行的 HTML 变换：`({html,post,site}) → HTML` |
| `api.layout(fn, options)` | 替换整页布局；`{unstyled:true}` 移除默认皮肤的 CSS 和资产 |
| `api.component(name, fn)` / `api.slot(name, fn)` | 替换页面组件或追加插槽内容 |
| `api.codec(adapter)` / `api.storage(adapter)` | 替换文章序列化格式或原始来源存储 |
| `api.validator(fn)` | 在读写与预览中校验自定义元数据 |
| `api.permalink(fn)` | 替换文章 URL；构建和预览共用 |
| `api.builder(fn)` | 包装或替换静态构建流程 |
| `api.middleware(fn)` | 在 Host / Origin 检查后包装 HTTP 请求处理 |
| `api.commandMiddleware(fn)` / `api.execute(name, input)` | 包装命令执行或调用已注册插件命令 |
| `api.on(event, fn)` | 监听文章写入、删除、构建、命令完成 |
| `api.command(definition)` | 注册可被 CLI 和 agent 发现的命令 |
| `api.route(prefix, handler)` | 为本地预览服务注册路由前缀 |
| `api.output(relativePath, render)` | 注册静态文件或独立页面，同时支持预览和构建 |
| `api.asset(prefix, directory, options)` | 注册 `/_assets/name` 下的资源 |
| `api.stylesheet(url)` | 将本地资源样式加入页面 |
| `api.provide(name, value)` / `api.require(name)` | 在已声明依赖的插件间分享服务 |
| `api.escapeHTML(value)` / `api.fail(code, message, status?)` | 安全转义文本或返回结构化错误 |

`api.site` 提供配置和站点根目录，`api.apiVersion` 为 `1`。渲染器、变换和布局可以返回 Promise。正文渲染器和布局各只能启用一个；HTML 变换可组合多个。正文渲染结果必须是字符串。

修改正文时保留全部元数据。默认文件适配器保留文件作为唯一内容来源；启用其他存储适配器时，由该插件负责其数据源。插件接口不会自动迁移已有内容。

## 可发现的命令

命令定义包含 `name`、`description`、`run`，可选字段如下：

- `arguments`: 必需的位置参数名数组。
- `flags`: 参数定义，如 `{limit:{type:'number',required:true},drafts:{type:'boolean'}}`；支持 `string`、`number`、`boolean`、`required` 和 `enum`。
- `stdin`: `text` 或 `json`，启用 `--stdin` 输入。
- `inputSchema`: JSON Schema，供 agent 发现输入结构。领域输入由命令实现校验；核心不运行一个通用 JSON Schema 引擎。

`run({args,flags,input})` 返回可 JSON 序列化的结果或 Promise。CLI 和编辑器命令入口使用同一套参数验证与命令中间件。核心为结果加上统一的成功信封；抛出的错误使用错误信封。命令回调得到自己的参数，CLI 的 `--site`、`--json` 等全局选项不作为插件参数传递。插件不能覆盖核心命令名。

`schema --json` 会列出插件命令、参数定义、输入结构、插件依赖和协议版本。新插件启用前会完整校验初始化；失败时现有配置保持原样。

## HTTP 路由

`api.route('/my-feature', handler)` 接收 `{req,res,url,pathname,blog,json,html,readJSON}`。路由匹配前缀及其子路径，处理器负责结束响应；注册顺序决定匹配优先级。可使用 `json(res, status, value)` 或 `html(res, value)`，也可使用 Node 的请求和响应对象。

`readJSON(req)` 接受 `application/json`，限制请求为 2 MiB。输入仍需校验。整个服务器只监听回环地址，并在路由执行前检查 Host 和 Origin；插件路由不会进入静态构建结果。

## 资源与构建

`api.output('feed.json', ({site,posts}) => JSON.stringify(posts.map(post => post.metadata)))` 可以生成索引。回调中的 `posts` 只包含已发布文章。`api.output('about/index.html', '<h1>About</h1>')` 注册独立页面，可在 `/about/` 预览。插件无需直接写入构建目录；核心校验路径并生成文件。输出不能覆盖核心首页、文章或资产路径。

`asset` 的选项包含：

- `public: false`：只用于开发预览，不复制到 `dist`。编辑器使用这个选项。
- `include: ['style.css', 'fonts']`：只提供、复制指定文件或子目录。数学插件只包含样式和字体，不携带 KaTeX 的浏览器脚本。

资产前缀不可重叠。资源路径不得逃出注册目录，构建也不会复制符号链接。

框架没有内置模型调用、自动部署或插件下载。使用者可让 agent 在这个边界之上实现具体需求，并通过本地测试、预览、启用完成验证。

## 皮肤、组件和插槽

皮肤是普通插件。整体替换时注册 `layout`，再注册自己的资源与样式：

```js
setup(api) {
  api.layout(context => context.render('shell'), {unstyled: true});
  api.asset('/_assets/my-theme', myThemeDirectory);
  api.stylesheet('/_assets/my-theme/style.css');
}
```

`myThemeDirectory` 是插件自行定位的资源目录。`unstyled` 仅移除核心默认 CSS，不移除公式、高亮等功能插件自己的样式。完整可运行的参考是 `packages/theme-paper/index.mjs` 和 `packages/theme-terminal/index.mjs`；两者没有运行时依赖。换肤只改变页面与资产，不改变文章源文件。

默认布局拆成以下命名组件，可以只替换其中一个：

` shell → head / header / index / article / footer `；`index` 使用 `intro` 和 `list`，`list` 使用 `card`，`article` 使用 `metadata`。

```js
api.component('footer', () => '<footer>My own footer</footer>');
api.slot('post:after', ({post}) => `<aside>${api.escapeHTML(post.metadata.series || '')}</aside>`);
```

组件同名只能有一个替换者；插槽可以有多个回调，结果按注册顺序拼接。默认插槽有 `head:after`、`header:after`、`index:before`、`index:after`、`post:before`、`post:after`、`footer:before`。自定义布局也可以调用任意新命名插槽。

布局、组件和插槽共享 `PageContext`：原来的 `site/post/html/posts/styles`，以及 `permalink(post)`、`render(name, overrides?)`、`renderDefault(name, overrides?)`、`slot(name)`。`renderDefault` 可供组件包装原实现而不递归调用自身。组件必须返回字符串或 Promise。输出用户文本时使用 `escapeHTML`。

切换示例站点皮肤：

```sh
agent-blog plugin disable @agent-blog/theme-paper --site examples/demo
agent-blog plugin enable @agent-blog/theme-terminal --site examples/demo
agent-blog build --site examples/demo --json
```

同时启用两个整体布局会明确报错，配置校验失败时保留原配置。预览进程需要重启以加载皮肤或其他插件配置变化。

## 内容格式与存储适配器

内容流水线是：原始来源 → `codec.decode` → 标准 `{metadata,body}` → 校验 → 渲染。写入走相反方向，revision 由原始来源字符串的 SHA-256 计算。不同格式和存储都使用同一套 CLI、编辑器和版本冲突规则。

`codec` 的接口为 `{extension, decode(slug, source), encode(input)}`。默认 `.md` + JSON front matter；插件可提供 `.json`、YAML front matter 或其他文本格式。`examples/demo/plugins/json-format.mjs` 是完整示例，启用后读写 `content/*.json`。切换格式不会自动把已有 `.md` 转为 `.json`，迁移应使用独立命令并验证内容。

`storage` 的接口为：

```ts
read(slug): string | null;
list(): string[];
write(slug, source, expectedRevision): void;
remove(slug, expectedRevision): void;
```

原始来源可以放在其他本地目录或同步数据库中。适配器负责在同一个事务或锁内比较版本并写入 / 删除；创建时版本是 `null`。核心的提前检查用于快速发现错误，不能代替适配器的原子比较。违背该契约会失去并发保护。

v1 的 `posts`、codec、storage 和自定义校验是同步接口；异步远程存储需要本地同步缓存 / 导入插件，不能直接返回 Promise。命令、渲染、HTTP、构建和生命周期回调支持异步。

内容适配器必须在首次使用 `posts` 前注册，依赖消费者应使用 `requires` 确定顺序。原有插件在 setup 中读取默认内容仍然可用；建议 setup 只注册能力，在命令等运行时处理器中访问内容。重复适配器或读取后替换适配器会明确报错。

`api.validator(input)` 为额外字段提供校验，回调接收内容副本，可以抛出 `api.fail`；它不会通过修改参数改变文章。核心仍然要求非空标题、布尔 draft 和正文字符串。

## 构建、URL 和请求流程

`api.permalink(post => '/notes/' + encodeURIComponent(post.slug) + '/')` 改变文章 URL、列表链接和生成文件位置。URL 必须是本地绝对目录路径，结尾 `/`；不允许路径穿越、资产覆盖和重复输出。预览与静态构建使用同一套路径映射。

`api.builder(async ({blog, build}) => build())` 可以包装默认构建；也可以使用另一套输出器。返回 `{output,posts,plugins}`。自定义输出器负责排除草稿、管理自己的输出位置；调用传入的 `build()` 可保留默认构建的内容筛选、资产处理和文件保护。

`api.middleware(async (context, next) => next())` 包装 HTTP 路由；请求已经通过回环 Host 与 Origin 检查。`api.commandMiddleware(async (context, next) => next())` 包装 CLI / 编辑器 / 插件命令；参数已经验证。`next()` 最多调用一次。可执行额外检查或处理返回结果；中间件不要修改 context 来重写调用参数。

`api.execute(name, {args?,flags?,input?})` 调用已注册插件命令，支持省略空 args/flags。核心 CLI 保留标准命令名，行为通过命令中间件扩展；站点初始化和插件配置发生在插件加载前，不经过该中间件。

## 生命周期通知

可监听 `post:written`、`post:removed`、`build:completed`、`command:completed`。具体 payload 类型见 `LifecycleEvents`。每个回调收到独立副本，支持 Promise。

这些是操作成功后的通知，不承担事务验证。额外字段检查使用 `validator`；需要阻止命令或构建时，使用相应中间件或构建适配器。

通知进入进程内队列，由 CLI、构建、HTTP 入口执行并等待。观察者失败会返回 / 记录 `HOOK_FAILED` warnings，后续观察者继续执行，已经保存的文章保持成功。独立脚本直接调用 `blog.posts.write` 或 `blog.execute` 后，需 `await blog.flushEvents()` 并检查 warnings。HTTP 自定义处理器可在回应前 flush；未处理的 warnings 会出现在预览服务日志。通知不是持久化任务队列，不提供跨进程重试或定时任务。

## 编辑器内部插件

依赖 `editor` 插件并取得服务：

```js
/** @type {import('@agent-blog/editor').EditorService} */
const editor = api.require('editor');
editor.register({name: 'my-tools', module: '/_assets/my-tools/browser.mjs', options: {}});
```

插件同时用 `api.asset` 注册浏览器资源，推荐 `{public:false}`。也可以注册 `stylesheet` 作为纯编辑器皮肤。浏览器模块导出 `setup(api, options)`，无需修改默认编辑器。

| 浏览器接口 | 用途 |
| --- | --- |
| `getDraft()` | 取得包含未保存修改的文章副本 |
| `updateDraft({metadata?,body?})` | 更新扩展字段或正文，保留为未保存修改 |
| `insert(before, after?)` | 在当前选区插入文本 |
| `button({id,label,location?,run})` | 添加工具按钮，统一处理执行错误 |
| `mount(location, element)` | 挂载 toolbar / sidebar / panels / topbar 中的元素 |
| `extension(value)` | 添加 CodeMirror 扩展，打开其他文章后仍生效 |
| `on('open' / 'change' / 'saved', fn)` | 响应打开、编辑、保存事件；返回取消订阅函数 |
| `command(name, invocation?)` | 调用与 Agent CLI 相同的插件命令 |
| `save(draft?)` / `status(message,error?)` | 保存当前内容或显示状态 |

`editor` 是当前 CodeMirror 实例，`codemirror` 提供同一份 EditorState / EditorView / StateEffect / keymap / syntaxHighlighting，供编辑器扩展使用。想换编辑引擎或整个编辑界面，可以停用默认 editor 并提供另一套路由插件。

完整实例是 `examples/demo/plugins/writing-tools.mjs` 及其浏览器模块：添加“引用”“统计”按钮、正文统计面板和系列字段；浏览器使用未保存内容调用 `writing-stats`，Agent 也能通过 CLI 使用该命令。自定义字段在保存期间继续编辑时也会保留，下一次保存再提交。

异步插件操作应在开始时取得 draft 副本，返回后确认当前文章的 slug / revision 仍匹配，再修改界面；`getDraft` 不提供跨文章或与任意外部编辑器的事务隔离。浏览器扩展与服务器插件都是使用者信任的代码。


## 独立功能与可选联动

每个新功能使用独立插件。内核只提供通用宿主协议；功能的数据字段、CLI、页面和编辑入口由同一个插件负责。相关的展示可由皮肤覆盖，数据和行为的职责仍归功能插件。

`optionalRequires: ['editor']` 表示：编辑器启用时先初始化编辑器，否则插件独立运行。通过 `api.optional('editor')` 获取服务，缺失时返回 `undefined`。`api.require(name)` 要求服务存在；消费其他插件的服务时，提供方必须出现在 `requires` 或 `optionalRequires`。可选依赖存在时同样检查循环。注册的路由前缀不得互相覆盖，也不得遮住静态输出。

```js
export default {
  name: 'example-feature', apiVersion: 1, optionalRequires: ['editor'],
  setup(api) {
    api.indexFilter(post => post.metadata.type !== 'example');
    api.component('example:card', c => api.escapeHTML(c.post.metadata.title), {fallback: true});
    api.slot('index:after', c => c.posts.length ? c.render('example:card', {post: c.posts[0]}) : '');
  }
};
```

`indexFilter` 是同步布尔谓词，只筛选首页主要文章列表。多个过滤器按 AND 组合，不能删改文件。页面上下文的 `posts` 仍包含全部已发布内容，方便功能插件在自己的区块展示说说等内容。插件移除后其过滤器、页面和资源随配置重新加载撤下，内容文件保留，其他插件继续工作。

`component(name, render, {fallback: true})` 声明功能默认展示。普通 `component(name, render)` 可覆盖它；两者注册顺序无关。`renderDefault` 使用功能 fallback，再使用内置组件。相同层次重复注册会报错。新增功能组件用 `插件名:组件名`，例如 `notes:card`；公共日期展示由 `date` 组件负责，页头导航通过 `header:nav` 插槽贡献。

页面及静态输出上下文都有 `renderPost(post)`、`render`、`renderDefault`、`slot` 和 `permalink`。静态输出还提供 `renderPage({title, html})`，以当前皮肤渲染独立页面；`url` 是当前页面 URL。输出回调默认只收到已发布内容。`transform` 回调也提供 `permalink`，可用于兼容旧页面。

编辑器浏览器 API 新增 `newPost({metadata?, body?})`，保留保存中和未保存内容确认逻辑，返回是否新建成功。`getSite()` 返回当前站点标识，`isDirty()` 返回是否存在未保存修改。插件注册按钮、节点、事件与语法扩展后若 setup 失败，编辑器撤回该扩展已注册的 UI 和监听，不影响其他扩展。插件仍是受信任的同进程代码，不承诺阻止恶意文件访问或进程崩溃。

扩展通过追加插槽组合，通过命名空间避免覆盖。正文 transform 和插槽获得独立的内容快照；修改快照不会写回内容文件或影响其他插件。声明依赖的共享服务允许按其服务协议协作，插件不得绕过协议修改其他插件内部状态。


## 插件清单、依赖与继承的维护

可分享的包提供 `plugin.json`，包含 `name`、`apiVersion`、`requires`、`optionalRequires`、`extends`。运行时入口导入并展开同一个清单，插件广场静态校验这些字段与条目完全一致；npm 依赖与许可证核对 `package.json`。避免代码、文档和目录各自维护不同的关系。

`requires` 是必需的功能依赖；`optionalRequires` 在存在时排序、缺失时独立运行；`extends` 表示必需的基础插件，先初始化基础能力，子插件通过服务、插槽、默认组件组合继承行为。继承关系不会自动复制对象或绕过独占接口检查：基础插件应将允许皮肤覆盖的组件注册为 fallback，存储、renderer、layout 等独占适配器仍只允许一个提供者。依赖与继承形成同一初始化图，缺失基础、循环关系和未声明的服务访问都会报错。

发布和升级须按[插件广场流程](marketplace.md)审查固定源码版本、关系图、反向依赖、接口兼容以及基础插件变更的影响。启用前审查源码，升级通过明确配置；目录不会自动下载安装插件。

浏览器插件在 workspace 的 `package.json` 中声明 `"agentBlog": {"browser": "./browser.mjs"}` 后，`npm run build:editor` 会分别构建到各插件自己的 `public/bundle/browser.js`。插件必须将 `public` 加入发布文件清单，并通过自己的私有 `api.asset` 注册浏览器资源。`npm run build:editor -- editor-markdown` 只构建 Markdown 编辑插件，不写入编辑器或其他插件的目录；`npm run build:editor -- editor` 仅构建编辑器本身。普通 DOM 扩展仍可直接提供源码模块。

### 编辑器共享模块契约

`@agent-blog/editor/runtime` 公开 `browser-runtime.json`（`apiVersion: 1`）。编辑器页面在加载模块前安装 import map，提供 `@codemirror/state`、`@codemirror/view`、`@codemirror/language`、`@codemirror/commands`、`@lezer/common` 和 `@lezer/highlight`。这些模块由编辑器统一构建，保证类、Facet 和语法标签的对象身份一致；编辑器产物不包含 Markdown、JavaScript、Python 等语言语法。

需要这些共享模块的插件声明 `@agent-blog/editor` peer dependency，以及运行时 `requires: ['editor']`。独立构建时将契约里的模块全部设为 bundler 的 `external`，保留裸模块导入交给 import map 解析；其他依赖和语言解析器打包在插件自己的产物内。例如：

```js
import runtime from '@agent-blog/editor/runtime' with {type: 'json'};
import {build} from 'esbuild';

await build({
  entryPoints: ['browser.mjs'],
  outfile: 'public/bundle/browser.js',
  bundle: true,
  format: 'esm',
  external: Object.keys(runtime.modules)
});
```

当前契约对应 CodeMirror 6 和 Lezer 1。`autocomplete`、`lint` 等模块尚未列为共享接口，插件可以将自身使用的实现打包在包内；需要跨插件交换它们的 Facet、状态或对象时，应先扩充明确的共享契约，不能假设各自产物里的副本具有相同身份。兼容当前契约的插件可单独构建、发布和升级，无需重新发布编辑器。
