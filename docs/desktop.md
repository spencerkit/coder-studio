# Coder Studio 桌面容器

本文说明桌面应用的架构、开发方式、打包发布流程和运维边界。桌面端保留现有 React/Fastify 产品形态，只增加原生窗口和本地运行时管理，不重写业务 UI。

## 架构决策

本地 Windows 环境的运行链路如下：

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

Windows 上还可以按整个 App 生命周期切换到一个 WSL2 distribution。Web 不会复制到 WSL，仍由
Windows Product Runtime 提供：

```text
BrowserWindow
    |
    | HTTP / WebSocket（同源）
    v
Windows Gateway（127.0.0.1:随机端口）
    |-- 静态请求 -----------------> Windows shared Web
    `-- /api、/auth、/ws 等 ------> WSL Server（127.0.0.1:随机端口）
                                      ^
                                      | wsl.exe --exec
Electron main -- stdin/stdout 控制 ---+
```

Windows 与 WSL 的业务通信是 HTTP/WebSocket，依赖 WSL2 的 localhost forwarding；
`wsl.exe` 的 stdin/stdout 只用于启动参数、ready 消息、日志和关闭协议。Gateway 与 Server 都绑定
`127.0.0.1:0`，由系统分配端口，所以不会占用固定端口，也不会和 CLI 的端口产生静态冲突。

桌面包包含：

- Electron 主进程和受限 preload；
- 已构建的 Web UI 与 server sidecar；
- 生产依赖和对应目标平台的 `node-pty` 原生文件；
- 固定版本、经过 SHA-256 校验的官方 Node.js 运行时。

安装包只自带当前 Windows 平台的 Factory Runtime 和 Engine。WSL Engine 与 WSL Server Runtime
是选择某个 distribution 时按需安装的 Linux 产物，不会把所有架构和 distribution 的运行时塞进安装包。

## 启动与退出

1. Electron 获取单实例锁。
2. 默认启动桌面托管 sidecar。sidecar 只监听 `127.0.0.1` 的系统随机端口，并使用每次启动生成的随机密码。
3. sidecar 的状态、上传和运行目录位于 Electron user-data 下，与 `~/.coder-studio` 中的 CLI 数据隔离。
4. Electron 通过自己的 session 登录，然后加载同源页面。
5. 关闭应用时，通过 stdin 协议请求 sidecar 优雅退出；超时后终止它。

选择 WSL 环境时，Desktop 会先探测 WSL2、glibc 和架构，按需安装对应 Engine/Server Runtime，
写入 `pending` 后重启 App。新环境完成认证、健康检查和 Web 加载后才成为 active；启动失败可重试或
切回 Local Windows。一次 App 生命周期只托管一个环境，不同时运行 Windows 和 WSL 两套 Server。

关闭 WSL 模式的 App 时，Desktop 同样向 `wsl.exe` 子进程发送关闭消息。WSL sidecar 会停止 Fastify、
释放状态锁并退出；stdin 意外断开也会触发退出。Desktop 不调用 `wsl --terminate`，不会关闭整个
distribution，也不会影响用户在其中运行的其他进程。

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
- Windows Gateway 和 WSL Server 都只监听 loopback；Renderer 不直接获得 WSL 控制通道；
- WSL 安装 manifest 使用 Ed25519 验签，下载包校验大小、SHA-256、目标平台和逐文件清单后，才通过
  stdin 流式交给 WSL 内的 `tar`；
- WSL 安装使用 distribution 内的目录锁、staging 目录和原子 pointer，Desktop 不拼接用户输入的
  shell 命令。

## 本地开发

前置条件与仓库一致：Node.js 24+、pnpm，以及至少一个可用的 Agent Provider CLI。

| 命令 | 用途 |
| --- | --- |
| `pnpm dev:desktop` | 启动 Vite、Electron 和开发 sidecar |
| `pnpm build:desktop` | 构建 Web、main/preload 和 sidecar |
| `pnpm build:desktop-runtime` | 构建 Windows Product Runtime |
| `pnpm build:wsl-runtime` | 在 Linux runner 构建不含 Web 的 WSL Server Runtime |
| `pnpm build:wsl-engine` | 在 Linux runner 构建 WSL Node/原生依赖 Engine |
| `pnpm prepare:desktop` | 部署生产依赖并准备官方 Node runtime |
| `pnpm pack:desktop` | 完整构建并生成 unpacked 应用目录 |
| `pnpm dist:desktop` | 生成当前平台的安装包 |
| `pnpm smoke:desktop` | 验证打包 Node、原生 PTY、认证、退出和窗口加载 |
| `pnpm acceptance:wsl:prepare` | 在本机 WSL 构建并汇总完整的 WSL 验收通道和 packaged Desktop |
| `pnpm acceptance:wsl:serve` | 在 `127.0.0.1:8787` 提供已准备的本地 WSL 下载通道 |

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

## 本地 WSL 标准验收

本地完整验收使用一个只监听 Windows loopback 的静态下载服务。它模拟正式 Release/CDN，向
packaged Desktop 提供签名后的 WSL Engine、WSL Server Runtime 和 Windows Product Runtime。
`pnpm dev:desktop` 不开放 WSL 环境入口，因此不能替代这条链路。

前置条件：

- Windows 已启用 WSL2，并安装一个 x64、glibc-based distribution；
- distribution 中有 `curl`、`tar`、`xz`、`sha256sum`、`python3`、`make` 和 `g++`；
- 工作树已经提交且干净。验收构建固定使用 committed `HEAD`，并把 commit 写入验收报告。

Ubuntu/Debian 缺少 Linux 原生构建工具时先执行：

```bash
sudo apt install build-essential python3 curl xz-utils
```

第一步，在 Windows PowerShell 中准备全部产物：

```powershell
pnpm acceptance:wsl:prepare -- --distro Ubuntu-24.04
```

该命令会自动完成：

1. 探测 distribution 的 WSL2、glibc 和架构；
2. 生成或复用 `release/wsl-acceptance/keys` 下的本地 Ed25519 测试密钥；
3. 将 committed `HEAD` 归档到 WSL 缓存工作区，准备受管 Node/pnpm，并安装 Linux 依赖；
4. 在 WSL 中构建签名后的 Linux Engine 和不含 Web 的 Server Runtime；
5. 使用同一公钥、签名密钥和本地下载 URL 构建 Windows packaged Desktop；
6. 将通道 manifest 和其引用的 `.tgz` 汇总到 `release/wsl-acceptance/downloads`，并验证签名、
   版本、平台和 Engine 包哈希；
7. 写出 `release/wsl-acceptance/acceptance.json`。

默认只生成便于验收的 `release/desktop/win-unpacked`。需要同时验收 NSIS 安装包时追加
`--installer`。验收 Runtime 使用 `<CLI version>-acceptance.<commit>`，避免不同 commit 在 WSL 中
错误复用同版本的旧业务 Runtime。

第二步，保持本地下载服务运行：

```powershell
pnpm acceptance:wsl:serve
```

第三步，另开 PowerShell，使用隔离的 Electron user-data 启动构建结果：

```powershell
& ".\release\desktop\win-unpacked\Coder Studio.exe" `
  "--user-data-dir=$PWD\release\wsl-acceptance\user-data"
```

