# 当前限制

这篇文档说明 Coder Studio 当前版本的要求、边界和不适合承诺的场景。

## 这篇文档解决什么问题

帮助新用户在试用前建立正确预期，避免把 Coder Studio 理解成云 IDE、VS Code 替代品或 AI 模型服务。

## 系统要求

- Node.js 24 或更新版本是必需的。
- Coder Studio 通过 npm 全局安装。
- AI Agent 会话依赖本机已安装的 Provider CLI。

## Provider 边界

Coder Studio 不内置 Claude、Codex 或其他模型。它负责在工作区中启动和管理本地 Provider CLI。

如果没有安装 Provider CLI：

- 可以打开 workspace
- 可以浏览文件
- 可以使用终端
- 不能创建对应的 Agent 会话

## 移动端边界

移动端适合查看、监控和审查，不适合作为第一次试用或重度编码的主力入口。

推荐移动端使用场景：

- 查看长任务进度
- 阅读 Agent 输出
- 浏览文件
- 查看 Git diff
- 判断是否需要回到桌面端介入

## 远程访问边界

Coder Studio 默认更适合本机或可信网络访问。跨设备或公网访问需要你自己配置网络和认证。

远程访问前应当：

```bash
coder-studio config --password <强密码>
coder-studio config --host 0.0.0.0
coder-studio serve --restart
```

不要把无密码的 Coder Studio 暴露到公网。

## 当前不主打的能力

当前增长发布阶段不主打：

- 云端托管工作区
- 多人团队权限系统
- 手机端完整编码替代桌面端
- 插件市场
- 会话回放
- 偏好云同步

这些方向可能以后会演进，但不是第一次试用 Coder Studio 的核心价值。

## 下一步

- [快速开始](quick-start.md)
- [第一次 Agent 运行](first-agent-run.md)
- [移动端与远程访问指南](mobile-guide.md)
- [排障指南](troubleshooting.md)
