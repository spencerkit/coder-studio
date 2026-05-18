# 移动端与远程访问指南

这篇文档介绍如何通过手机浏览器使用 Coder Studio，以及如何把本机运行的 Coder Studio 安全地开放给其他设备或外网访问。移动端适合查看状态、监控 Agent 进度和轻量操作。

## 这篇文档解决什么问题

如何在手机上访问和使用 Coder Studio，包括局域网访问、远程访问、界面导航、会话管理和文件查看。

## 前置条件

- Coder Studio 服务已在电脑上运行（`coder-studio serve` 或 `coder-studio open`）
- 如果要从其他设备访问，建议先设置密码：`coder-studio config --password <强密码>`
- 如果要从局域网其他设备访问，服务需要监听非 localhost 地址：`coder-studio config --host 0.0.0.0`
- 修改配置后重启服务：`coder-studio serve --restart`

> 如果不知道本机 IP 和端口，执行 `coder-studio status` 查看监听地址和端口。

## 选择访问方式

| 场景 | 推荐方式 | 适合谁 |
|------|----------|--------|
| 手机和电脑在同一个 Wi-Fi | 局域网 IP 访问 | 家里、办公室内网、临时查看 |
| 只有自己的设备需要远程访问 | Tailscale | 多设备开发者、长期使用 |
| 临时给外网一个访问地址 | ngrok | 演示、临时测试、Webhook |
| 有自己的域名并想长期暴露 | Cloudflare Tunnel | 固定域名、长期远程访问 |

不建议直接把 Coder Studio 端口暴露到公网。至少先启用密码，并优先使用 Tailscale、ngrok 或 Cloudflare Tunnel 这类反向隧道/VPN 方案。

## 局域网访问

局域网访问适合手机和电脑在同一 Wi-Fi 下的情况。

### 1. 启用密码

```bash
coder-studio config --password <强密码>
```

### 2. 监听局域网地址

默认如果服务只监听 `localhost`，手机无法访问电脑上的服务。改成监听所有网卡：

```bash
coder-studio config --host 0.0.0.0
coder-studio serve --restart
```

### 3. 查看地址

```bash
coder-studio status
```

在手机浏览器中访问：

```text
http://<电脑局域网IP>:<端口>
```

例如：

```text
http://192.168.1.23:4173
```

### 4. 如果打不开

- 确认手机和电脑在同一个 Wi-Fi，且没有开启访客网络隔离
- 确认电脑防火墙允许该端口的入站连接
- 确认 Coder Studio 不是只监听 `localhost`
- 如果正在使用 VPN、公司网络或校园网，网络可能禁止设备互访
- 在电脑上重新执行 `coder-studio status`，确认端口没有变化

## Tailscale 访问

Tailscale 适合“只让自己的设备访问”。它会把你的电脑、手机、平板加入同一个私有 tailnet，不需要把服务直接暴露到公网。

基本流程：

1. 在电脑和手机上安装并登录 Tailscale
2. 在电脑上启动 Coder Studio
3. 启用密码并重启服务
4. 在手机上用电脑的 Tailscale IP 或 MagicDNS 名称访问

```bash
coder-studio config --password <强密码>
coder-studio config --host 0.0.0.0
coder-studio serve --restart
tailscale status
```

然后在手机浏览器访问：

```text
http://<电脑的 Tailscale IP>:<端口>
```

如果你希望使用 Tailscale 的 HTTPS/Serve/Funnel 能力，请参考官方文档：

- Tailscale Serve：适合 tailnet 内设备访问
- Tailscale Funnel：适合公开到互联网，风险更高，启用前确认访问控制和认证

## ngrok 临时外网访问

ngrok 适合临时把本机服务暴露给外网，例如演示或测试。它会生成一个公开 HTTPS 地址，并转发到本机端口。

先确认端口：

```bash
coder-studio status
```

假设 Coder Studio 运行在 `4173`：

```bash
ngrok http 4173
```

ngrok 会显示一个 `https://...ngrok...` 地址。用手机打开这个地址即可。

使用 ngrok 前请注意：

- 一定先设置 Coder Studio 密码
- 不要把生成的公网地址发给不可信的人
- 演示结束后停止 ngrok 进程
- 免费/付费能力、固定域名和访问控制以 ngrok 官方说明为准

## Cloudflare Tunnel 长期外网访问

Cloudflare Tunnel 适合你有自己的域名，并希望长期通过 HTTPS 访问本机服务。它通过 `cloudflared` 从你的电脑主动连接 Cloudflare，不需要在路由器上开公网入站端口。

临时 Quick Tunnel 示例：

```bash
cloudflared tunnel --url http://localhost:<端口>
```

长期使用建议在 Cloudflare Zero Trust 中创建受管理的 Tunnel，并绑定自己的域名，例如：

