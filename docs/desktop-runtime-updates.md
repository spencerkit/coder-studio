# Desktop Product Runtime 更新

桌面版把“稳定运行环境”和“可快速发布的产品代码”拆成两个边界：

```text
Desktop Shell / Engine（完整安装包更新）
├─ Electron main / preload
├─ Node.js 24.19.0
├─ node-pty 与原生 ABI 依赖
├─ TypeScript / typescript-language-server
└─ Runtime Manager

Product Runtime（独立更新）
├─ server.mjs
├─ web/
├─ assets/mermaid.min.js
└─ manifest.json

WSL Engine（按 distribution/架构安装）
├─ Linux Node.js 24.19.0
├─ node-pty 与 Linux 原生 ABI 依赖
└─ 稳定语言工具

WSL Server Runtime（按 distribution/架构安装）
├─ server.mjs
├─ assets/mermaid.min.js
└─ manifest.json（无 webRoot）
```

Fastify、Zod、WebSocket 等纯 JavaScript 依赖被打入 `server.mjs`。Runtime 不会从 Desktop
任意加载普通业务依赖；唯一显式的 Engine Host 边界是 `node-pty` 和随 Engine 安装的稳定语言工具。
构建会检查 Runtime bundle 的外置模块，出现未登记的裸模块引用时直接失败。

Web 在 Windows Product Runtime 中只有一份。切到 WSL 后，Windows Gateway 继续托管这份 Web，只把
HTTP API 和 WebSocket 代理到 WSL Server；因此 WSL Server Runtime 不包含 `web/`。Server 的纯
JavaScript npm 依赖仍捆进 `server.mjs`，`node-pty` 等 ABI 敏感依赖与 Node 一起放进 WSL Engine。
这让业务 Runtime 保持简单，同时避免运行时从用户的 WSL npm 环境解析依赖。

## 构建产物

```powershell
pnpm build:desktop-runtime
```

默认输出：

```text
release/runtime/
├─ coder-studio-runtime-<version>-<platform>-<arch>/
├─ coder-studio-runtime-<version>-<platform>-<arch>.manifest.json
├─ coder-studio-runtime-<version>-<platform>-<arch>.tgz
└─ coder-studio-runtime-<platform>-<arch>.manifest.json
```

最后一个文件是稳定更新通道 manifest。发布到 GitHub Release 时，应同时上传稳定通道 manifest
和它的 `packageFile` 指向的版本化 `.tgz`。Desktop 默认从当前仓库的 `releases/latest/download`
检查稳定通道，也可以用 `CODER_STUDIO_RUNTIME_UPDATE_URL` 覆盖。

生产发布通过 GitHub Actions 的 `Publish Desktop` 工作流完成。选择 `full` 时会重新构建 Desktop
Shell/安装包、Windows Runtime、WSL Engine 与 WSL Runtime；选择 `runtime` 时仅构建两个 Product
Runtime，并继承当前稳定通道中的安装包和 Engine。两种模式都会在发布前解包校验 manifest 签名、
版本兼容边界、文件集合与 SHA-256，并拒绝任何 sourcemap。

WSL 产物只能在 Linux runner 构建：

```text
pnpm build:wsl-engine
pnpm build:wsl-runtime

release/engine/
├─ coder-studio-engine-<engine>-linux-<arch>.tgz
└─ coder-studio-engine-linux-<arch>.manifest.json

release/runtime/
├─ coder-studio-server-runtime-<version>-linux-<arch>.tgz
└─ coder-studio-server-runtime-linux-<arch>.manifest.json
```