验收顺序：

1. 在环境菜单选择目标 WSL distribution，确认出现 Checking、Downloading、Verifying、Installing；
2. 确认切换并等待 App 重启，环境标签应显示所选 WSL；
3. 打开 `\\wsl.localhost\\<distro>` 下的项目，在终端检查 `uname -a`、
   `node -p "process.platform"` 和 `pwd`，结果应为 Linux/Linux 路径；
4. 验证文件、Git、Terminal、Agent 以及 WebSocket 重连；
5. 关闭 App，确认 `pgrep -af server.mjs` 不再显示 Coder Studio Server，但 distribution 未被终止；
6. 停止本地下载服务后再次启动 App，同一 commit 应能复用已安装 Runtime；
7. 切回 Local Windows，确认重启后 Windows 项目和独立状态仍可用。

如果该 distribution 已安装 Engine，同一次验收只会下载新的 Server Runtime。需要重新验收真正的
“首次安装 Engine + Runtime”时，应先关闭 App，再把
`~/.local/share/coder-studio-desktop` 整体移动到明确的备份目录；其中包含 WSL 端的 Coder Studio
状态和会话数据，因此不要直接删除，验收完成后可以恢复。

## 构建产物

`prepare:desktop` 当前固定 Node.js `24.19.0`，从 nodejs.org 同时下载归档和 `SHASUMS256.txt`，校验成功后才会进入包内。生产依赖使用 hoisted、无绝对 junction 的布局，确保安装包不会引用构建机路径。

