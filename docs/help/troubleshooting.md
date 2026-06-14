# 排障指南

这篇文档整理常见问题的排查和解决方案。

## 这篇文档解决什么问题

遇到问题时，从这里快速找到原因和解决方法。

## 前置条件

- 已安装 Coder Studio 和 Node.js >= 24.0.0
- 能够执行 `coder-studio status`、`coder-studio logs` 等 CLI 命令

## 首次运行快速排查

如果第一次试用没有顺利跑起来，按这个顺序排查：

1. `node --version` 确认 Node.js >= 24.0.0。
2. `coder-studio version` 确认 CLI 已安装。
3. `coder-studio status` 确认服务正在运行。
4. `coder-studio logs` 查看最近错误。
5. `which <provider-command>` 确认 Provider CLI 在 PATH 中。
6. `<provider-command> --version` 确认 Provider CLI 可执行。
7. 如果浏览器打不开，手动访问 `coder-studio status` 输出的 URL。
8. 如果移动端打不开，确认服务监听 `0.0.0.0` 且防火墙允许该端口。

首次试用建议先在桌面端完成，不要一开始就通过公网隧道或手机端排查所有问题。

## 服务启动失败

如果 `coder-studio serve` 或 `coder-studio open` 启动后没有正常响应：

1. 检查 Node.js 版本：`node --version`，需要 >= 24.0.0
2. 尝试前台模式排查：`coder-studio serve --foreground`
3. 查看日志：`coder-studio logs`

## 浏览器打不开页面

`coder-studio open` 执行后浏览器没有自动打开：

1. 先确认服务是否运行：`coder-studio status`
2. 如果状态为 running，手动在浏览器访问终端输出的 URL
3. 如果状态为 stopped，检查日志：`coder-studio logs`

## 页面一直显示连接中

1. 检查服务状态：`coder-studio status`
2. 检查网络是否能访问服务地址
3. 尝试刷新页面
4. 如果设置了认证密码，确认密码正确

## 打不开工作区

1. 确认服务正常运行
2. 确认所选目录确实存在
3. 如果目录权限受限，尝试换一个目录测试

## Provider 未安装或不可用

1. 验证 Provider 是否已安装：
   ```bash
   which claude
   which codex
   which gemini
   which agent
   which opencode
   claude --version
   codex --version
   gemini --version
   agent --version
   opencode --version
   ```
2. 如果未找到命令，按 [Provider 配置指南](providers.md) 安装或修复 PATH。
3. 如果普通终端能找到命令，但 Coder Studio 找不到，重启服务：
   ```bash
   coder-studio serve --restart
   ```
4. 如果仍不可用，查看日志：
   ```bash
   coder-studio logs
   ```
5. 提交问题时附上 Node 版本、Provider 版本、`which` 输出和日志片段。

## 无法创建会话

1. 确认 Provider 已安装且可在终端中正常执行
2. 检查服务是否正常运行
3. 查看 Agent 终端是否有错误输出

## 终端没有正常显示

1. 检查终端面板是否被隐藏，点击顶栏终端图标切换显示
2. 尝试关闭终端重新创建
3. 如果问题持续，查看日志：`coder-studio logs`

## 认证相关问题

### 忘记密码

1. 查看 CLI 配置：`coder-studio config`，其中显示当前配置的密码
2. 或通过 `coder-studio config --password newpassword` 重置

### 登录被阻断

多次登录失败后 IP 可能被临时封禁：

1. 查看被封禁的 IP：`coder-studio auth ban-list`
2. 解封指定 IP：`coder-studio auth unblock --ip <你的IP>`

## 日志和数据文件位置

### 日志文件

- 默认位置：`~/.coder-studio/logs/`
- 包含 `server.out.log` 和 `server.err.log`
- 也可以用 `coder-studio logs` 快速查看

### 配置文件

- CLI 配置：`~/.coder-studio/config.json`
- 状态目录：`~/.coder-studio/data/`
- 可以通过 `coder-studio config --state-dir /new/path` 修改状态目录

## 提交问题前建议提供哪些信息

- Node.js 版本
- Coder Studio 版本：`coder-studio version`
- 服务状态：`coder-studio status`
- 最近的日志输出：`coder-studio logs`
- 操作系统和浏览器版本