Windows 本机的标准 WSL 验收由 `pnpm acceptance:wsl:prepare -- --distro <name>` 编排。它通过
目标 distribution 构建 Linux 原生产物，再把 Engine、Linux Server Runtime 和 Windows Product
Runtime 汇总到 `release/wsl-acceptance/downloads`。随后运行 `pnpm acceptance:wsl:serve`，即可用
与正式发布相同的 manifest、签名和下载校验链路完成首次安装与环境切换验收。详细步骤见
[`desktop.md`](./desktop.md#本地-wsl-标准验收)。

首次验收包准备完成后，可以在不重建 Desktop Shell 和 Engine 的情况下发布一个本地 Runtime 更新：

```powershell
pnpm acceptance:runtime:update -- --runtime-version 0.5.7-acceptance.local
pnpm acceptance:wsl:serve
pnpm acceptance:runtime:verify
```

该命令复用首次准备时的 Desktop 可执行文件、Ed25519 密钥、用户数据目录和下载端口，只替换 Windows
Product Runtime 与同版本 WSL Server Runtime 的 channel manifest 和版本化包。更新版本的前三段
SemVer 必须高于当前验收 Runtime；私钥和所有产物仍只保存在被忽略的 `release/wsl-acceptance` 下。
`acceptance:runtime:verify` 会从实际 HTTP channel 下载并验签 Windows Runtime，验证
`factory → pending → active` 状态切换，同时确认存在同版本且签名有效的 WSL Server Runtime。

需要从 GitHub Actions 下载可直接验收 WSL 首次安装的测试包时，手动运行 `CI` workflow 并保持
`publish_acceptance=true`。流水线会创建一个 tag 固定的 prerelease，安装包内置本次运行的临时公钥和
prerelease 下载地址，Windows/WSL Runtime 资产则由对应临时私钥签名。测试私钥会作为短期内部 artifact
保留一天；prerelease 不会成为 `latest`，验收结束后应删除对应的 `desktop-ci-*` Release 和 tag。

Runtime 版本可以独立于 Desktop 安装包版本：

```powershell
$env:CODER_STUDIO_RUNTIME_VERSION='0.5.7'
$env:CODER_STUDIO_RUNTIME_MIN_SHELL_VERSION='0.1.0'
pnpm build:desktop-runtime
```

正式发布时，Runtime 与 CLI 共用产品版本：未设置覆盖变量时，Runtime 版本读取
`packages/cli/package.json`。Desktop Shell 使用自己的版本线并从 `0.1.0` 开始，最低 Shell
版本读取 `packages/desktop/package.json`。`CODER_STUDIO_RUNTIME_VERSION` 主要用于候选包和发布验证，
不应让正式 Runtime 长期偏离 CLI 版本。

所有 Product Runtime、Engine 和 Electron Shell 发布产物都不保留 `.map`。共享 Web 的中间构建
可以为 CI 错误诊断生成 map，但 Runtime 组装时必须删除；调试符号只能独立存放在受控位置。

## Ed25519 签名

私钥只能放在 Runtime 发布 CI，公钥编译进 Desktop Shell：

```powershell
openssl genpkey -algorithm Ed25519 -out runtime-private.pem
openssl pkey -in runtime-private.pem -pubout -out runtime-public.pem

$env:CODER_STUDIO_RUNTIME_SIGNING_PRIVATE_KEY = Get-Content runtime-private.pem -Raw
pnpm build:desktop-runtime

$env:CODER_STUDIO_RUNTIME_PUBLIC_KEY = Get-Content runtime-public.pem -Raw
pnpm dist:desktop
```

不要提交私钥。没有编译公钥的 Desktop 仍能运行安装包内可信的 Factory Runtime，但会禁用 Product
Runtime 网络更新。下载的 Runtime 必须通过 manifest 签名、平台/架构、Shell/Engine/Node/API/数据协议
兼容性以及逐文件 SHA-256 和大小校验；未登记的多余文件也会导致拒绝安装。

## 激活与回滚

用户数据目录中的状态为：

```text
runtime-store/
├─ active.json
├─ pending.json
├─ failed.json
├─ versions/
└─ downloads/
```

更新下载完成后只写入 `pending`，不会替换正在运行的 Server/Web。用户重启后，Desktop 使用 pending
Runtime 启动本地 Server，并完成认证、健康检查和 Web 加载；成功后才原子提升为 `active`，同时保留一个
`previous`。候选 Runtime 启动失败时依次回退到 previous/active 和安装包内 Factory Runtime，并记录
`failed.json`。同一个失败版本会被隔离，不会在每次启动时反复下载安装；发布方需要使用更高的
Runtime 版本号提供修复，或由用户显式清除失败记录后重试。

检查入口有两种：Local Windows 实例启动成功后会立即非阻塞检查一次，之后每 6 小时检查；用户也可以
通过 `Help > Check for Product Runtime Updates...` 立即检查。相邻的
`Help > Check for Desktop App Updates...` 只负责 Electron Shell/安装包更新，两者互不替代。WSL 实例
共享 Windows Product Runtime 中的 Web，因此由 Local Windows 实例下载 Product Runtime；启动 WSL
实例时再按相同版本准备对应的 WSL Server Runtime。

自动检查或下载失败时会记录到 Desktop 日志目录的 `runtime-update.log`；手动检查还会直接显示错误对话框，
避免打包后的 GUI 进程只把错误写入不可见的标准错误流。

当 Windows shared Web 更新后，如果当前选择的是 WSL，下一次启动会要求 WSL Server Runtime 与 Web
使用相同的 CLI/Product 版本；缺失或版本不匹配时先下载、验签并写入 WSL `pending`。WSL Runtime
也只有在 Server ready、Gateway 认证、健康检查和 Web 加载全部成功后才提升为 active，失败会删除
pending 或回退 previous。Engine 只有在 ABI/Node 兼容边界变化时更新，不随每次业务 Runtime 发布重装。

这里的“热更新”是无需重新下载安装 Desktop 的 Product Runtime 更新，但仍通过一次应用重启完成
Server 与 Web 的原子切换；不在运行中的 Node 进程内替换业务代码。
