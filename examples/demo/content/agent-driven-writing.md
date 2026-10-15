---
{
  "title": "让写作回到文字，让扩展交给 Agent",
  "description": "一个轻量博客的起点：开放的文件、清晰的接口，以及随时可以替换的能力。",
  "date": "2026-10-14",
  "tags": ["设计", "Agent", "写作"],
  "draft": false,
  "readingSpeed": 240
}
---
## 从一个普通文件开始

博客的核心是你的文字。文章保存在 **Markdown 文件**中，可以在网页上写，也可以用自己喜欢的本地编辑器写。

Agent 使用同一套 CLI 读取、修改和构建文章。修改之前读取版本；发生冲突时保留你的内容，合并后再提交。

> 让核心保持小，把具体的想法放进可以替换的插件。

## 用几行代码表达一个想法

```javascript
export default {
  name: 'my-feature',
  apiVersion: 1,
  setup(api) {
    api.command({
      name: 'my-feature',
      description: 'Read the published posts.',
      run: () => api.posts.list().filter(post => !post.metadata.draft)
    });
  }
};
```

插件能增加命令、修改文章呈现、接入页面资源，也能提供自己的编辑工具。

## 数学也属于文字的一部分

行内公式可以自然地嵌在句子中，例如 $E = mc^2$。

更完整的推导可以单独展示：

$$
\mathcal{L}(\theta) = \mathbb{E}_{x \sim p(x)}\left[\lVert f_\theta(x) - y \rVert_2^2\right]
$$

Markdown、代码高亮和公式都由独立插件提供。停用一个插件，核心仍然能管理和保存文章。

## 保留定制的空间

| 你想改变什么 | 可以从哪里开始 |
| --- | --- |
| 新增一个操作 | CLI 命令插件 |
| 文章排版 | 渲染与布局插件 |
| 额外的字段 | 文章元数据 |
| 自己的写作工具 | 本地 HTTP 路由插件 |

先把想写的内容留下，再让 Agent 把你需要的能力补上。
