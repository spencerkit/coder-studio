# 第一次 Agent 运行

这篇文档带你完成第一次有效的 Coder Studio Agent 会话：打开项目、创建推荐的首次 Provider 会话、观察输出，并在 Git diff 中审查改动。

## 这篇文档解决什么问题

快速验证 Coder Studio 是否已经可以承接真实 AI coding 工作流，而不只是打开界面。

## 前置条件

- 已安装 Coder Studio：`npm install -g @spencer-kit/coder-studio`
- Node.js 版本为 24 或更新：`node --version`
- 至少安装一个 Provider CLI。首次试跑建议选择 Claude Code 或 Codex：
  - Claude Code：`npm install -g @anthropic-ai/claude-code`
  - Codex：`npm install -g @openai/codex`
- Provider CLI 可以在普通终端中执行：
  - `claude --version`
  - `codex --version`

## 1. 启动 Coder Studio

```bash
coder-studio open
```

浏览器会自动打开。如果没有自动打开，先执行：

```bash
coder-studio status
```

然后手动访问命令输出里的本地地址。

## 2. 打开一个本地项目

在欢迎页点击 **打开工作区**，选择一个你可以安全试验的小型仓库。

建议第一次选择：

- 有 README 的个人项目
- 有 Git 仓库历史的项目
- 不包含生产密钥或敏感配置的项目

## 3. 创建推荐的首次 Provider 会话

进入工作区后，点击 **创建会话**，选择已检测到的 Provider。首次试跑建议选择 Claude 或 Codex，因为对应安装和排障文档最完整。

如果 Provider 显示未安装：

1. 回到普通终端安装对应 CLI。
2. 用 `claude --version` 或 `codex --version` 验证。
3. 刷新 Coder Studio 页面或重新打开工作区。

## 4. 使用一个安全的小任务

第一次运行不要让 Agent 直接做大规模重构。建议使用这个任务：

```text
请阅读 README，补充一小段“本项目适合谁使用”的说明。改动保持在 1-2 段内，不要改代码。
```

这个任务适合第一次验证，因为：

- 改动范围小
- Git diff 容易审查
- 即使结果不理想也容易回滚

## 5. 查看输出和文件变化

会话运行时，观察 Agent 面板里的输出。任务结束后：

1. 打开 Git 视图。
2. 查看 changed files。
3. 打开 diff。
4. 判断改动是否符合你的要求。

如果你不满意，可以继续在同一个 Agent 会话中要求它调整，也可以直接手动编辑文件。

## 6. 在移动端查看进度

如果你想用手机或平板查看进度，先阅读 [移动端与远程访问指南](mobile-guide.md)。

移动端适合：

- 查看 Agent 是否还在运行
- 查看终端输出
- 浏览文件和 diff
- 监督长任务

移动端不适合作为第一次试用时的主力编辑环境。第一次 Agent 运行建议先在桌面端完成。

## 常见问题

**Q：没装 Claude 或 Codex 能不能试？**
可以打开工作区、浏览文件、使用终端，但需要安装某个 Provider 的 CLI 后才能创建对应 Agent 会话。

**Q：安装了 Provider 但 Coder Studio 仍然找不到？**
在普通终端执行 `which <provider-command>` 和 `<provider-command> --version`。如果找不到，说明安装目录不在 PATH 中。按 [Provider 配置](providers.md) 排查。

**Q：Agent 改坏了怎么办？**
先看 Git diff。你可以手动编辑修正，也可以用 Git 丢弃不需要的改动。

## 下一步

- [Provider 配置](providers.md)
- [移动端与远程访问指南](mobile-guide.md)
- [排障指南](troubleshooting.md)
- [常见工作流](workflows.md)