Electron shell 生产构建不生成 sourcemap；共享 Web 的中间构建仍可为 CI 错误诊断生成 map，但
Product Runtime 组装时会删除它们和依赖中残留的 `.map`。安装包及所有可发布 Runtime/Engine 产物
都不得包含 `.map`；调试符号只能作为独立、受控的 CI 产物保存，不能混入发布包。

默认输出位于 `release/desktop`：

| 平台 | 架构 | 产物 |
| --- | --- | --- |
| Windows | x64 | NSIS `.exe` 和 `win-unpacked` |
| macOS | x64、arm64 | `.dmg` |
| Linux | x64 | `.AppImage` |

安装包必须在对应操作系统上构建。尤其不要在一个平台上复用另一个平台准备出的 Node runtime 或 `node-pty`。

## 版本与更新

版本分为两条发布线：

| 产物 | 版本来源 | 初始/当前版本 | 发布规则 |
| --- | --- | --- | --- |
| CLI + Product Runtime | `packages/cli/package.json` | `0.5.6` | 两者共用版本号 |
| Desktop Shell + 安装包 | `packages/desktop/package.json` | `0.1.0` | 独立递增 |
| Engine ABI | Runtime manifest 的 `requiredEngineVersion` | `2` | 只有宿主兼容边界变化时递增 |

`scripts/package-desktop.ts` 只读取 Desktop package 版本；Runtime 构建默认只读取 CLI package
版本。Runtime manifest 的 `minShellVersion` 用于表达某个 Runtime 所需的最低 Desktop 版本，
因此两条 SemVer 不需要数值一致。

桌面应用使用 `electron-updater` 和 `electron-builder.yml` 中的 GitHub provider：

- 启动后进行非阻塞检查；
- `Help > Check for Desktop App Updates...` 可以手动检查安装包更新；
- `Help > Check for Product Runtime Updates...` 独立检查 Server + Web Runtime 更新；
- 用户确认后下载，进度显示在操作系统任务栏；
- 下载完成后由用户选择重启安装；
- sidecar 内现有 npm updater 被明确标记为不适用，避免桌面包执行全局 npm 更新。

GitHub Release 必须同时包含安装包、blockmap 和平台更新元数据（例如 Windows 的 `latest.yml`）。缺少更新元数据时，安装包仍能运行，但自动更新不可用。

当前 Desktop 和 Runtime 都从同一仓库的 `releases/latest/download` 获取稳定通道文件，而 GitHub
只能有一个 latest Release。因此每次把任一版本线发布为 latest 时，都必须携带另一条版本线当前有效的
通道元数据：Desktop 的 `latest.yml`、安装包和 blockmap，以及 Runtime 的平台 manifest 和其引用的
`.tgz`。如果后续需要完全独立的发布节奏，应把两个更新通道迁移到各自固定的对象存储/CDN 路径，
不要继续共享 GitHub 的 latest 指针。

## 签名、公证与发布

仓库提供四层边界清晰的 Desktop 流水线：

