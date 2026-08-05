# Coder Studio 桌面容器

本文说明桌面应用的架构、开发方式、打包发布流程和运维边界。桌面端保留现有 React/Fastify 产品形态，只增加原生窗口和本地运行时管理，不重写业务 UI。

## 架构决策

运行链路如下：

```text
Electron main/preload
        |
        | spawn + stdin/stdout protocol
        v
Bundled Node.js 24 sidecar
        |
        v
Fastify + WebSocket + node-pty
        |
        v
Existing React web app in BrowserWindow
```

Electron 只负责应用生命周期、窗口、原生目录选择、外链和更新。服务端继续运行在独立的官方 Node.js 进程中，因此 `process.execPath`、`node-pty`、LSP 和 Provider 子进程仍处于标准 Node 环境，也不会与 Electron 的 Node ABI 绑定。

桌面包包含：

- Electron 主进程和受限 preload；
- 已构建的 Web UI 与 server sidecar；
- 生产依赖和对应目标平台的 `node-pty` 原生文件；
- 固定版本、经过 SHA-256 校验的官方 Node.js 运行时。

## 启动与退出

1. Electron 获取单实例锁。
2. 默认启动桌面托管 sidecar。sidecar 只监听 `127.0.0.1` 的系统随机端口，并使用每次启动生成的随机密码。
3. sidecar 的状态、上传和运行目录位于 Electron user-data 下，与 `~/.coder-studio` 中的 CLI 数据隔离。
4. Electron 通过自己的 session 登录，然后加载同源页面。
5. 关闭应用时，通过 stdin 协议请求 sidecar 优雅退出；超时后终止它。

CLI Server 使用 `~/.coder-studio/data`，桌面 sidecar 使用 Electron user-data 下的 `data` 目录。两者可以同时运行，并分别通过各自目录中的 `server.lock` 防止同类后端重复写入。进程崩溃后可以回收 stale lock。

桌面托管 sidecar 默认仅供本机窗口使用。需要手机或局域网访问时，按现有 CLI 文档单独启动带密码、允许局域网监听的 Server。仅在显式设置 `CODER_STUDIO_DESKTOP_REUSE_SERVER=true` 时，正式桌面包才会验证并复用 `~/.coder-studio/runtime.json` 指向的完整 CLI Server。

从早期共享状态目录的桌面构建升级后，桌面端会使用新的独立数据目录，不会自动复制 CLI 数据。工作区可以重新添加；正式提供数据迁移前，不应在 CLI Server 运行时手动复制 SQLite 或状态文件。

## 安全边界

- `contextIsolation: true`；
- renderer 禁用 Node integration，并启用 Chromium sandbox；
- preload 只暴露目录选择、受限外链和只读 backend 状态；
- 新窗口始终被拒绝，`http`、`https`、`mailto` 外链交给系统浏览器；
- BrowserWindow 只允许在当前本地服务的 origin 内导航；
- sidecar 不读写全局 `runtime.json`，状态、上传和运行配置放在 Electron user-data 目录；
- backend 日志写入 Electron 的平台日志目录。

## 本地开发

前置条件与仓库一致：Node.js 24+、pnpm，以及至少一个可用的 Agent Provider CLI。

| 命令 | 用途 |
| --- | --- |
| `pnpm dev:desktop` | 启动 Vite、Electron 和开发 sidecar |
| `pnpm build:desktop` | 构建 Web、main/preload 和 sidecar |
| `pnpm prepare:desktop` | 部署生产依赖并准备官方 Node runtime |
| `pnpm pack:desktop` | 完整构建并生成 unpacked 应用目录 |
| `pnpm dist:desktop` | 生成当前平台的安装包 |
| `pnpm smoke:desktop` | 验证打包 Node、原生 PTY、认证、退出和窗口加载 |

开发模式使用固定端口 `4173` 启动 sidecar，Vite 使用 `5173`。正式包使用随机端口。

可用于诊断或自动化的环境变量：

