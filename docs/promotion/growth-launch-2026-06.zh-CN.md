# Coder Studio 中文增长发布长帖

## 推荐标题

我做了一个自部署的 AI Coding 工作台，用来管理 Claude Code / Codex 长任务

## 正文草稿

很多 AI coding 工作流一开始都很轻：打开终端，启动 Claude Code 或 Codex，写一个 prompt，然后等它输出。

但进入真实项目后，问题会变得分散：

- Agent 在终端里跑，文件在编辑器里看
- 改动需要再切到 Git 工具里审查
- 长任务经常要反复回来确认有没有卡住
- 换到手机或平板后，很难看到完整 workspace 上下文

Coder Studio 想解决的不是“再做一个云 IDE”，而是给 AI coding agent 一个自部署的浏览器工作台。

它把这些东西放在同一个 workspace 里：

- Claude Code / Codex 等 Agent 会话
- 本地终端
- 文件树和 Monaco 编辑器
- Git 状态、changed files 和 diff
- Supervisor 长任务监督
- Work Analysis 工作复盘
- Skills 管理
- 桌面、平板、手机的同一个 workspace 访问

安装方式：

```bash
npm install -g @spencer-kit/coder-studio
coder-studio open
```

第一次试用建议做一个小任务：

1. 打开一个本地仓库。
2. 创建 Agent 会话。首次试跑建议选择 Claude 或 Codex。
3. 让 Agent 改 README 的一小段说明。
4. 在 Git diff 里审查结果。
5. 用手机或平板打开同一个 workspace 查看进度。

它不是：

- 不是云 IDE
- 不是 VS Code 替代品
- 不是 AI 模型服务
- 不是承诺手机完整替代桌面编码

它更像是围绕本地 repo、本地 shell 和 AI coding CLI 的一层工作台。Coder Studio 本身不是托管代码服务，打开的是本地仓库；Provider CLI 可能根据自己的行为和配置发送 prompts、代码上下文、终端输出、文件片段或其他任务数据。

项目地址：

https://github.com/spencerkit/coder-studio

npm：

https://www.npmjs.com/package/@spencer-kit/coder-studio

如果你主要使用 Claude Code / Codex，或者正在关注 Gemini CLI、Cursor Agent、OpenCode、Aider 这类 CLI agent 工作流，尤其经常跑长任务、审查 diff、或者希望离开电脑后还能看进度，这个项目应该值得试一下。

## V2EX 发布备注

- 标题保持技术导向，不使用夸张词。
- 首帖重点解释“为什么不是云 IDE”。
- 评论区优先收集安装、Provider、Node 版本和 PATH 问题。
- 不在首帖承诺插件系统、团队协作或云同步。
