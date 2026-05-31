# rust-analyzer 启动期间 hover/definition 静默无响应，UI 无进度反馈

## 标题

`feat(web): surface rust-analyzer indexing progress in the LSP status notice`

## 问题描述

打开第一个 `.rs` 文件时，rust-analyzer 会进入 `PrimeCaches` 阶段对工作区做初始化索引。这个阶段在 coder-studio 仓库根（中等仓库 + 大量 `node_modules`）下实测**会持续 ~25 秒**。

期间：

- `initialize` LSP 请求几十毫秒就返回（rust-analyzer 设计上立刻确认 capabilities，workspace 加载是异步的）
- 我们的 `LspManager.ensureSession` 拿到 `summary.status === "ready"`，前端把 hover/definition provider 都注册好
- 但用户**任何** hover/definition 请求都会被 rust-analyzer **立刻返回 `null`**——不是 hang、不是 timeout，而是它故意在 indexing 期间不给语义答案
- Monaco 拿到 null 就什么都不显示
- 用户感受：开了 `.rs` 文件之后随便点点都"完全没反应"，像 LSP 没起来

25 秒后 rust-analyzer 发 `$/progress { kind: "end" }` 通知，从此 hover 正常工作。但**这中间的等待期对用户完全不可见**。

## 复现步骤

1. 干净环境，无 rust-analyzer 缓存。
2. 在 coder-studio 仓库根新建 `Cargo.toml` + `probe.rs`（最小 bin 项目即可）。
3. 重启 dev server，让 LSP 会话从干净状态启动。
4. 浏览器中打开 `probe.rs`，立刻 hover 任一标识符。
5. 观察前 ~25 秒所有 hover/definition/references 都没反应。

可以用 `scripts/probe-rust.mjs probe.rs` 直接复现 ——
它会同时记录 initialize 用时、首次 hover 响应、`$/progress end` 用时。

## 实际行为

- 前 25 秒：hover 返回 null，UI 安静
- 之后：hover 工作，但用户多半已经放弃尝试了

## 桌面终端对比

VS Code 的官方 rust-analyzer 扩展会在 status bar 上显示
`rust-analyzer: indexing X/Y` 进度条；Helix 会在底部状态栏显示同样信息。两者都监听 rust-analyzer
的 `$/progress` LSP 通知。

我们目前没监听任何 LSP 进度通知。

## 已确认事实

- `initialize` 响应快（~70ms 量级，与 indexing 解耦）
- rust-analyzer 通过标准 LSP `$/progress`
  notification 通报进度，token 是 `"rustAnalyzer/Indexing"` 或类似
- `LspSession`（`packages/server/src/lsp/session.ts`）目前没有 `connection.onNotification("$/progress", ...)`
  处理器
- 前端 `LspStatusNotice` 目前只有 ready / installing / failed / disabled 四种状态显示

## 后续排查方向

- **server**：`LspSession` 监听 `$/progress` 通知，把 `WorkDoneProgressBegin` /
  `WorkDoneProgressReport` / `WorkDoneProgressEnd` 转成 `lsp.progress.updated` 事件
  via `eventBus`
- **core / shared**：在 `LspEnsureSessionResult` 或独立 `LspProgress` 类型里加一个 "indexing" 状态
- **web**：`LspStatusNotice` 渲染 "Indexing 12 / 47 …" 或简单的 spinner + percentage
- 范围只对 rust-analyzer + 任何主动发 `$/progress` 的 server（pylsp、gopls 通常不发）

## 临时缓解

- 文档里告诉用户："首次打开 `.rs` 文件需要等 ~30s 完成索引"
- 或检测 rust-analyzer 没回有效 hover 时，在编辑器里给一个 transient toast 提示