| 变量 | 说明 |
| --- | --- |
| `CODER_STUDIO_DESKTOP_REUSE_SERVER=true` | 显式验证并复用已有完整 CLI Server；默认关闭 |
| `CODER_STUDIO_DESKTOP_STATE_DIR` | 覆盖服务状态目录 |
| `CODER_STUDIO_DESKTOP_UPLOADS_DIR` | 覆盖上传目录 |
| `CODER_STUDIO_DESKTOP_PATH` | 覆盖传给 sidecar/Provider 的 PATH |
| `CODER_STUDIO_DESKTOP_NODE_DIR` | 打包时使用已准备的 Node runtime，适合离线 CI |
| `CODER_STUDIO_DESKTOP_RESOURCES_DIR` | smoke 时指定已打包的 resources 目录 |

## 构建产物

`prepare:desktop` 当前固定 Node.js `24.19.0`，从 nodejs.org 同时下载归档和 `SHASUMS256.txt`，校验成功后才会进入包内。生产依赖使用 hoisted、无绝对 junction 的布局，确保安装包不会引用构建机路径。

构建目录仍生成 shell、sidecar 和 Web sourcemap，供 CI 上传到错误追踪或作为独立调试产物；Electron 安装包和生产 Runtime 资源明确排除所有 `.map` 文件。

默认输出位于 `release/desktop`：

| 平台 | 架构 | 产物 |
| --- | --- | --- |
| Windows | x64 | NSIS `.exe` 和 `win-unpacked` |
| macOS | x64、arm64 | `.dmg` |
| Linux | x64 | `.AppImage` |

安装包必须在对应操作系统上构建。尤其不要在一个平台上复用另一个平台准备出的 Node runtime 或 `node-pty`。

## 版本与更新

桌面包版本应与 `packages/cli/package.json` 和 GitHub Release tag 保持一致。桌面应用使用 `electron-updater` 和 `electron-builder.yml` 中的 GitHub provider：

- 启动后进行非阻塞检查；
- `Help > Check for Updates...` 可以手动检查；
- 用户确认后下载，进度显示在操作系统任务栏；
- 下载完成后由用户选择重启安装；
- sidecar 内现有 npm updater 被明确标记为不适用，避免桌面包执行全局 npm 更新。

GitHub Release 必须同时包含安装包、blockmap 和平台更新元数据（例如 Windows 的 `latest.yml`）。缺少更新元数据时，安装包仍能运行，但自动更新不可用。

## 签名、公证与发布

推荐在 GitHub Actions 的原生 runner 上按平台并行执行：

1. checkout，并安装 Node 24 与 pnpm；
2. `pnpm install --frozen-lockfile`；
3. 运行类型检查、桌面测试和针对性 server/CLI/Web 测试；
4. `pnpm dist:desktop`；
5. `pnpm smoke:desktop`（Linux runner 需要可用的图形显示或 xvfb）；
6. 将安装包、blockmap 和更新元数据上传到同一个 GitHub Release。

发布所需凭据不进入仓库：

- Windows：代码签名证书（electron-builder 的 `CSC_LINK` / `CSC_KEY_PASSWORD` 或等价证书存储配置）；
- macOS：Developer ID Application 证书，以及 Apple notarization 的 API key/issuer 或 Apple ID/team 凭据；
- GitHub：对目标 Release 有写权限的 token。

Windows 未签名包会触发 SmartScreen；macOS 未签名、未公证包不应作为正式下载发布。自动更新也应只在签名链稳定后启用生产发布。

## 验收清单

- 无系统 Node.js 时仍能启动；
- 窗口加载现有 Web UI，WebSocket 正常连接；
- 原生目录选择可以返回绝对目录；
- 能创建 shell/agent 终端，`node-pty` 从包内加载；
- 单实例行为正确；
- CLI 与桌面默认使用独立状态目录并可同时运行；
- sidecar 异常退出时可重启或退出；
- 关闭窗口后托管 sidecar 和 `server.lock` 都被清理；
- Provider CLI 仍从用户 PATH 发现；
- 外链不会在拥有 preload 权限的窗口中打开；
- 安装包签名、macOS 公证及 GitHub 更新元数据完整。

## 当前边界

- Agent Provider CLI 不随桌面包分发，用户仍需自行安装并登录 Claude Code、Codex 等工具；
- Provider CLI 可执行文件、登录状态和技能目录仍是系统用户级资源；桌面与 CLI 的 backend 状态隔离不代表 Provider home 完全隔离；
- 没有托盘常驻，退出桌面应用会停止它托管的 backend；
- Windows x64 已具备本地自动化验证链路；macOS、Linux 仍必须在对应平台 runner 和干净机器上做最终验收。
