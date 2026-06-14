# 安全与隐私

这篇文档说明 Coder Studio 的本地运行模型、Provider 数据边界和远程访问风险。

## 运行位置

- Coder Studio server 运行在你的机器上。
- Web UI 由本机服务提供。
- 你打开的 workspace 来自本机项目目录。
- Agent 会话通过本机已安装的 Provider CLI 启动。

Coder Studio 本身不是托管代码服务，不会把你的 workspace 作为云端代码环境运行。

## Provider 数据边界

Claude Code、Codex 或其他 Provider CLI 可能会根据各自的行为和配置，发送 prompts、代码上下文、终端输出、文件片段或其他任务数据。

如果你需要严格的数据处理保证，请检查对应 Provider 的文档、账号设置和 CLI 配置。

## 远程访问风险

局域网或远程访问前先设置密码：

```bash
coder-studio config --password <强密码>
coder-studio serve --restart
```

不要在没有认证的情况下把 Coder Studio 暴露到公网。

请把远程 Coder Studio 访问当作远程 shell 访问处理：任何能够通过认证的人，都可能用你的本地用户权限读取文件、运行终端命令，并触发 Provider 工具。

## 实用检查清单

- 开放给其他设备前设置强密码。
- 个人跨设备访问优先使用 Tailscale。
- 提交前审查 Git diff。
- 临时隧道使用结束后及时停止。
- 敏感仓库避免使用公开链接访问。

## 下一步

- [移动端与远程访问指南](mobile-guide.md)
- [当前限制](known-limitations.md)
- [排障指南](troubleshooting.md)