- `.github/workflows/ci.yml` 是通用快速检查，在 PR 与 `main` push 上运行 changeset 校验、lint、测试、
  Web/CLI 生产构建和有针对性的 Windows Runtime 校验，也可由其他 workflow 调用。它不构建 Desktop
  安装包、Factory Runtime 或 WSL 集成资产。
- `.github/workflows/desktop-verify.yml` 负责重量级 Desktop 集成验证。相关构建路径发生变化的 PR 会触发
  它，`main` push 始终运行，也可以直接手动运行无签名验证；`desktop-acceptance.yml` 则通过
  `workflow_call` 请求签名构建。Windows job 构建安装包与 Factory Runtime 并执行 packaged smoke，Linux
  job 构建并校验 WSL Engine 与 WSL Server Runtime。直接运行允许 manifest 无签名，只上传验证 artifact，
  不创建 Release。
- `.github/workflows/desktop-acceptance.yml` 只能通过 GitHub Actions 中的
  `Publish Desktop acceptance` 手动触发。它生成仅供本次运行使用的 Ed25519 测试密钥，并行调用通用
  快速 CI 与可复用 Desktop 验证 workflow 的签名构建；发布阶段等待 `prepare`、通用 CI 和完整签名
  Desktop 资产全部成功，再创建独立的
  `desktop-ci-<run-id>-<attempt>` prerelease。只有这一层会发布测试资产；该通道固定到对应 tag，永远不会
  更新 GitHub `latest`，也不能晋升为生产发布。仓库没有稳定 `desktop-channel.json` 时，它自动执行
  `fresh-native` 与 `fresh-wsl` 候选安装验收；建立首个稳定 Desktop 通道后，自动切换为完整的安装升级、
  回滚、中断恢复和外部浏览器权限矩阵。
- `.github/workflows/desktop-release.yml` 保持生产发布边界不变：只能手动从 `main` 触发，并受
  `desktop-production` environment 审批保护。工作流比较当前 `packages/desktop/package.json` 与最新稳定
  `desktop-channel.json` 的 Shell 版本：Shell 版本提升或尚无稳定 Desktop 通道时发布 Shell、Windows
  Runtime、WSL Engine 和 WSL Runtime；Shell 版本未变化时只发布 Windows/WSL Product Runtime，并从
  当前稳定 Release 继承 Shell 安装包与 WSL Engine。

生产流水线在原生 runner 上按平台并行执行：

1. checkout，并安装 Node 24 与 pnpm；
2. `pnpm install --frozen-lockfile`；
3. Windows job 运行 Desktop 类型检查和测试；完整 server/CLI/Web 校验由同一提交的 CI 负责；
4. Shell 版本提升时运行 `pnpm dist:desktop`；
5. Windows Shell 发布路径运行 `pnpm smoke:desktop`；
6. 用 `scripts/desktop-release-artifacts.ts` 汇总并重新解包校验签名、版本边界、文件 SHA-256、Engine
   包 SHA-256、sourcemap 和更新元数据；
7. 为最终资产生成 GitHub artifact attestation，并将安装包、blockmap 和更新元数据上传到同一个
   GitHub Release。

WSL 产物必须在对应架构的 Linux runner 上另外执行 `pnpm build:wsl-engine` 和
`pnpm build:wsl-runtime`，使用同一把 Runtime Ed25519 私钥签名，并上传版本化包和稳定通道 manifest。
Windows runner 不能生成或复用 `node-pty` 的 Linux 原生文件。

发布所需凭据不进入仓库：

- Runtime：`DESKTOP_RUNTIME_SIGNING_PRIVATE_KEY` 与 `DESKTOP_RUNTIME_PUBLIC_KEY`，保存 Ed25519 PEM；
- Windows：`DESKTOP_WINDOWS_CSC_LINK` 与 `DESKTOP_WINDOWS_CSC_KEY_PASSWORD`，流水线会映射为
  electron-builder 的 `CSC_LINK` / `CSC_KEY_PASSWORD`；
