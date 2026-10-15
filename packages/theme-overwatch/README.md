# @agent-blog/theme-overwatch

非官方《守望先锋 2》灵感博客皮肤，与 Blizzard 无关联；不包含游戏宣传图、官方字体或标志。

奶白与浅灰阅读底色，橙色行动按钮、深蓝灰 HUD、倾斜标题、切角与原创未来建筑插画。所有资产随包提供，无外部资源、浏览器脚本或第三方运行时依赖。

```sh
agent-blog plugin disable @agent-blog/theme-paper --site examples/demo
agent-blog plugin enable @agent-blog/theme-overwatch --site examples/demo
agent-blog build --site examples/demo --json
```

仅启用一个整体皮肤。入口复用核心 shell，只替换 header 和 intro 展示组件，保留 header:nav 插槽及所有正文插槽。文章、说说、独立页、归档、友链、日期和页脚继续由各自插件提供；Markdown、高亮和数学插件均可选。首页行动链接指向真实的最新已发布内容，不另建导航或发布逻辑。

插件 API 为 v1，要求 `@agent-blog/core: ^0.2.0`。`requires`、`optionalRequires`、`extends` 均为空；不继承其他皮肤。运行时注册展示组件和本包静态资源，不写内容文件、不读取环境变量、不发起网络请求。停用时先执行 `plugin disable @agent-blog/theme-overwatch`，再启用原皮肤并重新构建；运行中的预览或编辑服务需要重启以读取新配置。

正文支持宽表格、代码块及公式的局部滚动、响应式图片、长标题折行、键盘焦点和减少动画偏好。停用或换肤不会修改内容与元数据。SVG 为本包原创装饰，隐藏于辅助技术。

License: MIT.
