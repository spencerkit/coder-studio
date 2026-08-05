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
```

Fastify、Zod、WebSocket 等纯 JavaScript 依赖被打入 `server.mjs`。Runtime 不会从 Desktop
任意加载普通业务依赖；唯一显式的 Engine Host 边界是 `node-pty` 和随 Engine 安装的稳定语言工具。
构建会检查 Runtime bundle 的外置模块，出现未登记的裸模块引用时直接失败。

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

Runtime 版本可以独立于 Desktop 安装包版本：

```powershell
$env:CODER_STUDIO_RUNTIME_VERSION='0.5.7'
$env:CODER_STUDIO_RUNTIME_MIN_SHELL_VERSION='0.5.6'
pnpm build:desktop-runtime
```

未设置时，Runtime 版本回退到 CLI package 版本，最低 Shell 版本回退到 Desktop package 版本。

所有 Product Runtime 和 Engine 生产资源都会移除 `.map`。构建目录中的 Electron Shell sourcemap
只用于单独的错误诊断，`electron-builder` 仍会从安装包中排除它们。

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

这里的“热更新”是无需重新下载安装 Desktop 的 Product Runtime 更新，但仍通过一次应用重启完成
Server 与 Web 的原子切换；不在运行中的 Node 进程内替换业务代码。