- macOS：Developer ID Application 证书，以及 Apple notarization 的 API key/issuer 或 Apple ID/team 凭据；
- GitHub：对目标 Release 有写权限的 token。

上述四个 Desktop secret 应配置在 GitHub `desktop-production` environment 中，并为该 environment
启用 required reviewers。自动判定的完整 Shell release 使用 `desktop-v<desktop-version>` 标签，
Runtime-only release 使用 `desktop-runtime-v<runtime-version>` 标签；标签已存在时流水线直接失败，
不覆盖已有产物。

由于 CLI 与 Desktop 共用同一个 GitHub `latest` 指针，CLI 发布流水线会把当前 Desktop 安装包、更新
元数据、Windows Runtime、WSL Engine 和 WSL Runtime 复制到新的 CLI Release。这样 CLI 发布成为
latest 后，已安装 Desktop 的强更新与 Runtime 热更新地址仍然有效。CLI 与 Desktop 发布还会共用一个
concurrency group，避免两个 Release 同时更新稳定通道。

首次联合发布按以下顺序执行，以避免 CLI 与 Desktop 的验收报告互相依赖：

1. 合并 Changesets 生成的版本 PR；
2. 运行 `Publish Desktop acceptance`，取得 `fresh-native` 与 `fresh-wsl` 报告的 run ID；
3. 运行 `Publish CLI`，设置 `promote=false`，只发布不可变 npm 候选并取得 CLI 验收 run ID；
4. 运行 `Publish Desktop`，传入上述两个 run ID，发布并晋升首个稳定 Desktop 通道；
5. 再次运行 `Publish CLI`，设置 `promote=true` 且传入 Desktop acceptance run ID，将同一 npm 候选晋升为
   `latest`，并把稳定 Desktop 资产复制到 CLI GitHub Release。

建立稳定 Desktop 通道后不再使用 bootstrap 顺序；验收和生产发布会自动要求从上一稳定安装包升级。

Windows 未签名包会触发 SmartScreen；macOS 未签名、未公证包不应作为正式下载发布。自动更新也应只在签名链稳定后启用生产发布。

## 验收清单

- 无系统 Node.js 时仍能启动；
- 窗口加载现有 Web UI，WebSocket 正常连接；
- 原生目录选择可以返回绝对目录；
- WSL 模式的目录选择从 `\\wsl.localhost\\<distro>` 开始，并只返回对应的 Linux 绝对路径；
- 能创建 shell/agent 终端，`node-pty` 从包内加载；
- 单实例行为正确；
- CLI 与桌面默认使用独立状态目录并可同时运行；
- sidecar 异常退出时可重启或退出；
- 关闭窗口后托管 sidecar 和 `server.lock` 都被清理；
- WSL 切换仅在新环境健康后提交，失败时可以重试或切回 Windows；
- 关闭 WSL 模式只停止 Coder Studio Server，不终止 distribution；
- Provider CLI 仍从用户 PATH 发现；
- 外链不会在拥有 preload 权限的窗口中打开；
- 安装包签名、macOS 公证及 GitHub 更新元数据完整。

## 当前边界

- Agent Provider CLI 不随桌面包分发，用户仍需自行安装并登录 Claude Code、Codex 等工具；
- Provider CLI 可执行文件、登录状态和技能目录仍是系统用户级资源；桌面与 CLI 的 backend 状态隔离不代表 Provider home 完全隔离；
- 没有托盘常驻，退出桌面应用会停止它托管的 backend；
- 当前 WSL 通信依赖 WSL2 localhost forwarding，尚未实现 guest IP fallback；
- WSL 仅支持 x64、glibc-based WSL2 distribution；
- Windows x64 已具备本地自动化验证链路；WSL Linux 产物、macOS 和 Linux Desktop 仍必须在对应平台 runner 和干净机器上做最终验收。