```text
https://coder.example.com -> http://localhost:<端口>
```

使用 Cloudflare Tunnel 前请注意：

- 一定先设置 Coder Studio 密码
- 更推荐配合 Cloudflare Access 或其他身份校验
- 如果电脑关机、休眠或 `cloudflared` 停止，远程地址也会不可用
- 固定域名和访问策略以 Cloudflare 官方文档为准

## 安全建议

- 只在可信网络中使用局域网访问
- 开放给其他设备前先执行 `coder-studio config --password <强密码>`
- 不要把无密码的 Coder Studio 暴露到公网
- 不要在公开链接中打开敏感项目，除非你确认认证、网络和访问控制都已配置好
- 如果只是自己跨设备使用，优先选择 Tailscale，而不是直接公网暴露
- 临时分享结束后，停止 ngrok、Cloudflare Tunnel 或 Tailscale Funnel

## 移动端界面结构

![移动端界面结构](assets/screenshot-mobile-layout.png)

### 顶部栏

- 工作区名称（点击打开工作区抽屉，可切换工作区）
- 设置入口
- 全屏入口（仅在浏览器支持原生全屏时显示）

### 当前 Agent 区域

显示当前活跃会话的状态和输出。没有会话时会显示提示信息。

### 底部 Dock

底部有三个入口：

- **Agent**：打开 Agent 面板，管理会话
- **Files**：打开文件面板
- **Terminal**：打开终端面板

## 操作步骤

### 切换或打开工作区

点击顶部栏的工作区名称，打开工作区抽屉。在抽屉中可以：

- 切换到其他已打开的工作区
- 点击按钮打开新的工作区

### 创建第一个 Agent 会话

点击底部 Dock 的 **Agent** 按钮，打开 Agent 面板。如果没有活跃会话，面板默认处于创建模式。点击创建会话并选择 Provider。

### 切换当前会话

在 Agent 面板中可以看到所有会话列表。点击任意会话即可将其设为当前活跃会话。

### 查看文件

点击底部 Dock 的 Files 按钮，打开文件面板。文件面板包含：

- 文件树浏览
- 点击文件可查看内容
- Git 视图（查看分支和变更列表）

### 查看终端

点击底部 Dock 的 Terminal 按钮，打开终端面板。包含：

- 该工作区的所有终端
- 新建终端的入口

### Supervisor 与通知

如果 Supervisor 处于活跃状态，Agent 区域会显示 Supervisor 徽章。点击可以打开 Supervisor 详情面板，查看当前进度。

## 使用建议

- 移动端适合"查看"为主，复杂的文件编辑和 Agent 管理建议在桌面端完成
- 手机键盘弹出时会压缩底部 Dock 区域，操作时注意布局变化
- 终端操作在小屏幕上可能不便，建议仅在需要时查看
- 如果浏览器支持原生全屏，可点击顶部栏右侧的全屏按钮进入；再次点击同一位置的按钮可退出
- 某些移动端浏览器不支持原生全屏，此时不会显示该按钮

## 常见问题

**Q：文件面板打不开怎么办？**
检查顶栏连接状态是否正常，可能需要刷新页面。

**Q：Agent 面板没有响应？**
确保 Provider 已正确安装且服务在运行。

**Q：手机上怎么知道访问地址？**
在电脑上执行 `coder-studio status`，找到当前监听地址和端口。如果手机和电脑在同一局域网，访问 `http://<电脑局域网IP>:<端口>`。如果使用 Tailscale，访问 `http://<电脑 Tailscale IP>:<端口>`。

**Q：为什么电脑能打开，手机打不开？**
常见原因是服务只监听 `localhost`、手机和电脑不在同一网络、Wi-Fi 开启了设备隔离，或电脑防火墙阻止端口访问。先执行 `coder-studio config --host 0.0.0.0`，再执行 `coder-studio serve --restart`。

**Q：可以直接把端口映射到公网吗？**
不建议。Coder Studio 能操作本机项目、终端和 AI 会话，公网暴露前至少要启用密码。更推荐使用 Tailscale、ngrok 或 Cloudflare Tunnel。

## 参考文档

- [Tailscale Funnel 文档](https://tailscale.com/docs/features/tailscale-funnel)
- [Tailscale Funnel CLI 参考](https://tailscale.com/docs/reference/tailscale-cli/funnel)
- [ngrok HTTP Endpoints 文档](https://ngrok.com/docs/http/)
- [Cloudflare Tunnel 文档](https://developers.cloudflare.com/tunnel/)
- [Cloudflare Quick Tunnels](https://try.cloudflare.com/)

## 下一步

- [桌面端使用指南](desktop-guide.md) — 熟悉桌面端完整功能
- [常见工作流](workflows.md) — 任务式操作指南
